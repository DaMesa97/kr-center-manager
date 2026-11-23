// Oferta z NOTATKI HANDLOWCA: klient przyszedł do salonu (walk-in) albo rozmowa odbyła się poza Ringostatem,
// więc nie ma ani transkrypcji, ani maila. Handlowiec wpisuje w aplikacji, czego klient chce, i zleca ofertę.
// Ta sama analiza AI (SCHEMA_ANALIZA), to samo uzupełnienie leada i etykiet, i ten sam wiersz crm.oferty
// w statusie 'przelicz', który dalej liczy crm-oferta. Analiza trafia do oferty (oferty.analiza), notatka do oferty.notatka.
// Wołane przez rpc crm.zlec_oferte_z_notatki (przycisk „Zleć ofertę” w aplikacji) oraz przez trigger crm.leady_zlec_oferte
// (zalogowany użytkownik ustawił klientowi zadanie „przygotuj_oferte”, a klient nie ma otwartej oferty).

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { normalizujTelefon, etykietyZAnalizy } from './normalizacja.ts'
import { terminZBazy } from './termin.ts'
import { SCHEMA_ANALIZA, systemAnalizyNotatki, userAnalizyNotatki, type Analiza, type KontekstNotatki } from './prompt.ts'
import { claudeJson } from './ai.ts'
import { transkrybuj } from './stt.ts'

const BUCKET_NAGRAN = 'crm-nagrania'

/** Notatka głosowa: plik z bucketu crm-nagrania → ElevenLabs (jeden mówca) → tekst jako notatka klienta → ta sama ścieżka, co notatka pisana. */
export async function przetworzNotatkeAudio(db: SupabaseClient, payload: Record<string, unknown>) {
  const leadId = String(payload.lead_id ?? '')
  const sciezka = String(payload.sciezka ?? '').trim()
  const kto = typeof payload.kto === 'string' && payload.kto ? payload.kto : null
  if (!leadId || !sciezka) return { ok: false, blad: 'Brak lead_id albo sciezka' }
  try {
    const { data: plik, error } = await db.storage.from(BUCKET_NAGRAN).download(sciezka)
    if (error || !plik) throw new Error('Nie pobrano nagrania z bucketu: ' + (error?.message ?? '?'))
    if (plik.size < 1000) throw new Error('Nagranie jest puste (mniej niż 1 KB)')
    const nazwa = sciezka.split('/').pop() || 'notatka.webm'
    const t = await transkrybuj(plik, nazwa, 1)
    const tekst = t.tekst.trim()
    if (tekst.length < 5) throw new Error('Transkrypcja pusta (nagranie bez mowy?)')
    await db.from('leady').update({ podsumowanie: tekst }).eq('id', leadId)
    await zdarzenie(db, { lead_id: leadId, typ: 'notatka_glosowa', kto, opis: tekst.slice(0, 500), dane: { sciezka, jezyk: t.jezyk } })
    const w = await przetworzNotatke(db, { ...payload, notatka: tekst })
    return { ...w, transkrypcja: tekst }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await db.from('leady').update({ akcja_opis: `BŁĄD systemu przy notatce głosowej: ${msg.slice(0, 200)}. Nagraj ponownie albo wpisz notatkę ręcznie.` }).eq('id', leadId)
    await zdarzenie(db, { lead_id: leadId, typ: 'blad', opis: ('Notatka głosowa: ' + msg).slice(0, 500), kto, dane: { sciezka } })
    return { ok: false, lead_id: leadId, blad: msg }
  }
}

type Lead = {
  id: string; telefon: string | null; email: string | null; nazwa: string | null; miejscowosc: string | null
  status: string; kategoria: string | null; zrodlo: string | null; podsumowanie: string | null; nastepna_akcja: string | null
}
const POLA_LEADA = 'id, telefon, email, nazwa, miejscowosc, status, kategoria, zrodlo, podsumowanie, nastepna_akcja'

