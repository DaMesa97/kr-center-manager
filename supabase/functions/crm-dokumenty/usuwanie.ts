// D20 (28.11.2026, decyzja właściciela — RODO): usuwanie klienta / oferty CRM razem z plikami.
// Bucket crm-dokumenty (i crm-nagrania) nie ma polityki DELETE dla użytkowników, więc aplikacja nie mogła skasować PDF-ów:
// po usuniętych klientach zostawały karty pomiarowe, umowy i oferty z danymi osobowymi. Teraz kasuje funkcja serwerowa:
//   * rekord (klient / oferta) usuwamy JAKO UŻYTKOWNIK (jego JWT → RLS i auth.uid() w triggerach jak dotąd),
//   * dopiero po udanym usunięciu rekordu — pliki kluczem serwisowym (wcześniej aplikacja kasowała pliki PRZED rekordem:
//     błąd usunięcia rekordu zostawiał klienta bez PDF-ów).
// Klient: wszystkie pliki z katalogu `<lead_id>/` w crm-dokumenty i crm-nagrania + pliki wskazane w jego ofertach /
// dokumentach. Oferta: jej PDF i pliki konfiguracji, o ile nie wskazuje ich inna oferta ani dokument (wersje oferty
// dzielą pliki konfiguracji). Pliki szablonu (`szablon/…`) nigdy nie są kasowane.
// Porządki: pliki w katalogach klientów, których już nie ma w CRM (28.11: 8 plików) — podgląd albo usunięcie;
// dodatkowo lista plików bez odwołania u istniejących klientów (28.11: 7) — tylko do wglądu, nic nie kasuje.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

export const BUCKET_DOKUMENTY = 'crm-dokumenty'
export const BUCKET_NAGRANIA = 'crm-nagrania'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type OfertaPliki = { id?: string; plik_pdf?: string | null; konfiguracja_plik?: string | null; konfiguracja_pliki?: string[] | null }

export class BladUsuwania extends Error {}

/** Ścieżki plików wskazane w wierszu oferty (PDF + konfiguracja), bez pustych i bez szablonu. */
export function plikiOferty(o: OfertaPliki): string[] {
  const lista = [o.plik_pdf, o.konfiguracja_plik, ...(Array.isArray(o.konfiguracja_pliki) ? o.konfiguracja_pliki : [])]
  return [...new Set(lista.filter((p): p is string => typeof p === 'string' && p.trim() !== '' && !p.startsWith('szablon/')))]
}

/** Pliki oferty do skasowania = jej pliki minus te, które wskazuje jeszcze coś innego. */
export function plikiDoSkasowania(wlasne: string[], uzywaneGdzieIndziej: Iterable<string>): string[] {
  const zajete = new Set(uzywaneGdzieIndziej)
  return wlasne.filter((p) => !zajete.has(p))
}

/** Wszystkie pliki w katalogu (do 3 poziomów w głąb), ścieżki pełne. */
async function plikiWKatalogu(db: SupabaseClient, bucket: string, katalog: string, glebokosc = 0): Promise<string[]> {
  const wynik: string[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(bucket).list(katalog, { limit: 1000, offset })
    if (error) throw new Error(`Lista plików ${bucket}/${katalog}: ${error.message}`)
    const wpisy = (data ?? []) as Array<{ name: string; id: string | null }>
    for (const w of wpisy) {
      const sciezka = katalog ? `${katalog}/${w.name}` : w.name
      if (w.id) wynik.push(sciezka)
      else if (glebokosc < 3) wynik.push(...await plikiWKatalogu(db, bucket, sciezka, glebokosc + 1))
    }
    if (wpisy.length < 1000) break
  }
  return wynik
}

async function usunPliki(db: SupabaseClient, bucket: string, sciezki: string[]): Promise<{ usuniete: number; blad: string | null }> {
  const lista = [...new Set(sciezki)].filter((p) => p && !p.startsWith('szablon/'))
  let usuniete = 0
  const bledy: string[] = []
  for (let i = 0; i < lista.length; i += 100) {
    const { data, error } = await db.storage.from(bucket).remove(lista.slice(i, i + 100))
    if (error) bledy.push(error.message)
    else usuniete += (data ?? []).length
  }
  return { usuniete, blad: bledy.length ? bledy.join('; ') : null }
}

/** Ścieżki wskazywane przez wszystkie oferty i dokumenty (opcjonalnie bez jednej oferty). */
async function uzywanePliki(db: SupabaseClient, bezOferty?: string): Promise<Set<string>> {
  const zajete = new Set<string>()
  let q = db.from('oferty').select('id, plik_pdf, konfiguracja_plik, konfiguracja_pliki')
  if (bezOferty) q = q.neq('id', bezOferty)
  const [{ data: of, error: e1 }, { data: dk, error: e2 }] = await Promise.all([q, db.from('dokumenty').select('plik_pdf')])
  if (e1 || e2) throw new Error('Odczyt odwołań do plików: ' + (e1 ?? e2)!.message)
  for (const o of (of ?? []) as OfertaPliki[]) for (const p of plikiOferty(o)) zajete.add(p)
  for (const d of (dk ?? []) as Array<{ plik_pdf: string | null }>) if (d.plik_pdf) zajete.add(d.plik_pdf)
  return zajete
}

/**
 * { akcja: 'usun', lead_id } albo { akcja: 'usun', oferta_id } — `uzytk` to klient Supabase z JWT użytkownika
 * (schemat crm), `db` — klucz serwisowy (schemat crm).
 */
