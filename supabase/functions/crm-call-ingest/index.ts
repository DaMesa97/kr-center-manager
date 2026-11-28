// crm-call-ingest: wejście rozmów z Ringostatu (przez Make) do CRM Po Drzwi.
//
// Co robi (zasady z CRM_PODRZWI_KONTEKST.md):
//   1. sprawdza klucz: nagłówek x-ingest-key (sekret CRM_INGEST_KEY) albo x-internal-key (klucz z vault, używany przez pg_cron),
//   2. normalizuje payload (różne nazwy pól), zapisuje KAŻDĄ rozmowę w crm.rozmowy (idempotentnie po ringostat_call_id),
//   3. nieodebrana przychodząca → lead + wpis w historii, BEZ zadania (Tymek 24.11: CRM nie prowadzi zadań „oddzwoń”), bez AI,
//   4. odebrana < 20 s albo numer zastrzeżony → tylko zapis,
//   5. odebrana → nagranie → ElevenLabs → Claude (analiza wg schematu z prototypu) → lead, zadanie,
//      a przy akcji „przygotuj_oferte” wiersz w crm.oferty ze statusem 'przelicz' (liczy go osobna funkcja);
//      28.11 (właściciel): nowy numer z analizą „bez potencjału” (potencjal = nie) → rozmowa bez klienta (potencjal.ts),
//      podsumowanie z dopiskiem „Bez potencjału: …”; klienta można założyć ręcznie w aplikacji (crm.utworz_klienta_z_kontaktu),
//   6. odebrana rozmowa wychodząca do leada z zadaniem „oddzwoń” zamyka to zadanie (zdarzenie zadanie_zrobione),
//   7. każdy błąd ląduje w crm.rozmowy.blad + crm.zdarzenia (typ 'blad'); żadna rozmowa nie ginie po cichu,
//   8. { "akcja": "mail", "mail_id": "<uuid>" } – analiza maila przychodzącego z crm.maile (mail.ts): ten sam schemat AI
//      i te same decyzje (lead po e-mailu, zadanie, oferta 'przelicz'); woła to trigger crm.zlec_analize_maila.
//      Mail „Nowe zamówienie NNN” ze sklepu (zamowienie.ts): obsługuje Baselinker, CRM robi zadanie „dopytaj” tylko przy
//      nietypowej adnotacji klienta (bez adnotacji: bez AI, bez leada).
//   9. { "akcja": "notatka", "lead_id": "<uuid>", "notatka"?: "tekst", "kto"?: "<uuid>" } – oferta z notatki handlowca
//      (klient z salonu, bez rozmowy i maila; notatka.ts): analiza notatki tym samym schematem, uzupełnienie leada,
//      oferta 'przelicz'. Woła to rpc crm.zlec_oferte_z_notatki (przycisk w aplikacji) i trigger crm.leady_zlec_oferte.
//  10. { "akcja": "notatka_audio", "lead_id": "<uuid>", "sciezka": "<plik w buckecie crm-nagrania>", "kto"?: "<uuid>" } – notatka
//      głosowa: transkrypcja ElevenLabs (jeden mówca) → tekst do leady.podsumowanie → jak akcja notatka. Woła to rpc crm.zlec_oferte_z_nagrania.
//
// Ponawianie: { "akcja": "ponow", "rozmowa_id": "<uuid>" } przetwarza raz jeszcze rozmowę ze statusem 'blad' z zapisanego payloadu
// (np. nagranie było jeszcze niedostępne); { "akcja": "ponow_bledy" } ponawia do 5 najstarszych błędów (woła to pg_cron co 15 min,
// maksymalnie 6 prób na rozmowę). Testy 27.11 (runda 3): także rozmowy zawieszone w 'nowa' dłużej niż 15 min (funkcja padła
// w połowie, np. limit czasu Edge) i maile przychodzące zawieszone w 'nowy' (wywołanie z triggera nie doszło albo padło).
// Test bez nagrania: w payloadzie pole `transkrypcja` (tekst) pomija pobieranie i ElevenLabs.
// Sekrety: CRM_INGEST_KEY, ANTHROPIC_API_KEY, ANTHROPIC_WORKSPACE_ID (gdy klucz sk-ant-usr), ELEVENLABS_API_KEY.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { normalizujPayload, numerKlienta, zdecyduj, OPISY_AKCJI, etykietyZAnalizy, type Rozmowa } from './normalizacja.ts'
import { terminZBazy, znajdzLeadaZBazy } from './termin.ts'
import { SCHEMA_ANALIZA, systemAnalizy, userAnalizy, cenaOrientacyjna, type Analiza, type KontekstRozmowy } from './prompt.ts'
import { claudeJson } from './ai.ts'
import { decyzjaLeada, podsumowanieBezPotencjalu, potencjalZAnalizy } from './potencjal.ts'
import { pobierzNagranie, transkrybuj } from './stt.ts'
import { przetworzMailAkcja, ponowMaile } from './mail.ts'
import { przetworzNotatke, przetworzNotatkeAudio } from './notatka.ts'

