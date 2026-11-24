// Analiza maila przychodzącego (crm.maile, kierunek 'przychodzacy', status 'nowy'/'blad') tym samym schematem AI,
// co rozmowy, i te same decyzje: lead (po adresie e-mail), zadanie na leadzie, oferta w statusie 'przelicz'.
// Wołane przez trigger w bazie (crm.zlec_analize_maila → akcja 'mail') oraz przez ponawianie błędów (ponow_bledy).

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { normalizujTelefon, OPISY_AKCJI, etykietyZAnalizy } from './normalizacja.ts'
import { SCHEMA_ANALIZA, systemAnalizyMaila, userAnalizyMaila, type Analiza, type KontekstMaila } from './prompt.ts'
import { claudeJson } from './ai.ts'
import { terminZBazy, znajdzLeadaZBazy } from './termin.ts'
import { rozpoznajZamowienie, systemAnalizyZamowienia, userAnalizyZamowienia, SCHEMA_ZAMOWIENIE, type Zamowienie, type AnalizaZamowienia } from './zamowienie.ts'

export const MAX_PROB_MAILA = 4

type MailWiersz = {
  id: string; skrzynka_id: string | null; message_id: string | null; od_adres: string | null; od_nazwa: string | null
  do_adresy: string[]; temat: string | null; tresc: string | null; tresc_ucieta: boolean; zalaczniki: { nazwa: string; typ: string }[]
  data: string | null; lead_id: string | null; oferta_id: string | null; odpowiedz_na: string | null
  status_przetwarzania: string; proby: number; kanal: 'mail' | 'formularz' | null
}
type Lead = {
  id: string; telefon: string | null; email: string | null; nazwa: string | null; miejscowosc: string | null
  status: string; kategoria: string | null; podsumowanie: string | null; nastepna_akcja: string | null; nastepny_krok: string | null
}
const POLA_LEADA = 'id, telefon, email, nazwa, miejscowosc, status, kategoria, podsumowanie, nastepna_akcja, nastepny_krok'

export async function przetworzMailAkcja(db: SupabaseClient, mailId: string) {
  if (!mailId) return { ok: false, blad: 'Brak mail_id' }
  const { data: m, error } = await db.from('maile').select('*').eq('id', mailId).maybeSingle()
  if (error) return { ok: false, blad: 'Odczyt maila: ' + error.message }
  const mail = m as MailWiersz | null
  if (!mail) return { ok: false, blad: 'Nie ma takiego maila' }
  if (mail.status_przetwarzania !== 'nowy' && mail.status_przetwarzania !== 'blad') return { ok: true, mail_id: mailId, pominieto: `mail ma status ${mail.status_przetwarzania}` }
  const proba = (mail.proby ?? 0) + 1
  await db.from('maile').update({ proby: proba, blad: null }).eq('id', mailId)
  try {
    const w = await analizujMail(db, mail)
    return { ok: true, mail_id: mailId, ...w }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await db.from('maile').update({ status_przetwarzania: 'blad', blad: msg.slice(0, 2000) }).eq('id', mailId)
    await zdarzenie(db, { lead_id: mail.lead_id, mail_id: mailId, typ: 'blad', opis: ('Mail: ' + msg).slice(0, 500) })
    if (proba >= MAX_PROB_MAILA) {
      await zdarzenie(db, { lead_id: mail.lead_id, mail_id: mailId, typ: 'blad', opis: `Po ${proba} próbach mail „${(mail.temat ?? '').slice(0, 80)}” nadal nie przetworzony, system przestaje ponawiać. Sprawdź ręcznie.` })
    }
    return { ok: false, mail_id: mailId, blad: msg, proba }
  }
}

/** Ponawia do 5 najstarszych maili ze statusem 'blad' (woła ponow_bledy z pg_cron). */
export async function ponowMaile(db: SupabaseClient) {
  const { data } = await db.from('maile').select('id, proby').eq('status_przetwarzania', 'blad').lt('proby', MAX_PROB_MAILA).order('created_at').limit(5)
  const wyniki = []
  for (const m of data ?? []) wyniki.push(await przetworzMailAkcja(db, m.id))
  return wyniki
}