export async function usun(db: SupabaseClient, uzytk: SupabaseClient, body: Record<string, unknown>) {
  const leadId = String(body.lead_id ?? '').trim()
  const ofertaId = String(body.oferta_id ?? '').trim()
  if (leadId) {
    if (!UUID.test(leadId)) throw new BladUsuwania('lead_id: niepoprawny identyfikator')
    const { data: lead } = await db.from('leady').select('id').eq('id', leadId).maybeSingle()
    if (!lead) throw new BladUsuwania('Nie ma takiego klienta')
    const [{ data: of }, { data: dk }] = await Promise.all([
      db.from('oferty').select('plik_pdf, konfiguracja_plik, konfiguracja_pliki').eq('lead_id', leadId),
      db.from('dokumenty').select('plik_pdf').eq('lead_id', leadId),
    ])
    const dokumenty = new Set(await plikiWKatalogu(db, BUCKET_DOKUMENTY, leadId))
    for (const o of (of ?? []) as OfertaPliki[]) for (const p of plikiOferty(o)) dokumenty.add(p)
    for (const d of (dk ?? []) as Array<{ plik_pdf: string | null }>) if (d.plik_pdf) dokumenty.add(d.plik_pdf)
    let nagrania: string[] = []
    try { nagrania = await plikiWKatalogu(db, BUCKET_NAGRANIA, leadId) } catch { /* brak bucketu nagrań nie blokuje */ }
    const { error, count } = await uzytk.from('leady').delete({ count: 'exact' }).eq('id', leadId)
    if (error) throw new BladUsuwania('Nie usunięto klienta: ' + error.message)
    if (!count) throw new BladUsuwania('Klienta nie usunięto (brak uprawnień albo ktoś usunął go przed chwilą)')
    const p1 = await usunPliki(db, BUCKET_DOKUMENTY, [...dokumenty])
    const p2 = nagrania.length ? await usunPliki(db, BUCKET_NAGRANIA, nagrania) : { usuniete: 0, blad: null }
    const blad = [p1.blad, p2.blad].filter(Boolean).join('; ') || null
    return { ok: true, usuniety: 'klient', plikow_usunietych: p1.usuniete + p2.usuniete, blad_plikow: blad }
  }
  if (ofertaId) {
    if (!UUID.test(ofertaId)) throw new BladUsuwania('oferta_id: niepoprawny identyfikator')
    const { data: o } = await db.from('oferty').select('id, plik_pdf, konfiguracja_plik, konfiguracja_pliki').eq('id', ofertaId).maybeSingle()
    if (!o) throw new BladUsuwania('Nie ma takiej oferty')
    const doSkasowania = plikiDoSkasowania(plikiOferty(o as OfertaPliki), await uzywanePliki(db, ofertaId))
    const { error, count } = await uzytk.from('oferty').delete({ count: 'exact' }).eq('id', ofertaId)
    if (error) throw new BladUsuwania('Nie usunięto oferty: ' + error.message)
    if (!count) throw new BladUsuwania('Oferty nie usunięto (brak uprawnień albo ktoś usunął ją przed chwilą)')
    const p = doSkasowania.length ? await usunPliki(db, BUCKET_DOKUMENTY, doSkasowania) : { usuniete: 0, blad: null }
    return { ok: true, usuniety: 'oferta', plikow_usunietych: p.usuniete, blad_plikow: p.blad }
  }
  throw new BladUsuwania('Podaj lead_id albo oferta_id')
}

/**
 * { akcja: 'sprzatnij_pliki', usun?: true } — pliki w katalogach klientów, których nie ma już w CRM (domyślnie tylko
 * podgląd). Pliki bez odwołania u istniejących klientów tylko wypisujemy (stare wersje PDF — decyzja człowieka).
 */
export async function sprzatnijPliki(db: SupabaseClient, usunTeraz: boolean) {
  const katalogi = (await db.storage.from(BUCKET_DOKUMENTY).list('', { limit: 1000 })).data as Array<{ name: string; id: string | null }> | null
  const leadKatalogi = (katalogi ?? []).filter((k) => !k.id && UUID.test(k.name)).map((k) => k.name)
  const { data: istn, error } = leadKatalogi.length ? await db.from('leady').select('id').in('id', leadKatalogi) : { data: [], error: null }
  if (error) throw new Error('Odczyt klientów: ' + error.message)
  const sa = new Set(((istn ?? []) as Array<{ id: string }>).map((r) => r.id))
  const poUsunietych: string[] = []
  const bezOdwolania: string[] = []
  const zajete = await uzywanePliki(db)
  for (const k of leadKatalogi) {
    const pliki = await plikiWKatalogu(db, BUCKET_DOKUMENTY, k)
    if (!sa.has(k)) poUsunietych.push(...pliki)
    else bezOdwolania.push(...pliki.filter((p) => !zajete.has(p)))
  }
  const wynik = usunTeraz && poUsunietych.length ? await usunPliki(db, BUCKET_DOKUMENTY, poUsunietych) : null
  return {
    ok: true,
    tryb: usunTeraz ? 'usun' : 'podglad',
    po_usunietych_klientach: poUsunietych.length,
    usuniete: wynik?.usuniete ?? 0,
    blad_plikow: wynik?.blad ?? null,
    bez_odwolania: bezOdwolania,
  }
}