const JSON_H = { 'Content-Type': 'application/json' }
const odp = (status: number, dane: unknown) => new Response(JSON.stringify(dane), { status, headers: JSON_H })
const MAX_PROB = 6
const ZAWIESZONA_PO_MS = 15 * 60_000
let kluczWewnetrzny: string | null = null

type Lead = {
  id: string; telefon: string | null; email: string | null; nazwa: string | null; miejscowosc: string | null
  status: string; kategoria: string | null; podsumowanie: string | null; nastepna_akcja: string | null; nastepny_krok: string | null
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return odp(405, { error: 'Tylko POST' })

  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { db: { schema: 'crm' } })
  if (!(await autoryzowany(req, db))) return odp(401, { error: 'Zły klucz' })

  let payload: Record<string, unknown>
  try {
    payload = await wczytajBody(req)
  } catch (e) {
    return odp(400, { error: 'Nieczytelny payload: ' + (e instanceof Error ? e.message : String(e)) })
  }

  // mail przychodzący z crm.maile (trigger w bazie po wstawieniu wiersza przez crm-mail-sent)
  if (payload.akcja === 'mail') {
    try {
      return odp(200, await przetworzMailAkcja(db, String(payload.mail_id ?? '')))
    } catch (e) {
      return odp(500, { error: e instanceof Error ? e.message : String(e) })
    }
  }

  // oferta z notatki handlowca (klient z salonu): rpc crm.zlec_oferte_z_notatki albo trigger na crm.leady
  if (payload.akcja === 'notatka' || payload.akcja === 'notatka_audio') {
    try {
      return odp(200, payload.akcja === 'notatka_audio' ? await przetworzNotatkeAudio(db, payload) : await przetworzNotatke(db, payload))
    } catch (e) {
      return odp(500, { error: e instanceof Error ? e.message : String(e) })
    }
  }

  // ponawianie rozmów z błędem (ręcznie albo z pg_cron)
  if (payload.akcja === 'ponow' || payload.akcja === 'ponow_bledy') {
    try {
      return odp(200, await ponow(db, payload))
    } catch (e) {
      return odp(500, { error: e instanceof Error ? e.message : String(e) })
    }
  }

  const r = normalizujPayload(payload)
  if (!r.ringostat_call_id) r.ringostat_call_id = `bez-id:${r.numer_dzwoniacego ?? 'x'}:${r.data_rozmowy}`

  // 1. idempotencja
  const { data: istnieje } = await db.from('rozmowy').select('id, status_przetwarzania').eq('ringostat_call_id', r.ringostat_call_id).maybeSingle()
  if (istnieje) return odp(200, { ok: true, duplikat: true, rozmowa_id: istnieje.id })

  // 2. zapis rozmowy i dopasowanie leada po numerze
  const telefon = numerKlienta(r)
  const lead = telefon ? await znajdzLead(db, telefon) : null
  const { data: rozmowa, error: eIns } = await db.from('rozmowy').insert({
    ringostat_call_id: r.ringostat_call_id, lead_id: lead?.id ?? null, kierunek: r.kierunek, odebrana: r.odebrana, czas_s: r.czas_s,
    ivr: r.ivr, link_nagrania: r.link_nagrania, data_rozmowy: r.data_rozmowy, numer_dzwoniacego: r.numer_dzwoniacego,
    numer_docelowy: r.numer_docelowy, raw: payload, status_przetwarzania: 'nowa',
  }).select('id').single()
  if (eIns || !rozmowa) return odp(500, { error: 'Nie zapisano rozmowy: ' + (eIns?.message ?? '?') })

  return odp(200, await przetworz(db, r, payload, rozmowa.id, lead, telefon))
})