// --------------------------------------------------------------------------------------------
async function analizujMail(db: SupabaseClient, mail: MailWiersz) {
  const email = (mail.od_adres ?? '').toLowerCase()
  if (!email) throw new Error('Mail bez adresu nadawcy')
  let lead = mail.lead_id ? await leadPoId(db, mail.lead_id) : null
  lead ??= await leadPoEmailu(db, email)
  if (!lead) {
    // klient może już być w bazie pod innym adresem tej samej firmy (domena) albo adresem przejętym przy scalaniu – nie zakładamy duplikatu
    const dop = await znajdzLeadaZBazy(db, email, null)
    if (dop) {
      lead = await leadPoId(db, dop.id)
      if (lead && dop.powod !== 'email') await zdarzenie(db, { lead_id: lead.id, mail_id: mail.id, typ: 'dopasowano', opis: `Mail z adresu ${email} dopisany do tego klienta (${dop.powod === 'domena' ? 'ta sama domena firmowa' : 'adres z połączonego kontaktu'}).`, dane: { powod: dop.powod, email } })
    }
  }

  // zamówienie ze sklepu: obsługuje Baselinker, CRM reaguje tylko na nietypową adnotację klienta
  const zam = rozpoznajZamowienie(mail.temat, mail.tresc)
  if (zam) return await obsluzZamowienie(db, mail, zam, lead, email)

  // kontekst: lead, poprzednie rozmowy i maile, otwarta/wysłana oferta
  const kontekst: KontekstMaila = {
    od: mail.od_nazwa ? `${mail.od_nazwa} <${email}>` : email,
    kanal: mail.kanal === 'formularz' ? 'formularz' : 'mail',
    do: mail.do_adresy ?? [],
    temat: mail.temat ?? '',
    data: mail.data ?? '',
    zalaczniki: (mail.zalaczniki ?? []).map((z) => z.nazwa),
    tresc_ucieta: !!mail.tresc_ucieta,
    lead: lead ? { nazwa: lead.nazwa, miejscowosc: lead.miejscowosc, status: lead.status, kategoria: lead.kategoria, podsumowanie: lead.podsumowanie, nastepna_akcja: lead.nastepna_akcja } : null,
    poprzednie: [],
    oferta: null,
  }
  if (lead) {
    const { data: rozmowy } = await db.from('rozmowy').select('data_rozmowy, podsumowanie, typ').eq('lead_id', lead.id).order('data_rozmowy', { ascending: false }).limit(3)
    for (const p of rozmowy ?? []) kontekst.poprzednie.push({ data: p.data_rozmowy ?? '', rodzaj: 'rozmowa', podsumowanie: p.podsumowanie, typ: p.typ })
    const { data: maile } = await db.from('maile').select('data, kierunek, temat, podsumowanie, typ').eq('lead_id', lead.id).neq('id', mail.id).order('data', { ascending: false }).limit(4)
    for (const p of maile ?? []) kontekst.poprzednie.push({ data: p.data ?? '', rodzaj: p.kierunek === 'wychodzacy' ? 'nasz mail' : 'mail klienta', podsumowanie: p.podsumowanie ?? p.temat, typ: p.typ })
    kontekst.poprzednie.sort((a, b) => (a.data < b.data ? 1 : -1))
    const q = db.from('oferty').select('id, wersja, status, cena_razem, dostawa_koszt, mail_temat, wyslano_at, produkt').eq('lead_id', lead.id)
      .in('status', ['wyslana', 'do_sprawdzenia', 'przelicz', 'zaakceptowana']).order('created_at', { ascending: false }).limit(1)
    const { data: of } = mail.oferta_id ? await db.from('oferty').select('id, wersja, status, cena_razem, dostawa_koszt, mail_temat, wyslano_at, produkt').eq('id', mail.oferta_id).limit(1) : await q
    const o = of?.[0]
    if (o) kontekst.oferta = { id: o.id, wersja: o.wersja, status: o.status, cena_razem: o.cena_razem, dostawa_koszt: o.dostawa_koszt, temat: o.mail_temat, wyslano_at: o.wyslano_at, produkt: o.produkt, odpowiedz_na_nia: mail.oferta_id === o.id }
  }

  const ai = await claudeJson<Analiza>(systemAnalizyMaila(), userAnalizyMaila((mail.tresc ?? '').slice(0, 15_000), kontekst), SCHEMA_ANALIZA, 'high')
  const a = ai.dane
  const odpowiedzNaOferte = !!kontekst.oferta && (kontekst.oferta.odpowiedz_na_nia || kontekst.oferta.status === 'wyslana') && (a.typ === 'klient' || a.typ === 'zapytanie')
  const typMaila = odpowiedzNaOferte ? 'odpowiedz' : a.typ
  await db.from('maile').update({
    analiza: a, typ: typMaila, podsumowanie: a.podsumowanie, nastepna_akcja: a.nastepna_akcja,
    koszt_ai_usd: ai.koszt_usd, zuzycie_tokenow: ai.zuzycie, oferta_id: mail.oferta_id ?? (odpowiedzNaOferte ? kontekst.oferta!.id : null),
  }).eq('id', mail.id)

  let leadId = lead?.id ?? null
  let ofertaId: string | null = null
  const sprzedazowa = a.typ === 'zapytanie' || a.typ === 'klient'
  if (sprzedazowa || a.typ === 'reklamacja') {
    const l = lead ?? await nowyLead(db, email, a.nazwa || mail.od_nazwa, mail.id, mail.kanal === 'formularz' ? 'formularz' : 'mail')
    leadId = l.id
    const akcja = a.typ === 'reklamacja' ? 'reklamacja' : (a.nastepna_akcja === 'brak' ? null : a.nastepna_akcja)
    const zmiany: Record<string, unknown> = {
      ostatnia_rozmowa_at: mail.data ?? new Date().toISOString(),
      podsumowanie: a.podsumowanie,
      brakuje: a.brakuje.length ? a.brakuje.join('; ') : null,
      nastepna_akcja: akcja,
      nastepny_krok: akcja ? await terminZBazy(db, akcja) : null,
      akcja_od: akcja ? new Date().toISOString() : null,
      akcja_opis: akcja ? `${OPISY_AKCJI[akcja]} ${odpowiedzNaOferte ? 'Klient odpisał na ofertę. ' : 'Mail od klienta. '}${a.podsumowanie}`.slice(0, 500) : null,
    }
    if (a.nazwa && !l.nazwa) zmiany.nazwa = a.nazwa
    if (!l.nazwa && !a.nazwa && mail.od_nazwa) zmiany.nazwa = mail.od_nazwa
    if (a.miejscowosc && !l.miejscowosc) zmiany.miejscowosc = a.miejscowosc
    if (!l.email) zmiany.email = email
    if (a.kategoria && a.kategoria !== 'nieznana') zmiany.kategoria = a.kategoria
    const tel = normalizujTelefon(a.telefon)
    if (tel && !l.telefon) {
      // numer może już należeć do innego leada (unikalny): wtedy zostawiamy bez numeru, informacja jest w podsumowaniu
      const { data: zajety } = await db.from('leady').select('id').eq('telefon', tel).maybeSingle()
      if (!zajety) zmiany.telefon = tel
    }
    await db.from('leady').update(zmiany).eq('id', l.id)
    await db.from('maile').update({ lead_id: l.id }).eq('id', mail.id)
    const etykiety = etykietyZAnalizy(a)
    if (etykiety.length) await db.rpc('dodaj_etykiety', { p_lead_id: l.id, p_etykiety: etykiety })

    if (sprzedazowa && a.nastepna_akcja === 'przygotuj_oferte') {
      const { data: otwarte } = await db.from('oferty').select('id, wersja').eq('lead_id', l.id).in('status', ['przelicz', 'do_sprawdzenia']).order('wersja', { ascending: false })
      const { data: ostatnia } = await db.from('oferty').select('id, wersja').eq('lead_id', l.id).order('wersja', { ascending: false }).limit(1).maybeSingle()
      const { data: of, error } = await db.from('oferty').insert({
        lead_id: l.id, mail_id: mail.id, wersja: (ostatnia?.wersja ?? 0) + 1, poprzednia_id: ostatnia?.id ?? null,
        status: 'przelicz', analiza: a, mail_do: email,
      }).select('id').single()
      if (error) throw new Error('Nie utworzono oferty: ' + error.message)
      ofertaId = of.id
      if (otwarte?.length) await db.from('oferty').update({ status: 'robocza' }).in('id', otwarte.map((o) => o.id))
      await db.from('maile').update({ oferta_id: ofertaId }).eq('id', mail.id)
      await zdarzenie(db, { lead_id: l.id, mail_id: mail.id, oferta_id: ofertaId, typ: 'oferta_zlecona',
        opis: ostatnia ? `Nowa wersja oferty (${(ostatnia.wersja ?? 0) + 1}) po mailu klienta, czeka na przeliczenie.` : 'Oferta z maila czeka na przeliczenie (status przelicz).' })
    }
    if (odpowiedzNaOferte && kontekst.oferta) {
      await zdarzenie(db, { lead_id: l.id, mail_id: mail.id, oferta_id: kontekst.oferta.id, typ: 'klient_odpisal',
        opis: `Klient odpisał na ofertę v${kontekst.oferta.wersja}: ${a.podsumowanie}`.slice(0, 500) })
    }
    await zdarzenie(db, { lead_id: l.id, mail_id: mail.id, oferta_id: ofertaId, typ: 'analiza', opis: `mail, ${typMaila}: ${a.podsumowanie}`.slice(0, 500), dane: { akcja, koszt_usd: ai.koszt_usd } })
  } else {
    if (lead) await db.from('leady').update({ ostatnia_rozmowa_at: mail.data ?? new Date().toISOString() }).eq('id', lead.id)
    await zdarzenie(db, { lead_id: leadId, mail_id: mail.id, typ: 'analiza', opis: `mail, ${a.typ}: ${a.podsumowanie}`.slice(0, 500), dane: { koszt_usd: ai.koszt_usd } })
  }

  await db.from('maile').update({ status_przetwarzania: 'przetworzony', blad: null }).eq('id', mail.id)
  return { typ: typMaila, akcja: a.nastepna_akcja, lead_id: leadId, oferta_id: ofertaId, koszt_usd: Number(ai.koszt_usd.toFixed(4)) }
}