export async function przetworzNotatke(db: SupabaseClient, payload: Record<string, unknown>) {
  const leadId = String(payload.lead_id ?? '')
  if (!leadId) return { ok: false, blad: 'Brak lead_id' }
  const kto = typeof payload.kto === 'string' && payload.kto ? payload.kto : null
  const { data, error } = await db.from('leady').select(POLA_LEADA).eq('id', leadId).maybeSingle()
  if (error) return { ok: false, blad: 'Odczyt klienta: ' + error.message }
  const lead = data as Lead | null
  if (!lead) return { ok: false, blad: 'Nie ma takiego klienta' }

  const notatka = ((typeof payload.notatka === 'string' && payload.notatka.trim()) || (lead.podsumowanie ?? '')).trim()
  if (notatka.length < 5) {
    await db.from('leady').update({ akcja_opis: 'Brak notatki: wpisz, czego klient chce (wzór, kolor, rozmiar, kierunek, okucia, dostawa), i zleć ofertę ponownie.' }).eq('id', leadId)
    await zdarzenie(db, { lead_id: leadId, typ: 'blad', opis: 'Nie można zlecić oferty: pusta notatka handlowca.', kto })
    return { ok: false, lead_id: leadId, blad: 'Pusta notatka' }
  }

  // oferta tego klienta właśnie się liczy: nie dublujemy (drugi klik, trigger + rpc w tej samej chwili)
  const { data: otwarte } = await db.from('oferty').select('id, wersja, status').eq('lead_id', leadId)
    .in('status', ['przelicz', 'do_sprawdzenia']).order('wersja', { ascending: false })
  const liczona = otwarte?.find((o) => o.status === 'przelicz')
  if (liczona) return { ok: true, lead_id: leadId, oferta_id: liczona.id, pominieto: 'oferta tego klienta już się liczy' }

  try {
    return { ok: true, lead_id: leadId, ...(await analizujNotatke(db, lead, notatka, otwarte ?? [], kto)) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await db.from('leady').update({ akcja_opis: `BŁĄD systemu przy ofercie z notatki: ${msg.slice(0, 200)}. Zleć ofertę ponownie albo zgłoś.` }).eq('id', leadId)
    await zdarzenie(db, { lead_id: leadId, typ: 'blad', opis: ('Oferta z notatki: ' + msg).slice(0, 500), kto })
    return { ok: false, lead_id: leadId, blad: msg }
  }
}

// --------------------------------------------------------------------------------------------
async function analizujNotatke(db: SupabaseClient, lead: Lead, notatka: string, otwarte: { id: string; wersja: number; status: string }[], kto: string | null) {
  const kontekst: KontekstNotatki = {
    zrodlo: lead.zrodlo,
    lead: { nazwa: lead.nazwa, miejscowosc: lead.miejscowosc, telefon: lead.telefon, email: lead.email, status: lead.status, kategoria: lead.kategoria },
    poprzednie: [],
    oferta: null,
  }
  const { data: rozmowy } = await db.from('rozmowy').select('data_rozmowy, podsumowanie, typ').eq('lead_id', lead.id).order('data_rozmowy', { ascending: false }).limit(3)
  for (const p of rozmowy ?? []) kontekst.poprzednie.push({ data: p.data_rozmowy ?? '', rodzaj: 'rozmowa', podsumowanie: p.podsumowanie, typ: p.typ })
  const { data: maile } = await db.from('maile').select('data, kierunek, temat, podsumowanie, typ').eq('lead_id', lead.id).order('data', { ascending: false }).limit(3)
  for (const p of maile ?? []) kontekst.poprzednie.push({ data: p.data ?? '', rodzaj: p.kierunek === 'wychodzacy' ? 'nasz mail' : 'mail klienta', podsumowanie: p.podsumowanie ?? p.temat, typ: p.typ })
  kontekst.poprzednie.sort((a, b) => (a.data < b.data ? 1 : -1))
  const { data: of } = await db.from('oferty').select('wersja, status, cena_razem, dostawa_koszt, produkt').eq('lead_id', lead.id)
    .in('status', ['wyslana', 'do_sprawdzenia', 'zaakceptowana']).order('created_at', { ascending: false }).limit(1)
  if (of?.[0]) kontekst.oferta = of[0]

  const ai = await claudeJson<Analiza>(systemAnalizyNotatki(), userAnalizyNotatki(notatka.slice(0, 6000), kontekst), SCHEMA_ANALIZA, 'high')
  const a = ai.dane

  // lead: notatka handlowca zostaje w `podsumowanie` (to jego słowa), AI uzupełnia tylko braki i zadanie
  const zmiany: Record<string, unknown> = {
    ostatnia_rozmowa_at: new Date().toISOString(),
    brakuje: a.brakuje.length ? a.brakuje.join('; ') : null,
    nastepna_akcja: 'przygotuj_oferte',
    nastepny_krok: await terminZBazy(db, 'przygotuj_oferte'),
    akcja_od: new Date().toISOString(),
    akcja_opis: `Oferta z notatki w przygotowaniu, system liczy. ${a.podsumowanie}`.slice(0, 500),
  }
  if (a.nazwa && !lead.nazwa) zmiany.nazwa = a.nazwa
  if (a.miejscowosc && !lead.miejscowosc) zmiany.miejscowosc = a.miejscowosc
  if (a.email && !lead.email) zmiany.email = a.email
  if (a.kategoria && a.kategoria !== 'nieznana' && !lead.kategoria) zmiany.kategoria = a.kategoria
  const tel = normalizujTelefon(a.telefon)
  if (tel && !lead.telefon) {
    const { data: zajety } = await db.from('leady').select('id').eq('telefon', tel).maybeSingle()
    if (!zajety) zmiany.telefon = tel
  }
  await db.from('leady').update(zmiany).eq('id', lead.id)
  const etykiety = etykietyZAnalizy(a)
  if (etykiety.length) await db.rpc('dodaj_etykiety', { p_lead_id: lead.id, p_etykiety: etykiety })

  // oferta: jeden klient = jedna otwarta oferta; nowe zlecenie robi kolejną wersję, otwarte wcześniejsze schodzą do roboczych
  const { data: ostatnia } = await db.from('oferty').select('id, wersja').eq('lead_id', lead.id).order('wersja', { ascending: false }).limit(1).maybeSingle()
  const wersja = (ostatnia?.wersja ?? 0) + 1
  const { data: nowa, error } = await db.from('oferty').insert({
    lead_id: lead.id, wersja, poprzednia_id: ostatnia?.id ?? null, status: 'przelicz',
    analiza: a, notatka, mail_do: a.email || lead.email || null, handlowiec: kto,
  }).select('id').single()
  if (error) throw new Error('Nie utworzono oferty: ' + error.message)
  if (otwarte.length) await db.from('oferty').update({ status: 'robocza' }).in('id', otwarte.map((o) => o.id))

  await zdarzenie(db, { lead_id: lead.id, oferta_id: nowa.id, typ: 'analiza', kto,
    opis: `notatka handlowca, ${a.typ}: ${a.podsumowanie}`.slice(0, 500), dane: { akcja: 'przygotuj_oferte', koszt_usd: ai.koszt_usd, zrodlo: 'notatka' } })
  await zdarzenie(db, { lead_id: lead.id, oferta_id: nowa.id, typ: 'oferta_zlecona', kto,
    opis: ostatnia ? `Nowa wersja oferty (${wersja}) z notatki handlowca, czeka na przeliczenie.` : 'Oferta z notatki handlowca czeka na przeliczenie (status przelicz).',
    dane: { zrodlo: 'notatka' } })
  return { oferta_id: nowa.id, wersja, typ: a.typ, kategoria: a.kategoria, brakuje: a.brakuje, koszt_usd: Number(ai.koszt_usd.toFixed(4)) }
}

async function zdarzenie(db: SupabaseClient, z: { lead_id?: string | null; oferta_id?: string | null; typ: string; opis?: string; dane?: unknown; kto?: string | null }) {
  const { error } = await db.from('zdarzenia').insert({
    lead_id: z.lead_id ?? null, oferta_id: z.oferta_id ?? null, typ: z.typ, opis: z.opis ?? null, kto: z.kto ?? null,
    dane: { ...(typeof z.dane === 'object' && z.dane ? z.dane as Record<string, unknown> : {}) },
  })
  if (error) console.error('zdarzenie:', error.message)
}