// --------------------------------------------------------------------------------------------
async function autoryzowany(req: Request, db: SupabaseClient): Promise<boolean> {
  const klucz = Deno.env.get('CRM_INGEST_KEY')
  if (klucz && req.headers.get('x-ingest-key') === klucz) return true
  const wew = req.headers.get('x-internal-key')
  if (wew) {
    if (!kluczWewnetrzny) {
      const { data } = await db.rpc('klucz_wewnetrzny')
      kluczWewnetrzny = typeof data === 'string' ? data : null
    }
    return !!kluczWewnetrzny && wew === kluczWewnetrzny
  }
  return false
}

// Wspólna część: decyzja i przetworzenie jednej rozmowy (nowej albo ponawianej). Zawsze zwraca obiekt do odpowiedzi.
async function przetworz(db: SupabaseClient, r: Rozmowa, payload: Record<string, unknown>, rozmowaId: string, lead: Lead | null, telefon: string | null) {
  const transkrypcjaTest = typeof payload.transkrypcja === 'string' && payload.transkrypcja.trim().length > 20 ? payload.transkrypcja.trim() : null
  const decyzja = zdecyduj(r, !!transkrypcjaTest)
  try {
    switch (decyzja.krok) {
      case 'pomin': {
        await db.from('rozmowy').update({ status_przetwarzania: 'pominieta', podsumowanie: decyzja.powod, blad: null }).eq('id', rozmowaId)
        await zdarzenie(db, { lead_id: lead?.id ?? null, rozmowa_id: rozmowaId, typ: 'rozmowa_pominieta', opis: decyzja.powod })
        // krótka, ale odebrana rozmowa wychodząca do leada z zadaniem „oddzwoń” = Magda oddzwoniła
        if (lead && r.kierunek === 'wychodzaca' && r.odebrana) await zamknijOddzwon(db, lead, rozmowaId, r)
        return { ok: true, rozmowa_id: rozmowaId, krok: 'pomin', powod: decyzja.powod }
      }
      case 'bez_ai': {
        await db.from('rozmowy').update({ status_przetwarzania: 'bez_ai', podsumowanie: decyzja.powod, blad: null }).eq('id', rozmowaId)
        if (lead) {
          const zmiany: Record<string, unknown> = { ostatnia_rozmowa_at: r.data_rozmowy }
          if (r.kierunek === 'wychodzaca' && !r.odebrana && lead.nastepna_akcja === 'oddzwon') {
            // próba oddzwonienia bez odpowiedzi: zadanie zostaje, ale handlowiec widzi, że już próbował
            zmiany.akcja_opis = `Próba oddzwonienia ${godzinaPL(r.data_rozmowy)}, klient nie odebrał. Spróbuj ponownie.`
          }
          await zapiszLeada(db, lead.id, zmiany)
          if (r.kierunek === 'wychodzaca' && r.odebrana) await zamknijOddzwon(db, lead, rozmowaId, r)
        }
        await zdarzenie(db, { lead_id: lead?.id ?? null, rozmowa_id: rozmowaId, typ: 'rozmowa', opis: decyzja.powod })
        return { ok: true, rozmowa_id: rozmowaId, krok: 'bez_ai', powod: decyzja.powod }
      }
      case 'nieodebrana': {
        // Tymek 24.11: CRM nie prowadzi zadań „oddzwoń” — nieodebrana zostaje w historii klienta (lead + rozmowa + zdarzenie),
        // istniejące zadanie leada bez zmian (dotąd: zadanie „oddzwoń” na dziś, 7 takich wisiało w „Do zrobienia”)
        // 28.11 (właściciel): nieodebrana z NOWEGO numeru nie zakłada klienta — rozmowa zostaje bez klienta (lista
        // „Bez potencjału sprzedaży”); gdy numer zadzwoni później z potencjałem, nowyLead dopnie ją do klienta
        if (!lead) {
          await db.from('rozmowy').update({ status_przetwarzania: 'bez_ai', podsumowanie: 'Nieodebrana przychodząca z nowego numeru (bez klienta).', blad: null }).eq('id', rozmowaId)
          await zdarzenie(db, { lead_id: null, rozmowa_id: rozmowaId, typ: 'nieodebrana', opis: `Nieodebrana rozmowa ${godzinaPL(r.data_rozmowy)} z nowego numeru — bez klienta.` })
          return { ok: true, rozmowa_id: rozmowaId, krok: 'nieodebrana', lead_id: null }
        }
        const l = lead
        await zapiszLeada(db, l.id, { ostatnia_rozmowa_at: r.data_rozmowy })
        await db.from('rozmowy').update({ lead_id: l.id, status_przetwarzania: 'bez_ai', podsumowanie: 'Nieodebrana przychodząca.', blad: null }).eq('id', rozmowaId)
        await zdarzenie(db, { lead_id: l.id, rozmowa_id: rozmowaId, typ: 'nieodebrana', opis: `Nieodebrana rozmowa ${godzinaPL(r.data_rozmowy)} (bez zadania).` })
        return { ok: true, rozmowa_id: rozmowaId, krok: 'nieodebrana', lead_id: l.id }
      }
      case 'analizuj': {
        const wynik = await analizuj(db, r, rozmowaId, lead, telefon, transkrypcjaTest)
        return { ok: true, rozmowa_id: rozmowaId, krok: 'analizuj', ...wynik }
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await db.from('rozmowy').update({ status_przetwarzania: 'blad', blad: msg.slice(0, 2000) }).eq('id', rozmowaId)
    await zdarzenie(db, { lead_id: lead?.id ?? null, rozmowa_id: rozmowaId, typ: 'blad', opis: msg.slice(0, 500) })
    return { ok: false, rozmowa_id: rozmowaId, blad: msg }
  }
}

// --------------------------------------------------------------------------------------------
async function ponow(db: SupabaseClient, payload: Record<string, unknown>) {
  let ids: string[] = []
  if (payload.akcja === 'ponow') {
    const id = String(payload.rozmowa_id ?? '')
    if (!id) throw new Error('Brak rozmowa_id')
    ids = [id]
  } else {
    // testy 27.11 (runda 3): 'nowa' starsza niż 15 min = przetwarzanie przerwane (żywe trwa najwyżej kilka minut)
    const granica = new Date(Date.now() - ZAWIESZONA_PO_MS).toISOString()
    const { data, error } = await db.from('rozmowy').select('id, raw')
      .or(`status_przetwarzania.eq.blad,and(status_przetwarzania.eq.nowa,created_at.lt.${granica})`).order('created_at').limit(20)
    if (error) throw new Error('Odczyt rozmów do ponowienia: ' + error.message)
    ids = (data ?? []).filter((x) => liczbaProb(x.raw) < MAX_PROB).slice(0, 5).map((x) => x.id)
  }
  const wyniki = []
  for (const id of ids) {
    const { data: roz } = await db.from('rozmowy').select('id, raw, status_przetwarzania, lead_id').eq('id', id).maybeSingle()
    if (!roz) { wyniki.push({ rozmowa_id: id, blad: 'nie ma takiej rozmowy' }); continue }
    if (roz.status_przetwarzania !== 'blad' && roz.status_przetwarzania !== 'nowa' && payload.akcja === 'ponow_bledy') continue
    const raw = (roz.raw ?? {}) as Record<string, unknown>
    const proby = liczbaProb(raw) + 1
    await db.from('rozmowy').update({ status_przetwarzania: 'nowa', blad: null, raw: { ...raw, _proby: proby } }).eq('id', id)
    const r = normalizujPayload(raw)
    const telefon = numerKlienta(r)
    const lead = telefon ? await znajdzLead(db, telefon) : null
    const w = await przetworz(db, r, raw, id, lead, telefon)
    if (!w.ok && proby >= MAX_PROB) {
      await zdarzenie(db, { lead_id: lead?.id ?? null, rozmowa_id: id, typ: 'blad', opis: `Po ${proby} próbach rozmowa nadal nie przetworzona, system przestaje ponawiać. Sprawdź ręcznie.` })
    }
    wyniki.push({ ...w, proba: proby })
  }
  const maile = payload.akcja === 'ponow_bledy' ? await ponowMaile(db) : []
  return { ok: true, ponowiono: wyniki.length + maile.length, wyniki, maile }
}

function liczbaProb(raw: unknown): number {
  const p = (raw as Record<string, unknown> | null)?._proby
  return typeof p === 'number' ? p : 0
}

// --------------------------------------------------------------------------------------------
async function analizuj(db: SupabaseClient, r: Rozmowa, rozmowaId: string, lead: Lead | null, telefon: string | null, transkrypcjaTest: string | null) {
  // transkrypcja (przy ponowieniu: jeśli już jest zapisana, nie pobieramy nagrania drugi raz)
  let transkrypcja = transkrypcjaTest
  if (!transkrypcja) {
    const { data: zapisana } = await db.from('rozmowy').select('transkrypcja').eq('id', rozmowaId).maybeSingle()
    if (zapisana?.transkrypcja && zapisana.transkrypcja.length >= 20) transkrypcja = zapisana.transkrypcja
  }
  if (!transkrypcja) {
    const nagranie = await pobierzNagranie(r.link_nagrania!)
    const t = await transkrybuj(nagranie, nazwaZUrl(r.link_nagrania!))
    transkrypcja = t.tekst
    if (!transkrypcja || transkrypcja.length < 20) throw new Error('Pusta transkrypcja (nagranie bez mowy?)')
  }
  await db.from('rozmowy').update({ transkrypcja }).eq('id', rozmowaId)

  // kontekst: lead i poprzednie rozmowy
  const poprzednie: KontekstRozmowy['poprzednie'] = []
  if (lead) {
    const { data } = await db.from('rozmowy').select('data_rozmowy, podsumowanie, typ').eq('lead_id', lead.id).neq('id', rozmowaId)
      .order('data_rozmowy', { ascending: false }).limit(3)
    for (const p of data ?? []) poprzednie.push({ data: p.data_rozmowy ?? '', podsumowanie: p.podsumowanie, typ: p.typ })
  }
  const kontekst: KontekstRozmowy = {
    kierunek: r.kierunek, ivr: r.ivr, czas_s: r.czas_s, poprzednie,
    lead: lead ? { nazwa: lead.nazwa, miejscowosc: lead.miejscowosc, status: lead.status, kategoria: lead.kategoria, podsumowanie: lead.podsumowanie, nastepna_akcja: lead.nastepna_akcja } : null,
  }

  // AI
  const ai = await claudeJson<Analiza>(systemAnalizy(), userAnalizy(transkrypcja, kontekst), SCHEMA_ANALIZA, 'high')
  const a = ai.dane
  // 28.11 (właściciel): nowy kontakt bez potencjału sprzedażowego nie zakłada klienta — rozmowa zostaje „bez klienta”
  const decyzja = decyzjaLeada(a, !!lead, !!telefon)
  const bezPotencjalu = decyzja === 'bez_potencjalu'
  await db.from('rozmowy').update({
    analiza: a, typ: a.typ, kategoria: a.kategoria === 'nieznana' ? null : a.kategoria,
    podsumowanie: bezPotencjalu ? podsumowanieBezPotencjalu(a.podsumowanie, a.powod_braku_potencjalu) : a.podsumowanie,
    nastepna_akcja: bezPotencjalu ? 'brak' : a.nastepna_akcja, koszt_ai_usd: ai.koszt_usd, zuzycie_tokenow: ai.zuzycie,
  }).eq('id', rozmowaId)

  // routing
  let leadId = lead?.id ?? null
  let ofertaId: string | null = null
  const sprzedazowa = a.typ === 'zapytanie' || a.typ === 'klient'
  if (decyzja === 'istniejacy' || decyzja === 'nowy') {
    const l = lead ?? await nowyLead(db, telefon!, r)
    leadId = l.id
    // Tymek 24.11: bez zadań „oddzwoń” — gdy model chce kontaktu z klientem, to zadanie „dopytaj”
    const akcja = a.typ === 'reklamacja' ? 'reklamacja' : (a.nastepna_akcja === 'brak' ? null : a.nastepna_akcja === 'oddzwon' ? 'dopytaj' : a.nastepna_akcja)
    const zmiany: Record<string, unknown> = {
      ostatnia_rozmowa_at: r.data_rozmowy,
      podsumowanie: a.podsumowanie,
      brakuje: a.brakuje.length ? a.brakuje.join('; ') : null,
      nastepna_akcja: akcja,
      nastepny_krok: akcja ? await terminZBazy(db, akcja) : null,
      akcja_od: akcja ? new Date().toISOString() : null,
      akcja_opis: akcja ? `${OPISY_AKCJI[akcja]} ${a.podsumowanie}`.slice(0, 500) : null,
    }
    if (a.nazwa && !l.nazwa) zmiany.nazwa = a.nazwa
    if (a.miejscowosc && !l.miejscowosc) zmiany.miejscowosc = a.miejscowosc
    if (a.email && !l.email) zmiany.email = a.email
    if (a.kategoria && a.kategoria !== 'nieznana') zmiany.kategoria = a.kategoria
    if (r.kampania && !lead) zmiany.kampania = r.kampania
    // 24.11 (Tymek): cena podana klientowi w rozmowie od razu jest wartością klienta w lejku (do czasu oferty / wpisu ręcznego)
    const cena = cenaOrientacyjna(a)
    if (cena != null) zmiany.wartosc_wstepna = cena
    await zapiszLeada(db, l.id, zmiany)
    await db.from('rozmowy').update({ lead_id: l.id }).eq('id', rozmowaId)
    if (cena != null) await zdarzenie(db, { lead_id: l.id, rozmowa_id: rozmowaId, typ: 'wartosc_wstepna', opis: `Cena orientacyjna z rozmowy: ${cena.toLocaleString('pl-PL')} zł`, dane: { kwota: cena, zrodlo: 'rozmowa' } })
    const etykiety = etykietyZAnalizy(a)
    if (etykiety.length) await db.rpc('dodaj_etykiety', { p_lead_id: l.id, p_etykiety: etykiety })

    if (sprzedazowa && a.nastepna_akcja === 'przygotuj_oferte') {
      // jeden klient = jedna otwarta oferta: nowa rozmowa robi kolejną wersję, otwarte wcześniejsze schodzą do roboczych
      const { data: otwarte } = await db.from('oferty').select('id, wersja').eq('lead_id', l.id).in('status', ['przelicz', 'do_sprawdzenia'])
        .order('wersja', { ascending: false })
      const { data: ostatnia } = await db.from('oferty').select('id, wersja').eq('lead_id', l.id).order('wersja', { ascending: false }).limit(1).maybeSingle()
      // testy 27.11 (runda 3): ponowienie po przerwanym przebiegu nie robi drugiej oferty z tej samej rozmowy
      const { data: juzJest, error: eJuz } = await db.from('oferty').select('id').eq('rozmowa_id', rozmowaId).order('created_at').limit(1).maybeSingle()
      if (eJuz) throw new Error('Odczyt ofert rozmowy: ' + eJuz.message)
      if (juzJest) {
        ofertaId = juzJest.id
      } else {
        const { data: of, error } = await db.from('oferty').insert({
          lead_id: l.id, rozmowa_id: rozmowaId, wersja: (ostatnia?.wersja ?? 0) + 1, poprzednia_id: ostatnia?.id ?? null,
          status: 'przelicz', analiza: a, mail_do: a.email || l.email || null,
        }).select('id').single()
        if (error) throw new Error('Nie utworzono oferty: ' + error.message)
        ofertaId = of.id
        if (otwarte?.length) await db.from('oferty').update({ status: 'robocza' }).in('id', otwarte.map((o) => o.id))
      }
      await db.from('rozmowy').update({ oferta_id: ofertaId }).eq('id', rozmowaId)
      await zdarzenie(db, { lead_id: l.id, rozmowa_id: rozmowaId, oferta_id: ofertaId, typ: 'oferta_zlecona',
        opis: ostatnia ? `Nowa wersja oferty (${(ostatnia.wersja ?? 0) + 1}) po kolejnej rozmowie, czeka na przeliczenie.` : 'Oferta czeka na przeliczenie (status przelicz).' })
    }
    await zdarzenie(db, { lead_id: l.id, rozmowa_id: rozmowaId, typ: 'analiza', opis: `${a.typ}: ${a.podsumowanie}`.slice(0, 500), dane: { akcja, koszt_usd: ai.koszt_usd } })
  } else if (bezPotencjalu) {
    // bez leada (lead_id null), status 'przetworzona'; widać ją w aplikacji: Klienci → „Bez klienta” (tam „Utwórz klienta”)
    await zdarzenie(db, { lead_id: null, rozmowa_id: rozmowaId, typ: 'analiza',
      opis: `${a.typ}: ${podsumowanieBezPotencjalu(a.podsumowanie, a.powod_braku_potencjalu)}`.slice(0, 500),
      dane: { koszt_usd: ai.koszt_usd, potencjal: 'nie', powod: a.powod_braku_potencjalu ?? null, bez_klienta: true } })
  } else {
    if (lead) {
      await zapiszLeada(db, lead.id, { ostatnia_rozmowa_at: r.data_rozmowy })
      // Magda oddzwoniła, a rozmowa nie była sprzedażowa (np. status zamówienia): zadanie „oddzwoń” jest wykonane
      if (r.kierunek === 'wychodzaca') await zamknijOddzwon(db, lead, rozmowaId, r)
    }
    await zdarzenie(db, { lead_id: leadId, rozmowa_id: rozmowaId, typ: 'analiza', opis: `${a.typ}: ${a.podsumowanie}`.slice(0, 500), dane: { koszt_usd: ai.koszt_usd } })
  }

  await db.from('rozmowy').update({ status_przetwarzania: 'przetworzona', blad: null }).eq('id', rozmowaId)
  return { typ: a.typ, akcja: bezPotencjalu ? 'brak' : a.nastepna_akcja, potencjal: potencjalZAnalizy(a), decyzja, lead_id: leadId, oferta_id: ofertaId, koszt_usd: Number(ai.koszt_usd.toFixed(4)) }
}

// --------------------------------------------------------------------------------------------
/** Zadanie „oddzwoń” zamyka się samo, gdy Ringostat zarejestruje odebraną rozmowę wychodzącą do tego klienta. */
async function zamknijOddzwon(db: SupabaseClient, lead: Lead, rozmowaId: string, r: Rozmowa) {
  if (lead.nastepna_akcja !== 'oddzwon') return
  const { error } = await db.from('leady').update({ nastepna_akcja: null, nastepny_krok: null, akcja_opis: null, akcja_od: null }).eq('id', lead.id).eq('nastepna_akcja', 'oddzwon')
  if (error) throw new Error('Nie zamknięto zadania „oddzwoń”: ' + error.message)   // testy 27.11 (runda 3)
  await zdarzenie(db, { lead_id: lead.id, rozmowa_id: rozmowaId, typ: 'zadanie_zrobione', opis: `Oddzwoniono ${godzinaPL(r.data_rozmowy)} (rozmowa wychodząca z Ringostatu).`, dane: { zrodlo: 'ringostat', akcja: 'oddzwon' } })
}

async function znajdzLead(db: SupabaseClient, telefon: string): Promise<Lead | null> {
  const { data } = await db.from('leady').select('id, telefon, email, nazwa, miejscowosc, status, kategoria, podsumowanie, nastepna_akcja, nastepny_krok').eq('telefon', telefon).maybeSingle()
  if (data) return data as Lead
  // numer przejęty przy scalaniu kontaktów (inne_kontakty)
  const dop = await znajdzLeadaZBazy(db, null, telefon)
  if (!dop) return null
  const { data: l } = await db.from('leady').select('id, telefon, email, nazwa, miejscowosc, status, kategoria, podsumowanie, nastepna_akcja, nastepny_krok').eq('id', dop.id).maybeSingle()
  return (l as Lead | null) ?? null
}

async function nowyLead(db: SupabaseClient, telefon: string, r: Rozmowa): Promise<Lead> {
  const { data, error } = await db.from('leady').insert({ telefon, zrodlo: 'telefon', kampania: r.kampania, status: 'nowy' })
    .select('id, telefon, email, nazwa, miejscowosc, status, kategoria, podsumowanie, nastepna_akcja, nastepny_krok').single()
  if (error || !data) {
    // wyścig: dwa webhooki o tym samym numerze w tej samej sekundzie
    const ponownie = await znajdzLead(db, telefon)
    if (ponownie) return ponownie
    throw new Error('Nie utworzono leada: ' + (error?.message ?? '?'))
  }
  await zdarzenie(db, { lead_id: data.id, typ: 'lead_utworzony', opis: `Nowy lead z telefonu ${telefon}` })
  // 28.11: wcześniejsze rozmowy z tego numeru bez klienta (nieodebrane, „bez potencjału”) z 60 dni dopinamy do nowego klienta
  try {
    const od = new Date(Date.now() - 60 * 86400 * 1000).toISOString()
    const { data: stare } = await db.from('rozmowy').select('id, kierunek, numer_dzwoniacego, numer_docelowy')
      .is('lead_id', null).gte('data_rozmowy', od).or(`numer_dzwoniacego.eq.${telefon},numer_docelowy.eq.${telefon}`)
    const ids = (stare ?? []).filter((x) => numerKlienta(x as unknown as Rozmowa) === telefon).map((x) => x.id)
    if (ids.length) {
      await db.from('rozmowy').update({ lead_id: data.id }).in('id', ids)
      await db.from('zdarzenia').update({ lead_id: data.id }).in('rozmowa_id', ids).is('lead_id', null)
    }
  } catch (e) {
    console.error('dopięcie wcześniejszych rozmów:', e)
  }
  return data as Lead
}

/** Zapis zmian klienta z kontrolą błędu (testy 27.11, runda 3): błąd rzuca wyjątek → rozmowa 'blad' → ponowienie przez cron. */
async function zapiszLeada(db: SupabaseClient, id: string, zmiany: Record<string, unknown>) {
  const { error } = await db.from('leady').update(zmiany).eq('id', id)
  if (error) throw new Error('Nie zapisano klienta: ' + error.message)
}

async function zdarzenie(db: SupabaseClient, z: { lead_id?: string | null; rozmowa_id?: string; oferta_id?: string | null; typ: string; opis?: string; dane?: unknown }) {
  const { error } = await db.from('zdarzenia').insert({
    lead_id: z.lead_id ?? null, oferta_id: z.oferta_id ?? null, typ: z.typ, opis: z.opis ?? null,
    dane: { ...(typeof z.dane === 'object' && z.dane ? z.dane as Record<string, unknown> : {}), rozmowa_id: z.rozmowa_id ?? null },
  })
  if (error) console.error('zdarzenie:', error.message)
}

async function wczytajBody(req: Request): Promise<Record<string, unknown>> {
  const ct = req.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    const j = await req.json()
    if (j && typeof j === 'object' && !Array.isArray(j)) return rozpakuj(j as Record<string, unknown>)
    throw new Error('oczekiwano obiektu JSON')
  }
  if (ct.includes('form')) {
    const f = await req.formData()
    const o: Record<string, unknown> = {}
    f.forEach((v, k) => { o[k] = typeof v === 'string' ? v : '' })
    return o
  }
  const tekst = await req.text()
  try { return rozpakuj(JSON.parse(tekst)) } catch { throw new Error('nieobsługiwany content-type: ' + ct) }
}

// Make czasem opakowuje dane w { data: {...} } albo { body: {...} }
function rozpakuj(o: Record<string, unknown>): Record<string, unknown> {
  for (const k of ['data', 'body', 'payload', 'call']) {
    const v = o[k]
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(o).length <= 3) return v as Record<string, unknown>
  }
  return o
}

function nazwaZUrl(url: string): string {
  const m = url.split('?')[0].match(/[^/]+\.(wav|mp3|ogg|m4a|flac)$/i)
  return m ? m[0] : 'nagranie.wav'
}

function godzinaPL(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}