// --------------------------------------------------------------------------------------------
// Zamówienie sklepowe (zasada właściciela 2026-11-15): bez adnotacji klienta – bez AI, bez leada, bez zadania (Baselinker to obsługuje).
// Z adnotacją – krótka ocena AI, czy adnotacja zgadza się z zamówionym towarem; nietypowa → lead + zadanie „dopytaj” przed realizacją.
async function obsluzZamowienie(db: SupabaseClient, mail: MailWiersz, zam: Zamowienie, lead: Lead | null, email: string) {
  const opisZam = `Zamówienie sklepowe nr ${zam.numer}${zam.klient ? ` od ${zam.klient}` : ''}${zam.razem ? `, razem ${zam.razem}` : ''}`
  if (zam.rodzaj !== 'nowe') {
    // powiadomienie o statusie (anulowane, nieudane…): tylko do historii, bez AI, bez leada, bez zadania – zamówieniami zajmuje się Baselinker
    const co = zam.rodzaj === 'anulowane' ? 'ANULOWANE przez klienta lub sklep' : zam.rodzaj === 'nieudane' ? 'NIEUDANE (płatność nie przeszła)' : 'zmiana statusu w sklepie'
    const podsumowanie = `${opisZam}: ${co}. Powiadomienie sklepu, obsługuje Baselinker; nic do zrobienia w CRM.`
    await db.from('maile').update({ typ: 'zamowienie', podsumowanie, nastepna_akcja: 'brak', analiza: { zamowienie: zam, ocena: null }, lead_id: lead?.id ?? null, status_przetwarzania: 'przetworzony', blad: null }).eq('id', mail.id)
    if (lead) await db.from('leady').update({ ostatnia_rozmowa_at: mail.data ?? new Date().toISOString() }).eq('id', lead.id)
    await zdarzenie(db, { lead_id: lead?.id ?? null, mail_id: mail.id, typ: 'analiza', opis: `mail, zamowienie: ${podsumowanie}`.slice(0, 500), dane: { koszt_usd: 0, zamowienie: zam.numer, rodzaj: zam.rodzaj } })
    return { typ: 'zamowienie', akcja: 'brak', lead_id: lead?.id ?? null, oferta_id: null, koszt_usd: 0, zamowienie: zam.numer, rodzaj: zam.rodzaj }
  }
  let ocena: AnalizaZamowienia | null = null
  let koszt = 0
  let zuzycie: unknown = null
  if (zam.adnotacja) {
    const ai = await claudeJson<AnalizaZamowienia>(systemAnalizyZamowienia(), userAnalizyZamowienia(zam), SCHEMA_ZAMOWIENIE, 'medium')
    ocena = ai.dane
    koszt = ai.koszt_usd
    zuzycie = ai.zuzycie
  }
  const nietypowe = !!ocena?.nietypowe
  const podsumowanie = nietypowe
    ? `${opisZam}. UWAGA: adnotacja klienta „${zam.adnotacja}” nie zgadza się z zamówieniem – ${ocena!.powod} Wyjaśnij z klientem przed realizacją.`
    : `${opisZam}. ${zam.adnotacja ? `Adnotacja klienta „${zam.adnotacja}” – bez uwag. ` : ''}Obsługuje Baselinker, nic do zrobienia w CRM.`
  const teraz = new Date().toISOString()
  await db.from('maile').update({
    typ: 'zamowienie', podsumowanie: podsumowanie.slice(0, 1000), nastepna_akcja: nietypowe ? 'dopytaj' : 'brak',
    analiza: { zamowienie: zam, ocena }, koszt_ai_usd: koszt || null, zuzycie_tokenow: zuzycie, lead_id: lead?.id ?? null,
  }).eq('id', mail.id)

  let leadId = lead?.id ?? null
  if (nietypowe) {
    const l = lead ?? await nowyLead(db, email, zam.klient ?? mail.od_nazwa, mail.id, 'formularz')
    leadId = l.id
    const zmiany: Record<string, unknown> = {
      ostatnia_rozmowa_at: mail.data ?? teraz,
      podsumowanie: podsumowanie.slice(0, 1000),
      // Tymek 24.11: bez zadań „oddzwoń” — nietypowe zamówienie to zadanie „dopytaj” (wyjaśnić z klientem przed realizacją)
      nastepna_akcja: 'dopytaj',
      nastepny_krok: await terminZBazy(db, 'dopytaj'),
      akcja_od: teraz,
      akcja_opis: `${OPISY_AKCJI.dopytaj} ${opisZam}: adnotacja „${zam.adnotacja}” – ${ocena!.powod} Wyjaśnij przed realizacją.`.slice(0, 500),
    }
    if (!l.nazwa && (zam.klient || mail.od_nazwa)) zmiany.nazwa = zam.klient ?? mail.od_nazwa
    if (!l.email) zmiany.email = email
    const tel = normalizujTelefon(zam.telefon)
    if (tel && !l.telefon) {
      const { data: zajety } = await db.from('leady').select('id').eq('telefon', tel).maybeSingle()
      if (!zajety) zmiany.telefon = tel
    }
    await db.from('leady').update(zmiany).eq('id', l.id)
    await db.from('maile').update({ lead_id: l.id }).eq('id', mail.id)
    await zdarzenie(db, { lead_id: l.id, mail_id: mail.id, typ: 'analiza', opis: `mail, zamowienie: ${podsumowanie}`.slice(0, 500), dane: { akcja: 'dopytaj', koszt_usd: koszt, zamowienie: zam.numer } })
  } else {
    if (lead) await db.from('leady').update({ ostatnia_rozmowa_at: mail.data ?? teraz }).eq('id', lead.id)
    await zdarzenie(db, { lead_id: leadId, mail_id: mail.id, typ: 'analiza', opis: `mail, zamowienie: ${podsumowanie}`.slice(0, 500), dane: { koszt_usd: koszt, zamowienie: zam.numer } })
  }

  await db.from('maile').update({ status_przetwarzania: 'przetworzony', blad: null }).eq('id', mail.id)
  return { typ: 'zamowienie', akcja: nietypowe ? 'dopytaj' : 'brak', lead_id: leadId, oferta_id: null, koszt_usd: Number(koszt.toFixed(4)), zamowienie: zam.numer, nietypowe }
}

