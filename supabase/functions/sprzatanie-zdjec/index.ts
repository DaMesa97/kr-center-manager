// sprzatanie-zdjec: D67 (28.11.2026) — codzienne sprzątanie osieroconych zdjęć zleceń w buckecie order-photos.
//
// Sierota = plik bez wpisu w order_photos i bez wpisu w orders_archive.photos, starszy niż doba (lista:
// rpc public.order_photos_sieroty, migracja 20261128055200). Powstaje, gdy plik doszedł, a wpis w bazie nie
// (pracownik nie może skasować pliku), albo po skasowaniu zlecenia. Bezpośrednie DELETE ze storage.objects jest
// zablokowane (i zostawiłoby plik w magazynie), dlatego kasujemy przez Storage API (service_role).
//
// Wywołanie: POST z nagłówkiem x-internal-key = crm.klucz_wewnetrzny() (vault, tak jak funkcje CRM);
// pg_cron 03:45 (migracja 20261128055201) przez crm.wolaj_funkcje('sprzatanie-zdjec', '{}').
// Treść (opcjonalna): { "proba": true } — tylko lista, bez kasowania; { "starsze_niz_godzin": 48 } (min. 12).
// Odpowiedź: { ok, proba, znalezione, usuniete, bledy, przyklady } — trafia do net._http_response.
//
// Wdrożenie: supabase functions deploy sprzatanie-zdjec --no-verify-jwt (pg_net nie wysyła JWT; autoryzacja
// kluczem wewnętrznym jak w crm-bl-sync).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const JSON_H = { 'Content-Type': 'application/json' }
const odp = (status: number, dane: unknown) => new Response(JSON.stringify(dane), { status, headers: JSON_H })
const BUCKET = 'order-photos'
const PACZKA = 100
let kluczWewnetrzny: string | null = null

Deno.serve(async (req) => {
  if (req.method !== 'POST') return odp(405, { error: 'Tylko POST' })
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const klucz = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const db = createClient(url, klucz, { auth: { persistSession: false } })
  const crm = createClient(url, klucz, { db: { schema: 'crm' }, auth: { persistSession: false } })

  const wew = req.headers.get('x-internal-key')
  if (!wew) return odp(401, { error: 'Brak autoryzacji' })
  if (!kluczWewnetrzny) {
    const { data } = await crm.rpc('klucz_wewnetrzny')
    kluczWewnetrzny = typeof data === 'string' ? data : null
  }
  if (!kluczWewnetrzny || wew !== kluczWewnetrzny) return odp(401, { error: 'Brak autoryzacji' })

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { body = {} }
  const proba = body.proba === true
  const godziny = Number.isFinite(Number(body.starsze_niz_godzin)) ? Math.max(12, Number(body.starsze_niz_godzin)) : 24

  const { data, error } = await db.rpc('order_photos_sieroty', { p_starsze_niz_godzin: godziny, p_limit: 1000 })
  if (error) return odp(500, { ok: false, error: error.message })
  const sciezki = ((data ?? []) as { sciezka: string }[]).map((r) => r.sciezka).filter(Boolean)

  let usuniete = 0
  const bledy: string[] = []
  if (!proba) {
    for (let i = 0; i < sciezki.length; i += PACZKA) {
      const paczka = sciezki.slice(i, i + PACZKA)
      const { data: rem, error: remErr } = await db.storage.from(BUCKET).remove(paczka)
      if (remErr) { bledy.push(remErr.message); continue }
      usuniete += (rem ?? []).length
    }
  }
  const wynik = { ok: bledy.length === 0, proba, starsze_niz_godzin: godziny, znalezione: sciezki.length, usuniete, bledy, przyklady: sciezki.slice(0, 5) }
  console.log('sprzatanie-zdjec', JSON.stringify(wynik))
  return odp(bledy.length === 0 ? 200 : 500, wynik)
})