async function leadPoId(db: SupabaseClient, id: string): Promise<Lead | null> {
  const { data } = await db.from('leady').select(POLA_LEADA).eq('id', id).maybeSingle()
  return (data as Lead | null) ?? null
}

async function leadPoEmailu(db: SupabaseClient, email: string): Promise<Lead | null> {
  const { data } = await db.from('leady').select(POLA_LEADA).ilike('email', email).order('created_at').limit(1).maybeSingle()
  return (data as Lead | null) ?? null
}

async function nowyLead(db: SupabaseClient, email: string, nazwa: string | null, mailId: string, zrodlo: 'mail' | 'formularz' = 'mail'): Promise<Lead> {
  const { data, error } = await db.from('leady').insert({ email, nazwa: nazwa || null, zrodlo, status: 'nowy' }).select(POLA_LEADA).single()
  if (error || !data) {
    const ponownie = await leadPoEmailu(db, email)
    if (ponownie) return ponownie
    throw new Error('Nie utworzono leada: ' + (error?.message ?? '?'))
  }
  await zdarzenie(db, { lead_id: data.id, mail_id: mailId, typ: 'lead_utworzony', opis: `Nowy lead z ${zrodlo === 'formularz' ? 'formularza kontaktowego' : 'maila'} ${email}` })
  return data as Lead
}

async function zdarzenie(db: SupabaseClient, z: { lead_id?: string | null; mail_id?: string; oferta_id?: string | null; typ: string; opis?: string; dane?: unknown }) {
  const { error } = await db.from('zdarzenia').insert({
    lead_id: z.lead_id ?? null, oferta_id: z.oferta_id ?? null, typ: z.typ, opis: z.opis ?? null,
    dane: { ...(typeof z.dane === 'object' && z.dane ? z.dane as Record<string, unknown> : {}), mail_id: z.mail_id ?? null },
  })
  if (error) console.error('zdarzenie:', error.message)
}
