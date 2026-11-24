// =====================================================================
// Dostęp do danych modułu „CRM Po Drzwi” (schemat `crm`, brief 14.11.2026).
// Wszystko przez supabase.schema('crm') — PostgREST musi mieć schemat `crm`
// na liście Exposed schemas, inaczej dostajemy PGRST106 (crmErrorFrom tłumaczy
// to na komunikat dla admina). RLS: osoba bez dostępu widzi puste wyniki.
// Frontend TYLKO czyta i zmienia status oferty (wyslana / przelicz); logikę
// ofert (nowa wersja po poprawce, mail, cena) robi Edge Function drugiej sesji.
// =====================================================================
import { supabase } from '../supabaseClient'
import type {
  CrmAlertTest,
  CrmEtykieta,
  CrmLead,
  CrmMail,
  CrmOferta,
  CrmPocztaTest,
  CrmPomocStrona,
  CrmPoprawkaRow,
  CrmRozmowa,
  CrmSkrzynka,
  CrmSprawdzenieSkrzynek,
  CrmUstawienie,
  CrmZasada,
  CrmZdarzenie,
} from '../types/crm'
import { CRM_AKCJA } from '../types/crm'
import { CRM_DOKUMENTY_BUCKET, CRM_EDGE_DOKUMENTY, CRM_EDGE_SZKIC, CRM_FOLLOW_UP_DAYS, CRM_LOGO_PATH, CRM_NAGRANIE_BUCKET, CRM_OPEN_STATUSES, CRM_PROBKI_STYLU_ILE } from '../types/crm'
import type { CrmDokument, CrmDokumentOdp, CrmDuplikat, CrmDuplikatLeada, CrmDzienWolny, CrmHistoriaWyslanych, CrmLicznik, CrmSzkic, CrmSzkicOdp, CrmMailOfertyOdp, CrmUsluga, CrmZamknijZadanie } from '../types/crm'
import { fnErrorMessage } from '../lib/fnError'
import { normalizePlPhone } from '../utils/crmPhone'
import { isoLocal } from '../utils/crmTermin'
import { fetchAllPages } from '../lib/fetchPaged'

const crm = () => supabase.schema('crm')

export type CrmError = {
  kind: 'schema_not_exposed' | 'no_access' | 'other' | 'duplikat'
  message: string
  /** 24.11: 'duplikat' — inny klient ma już ten telefon / e-mail; ekran proponuje połączenie (polacz_leady) */
  inny?: { id: string; nazwa: string | null; telefon: string | null; email: string | null; status: string }
}

export function crmErrorFrom(e: { code?: string; message?: string } | null | undefined): CrmError | null {
  if (!e) return null
  const code = String(e.code ?? '')
  if (code === 'PGRST106') {
    return {
      kind: 'schema_not_exposed',
      message:
        'Schemat „crm” nie jest wystawiony w API Supabase. Administrator: panel Supabase → Project Settings → Data API → Exposed schemas → dopisać „crm”.',
    }
  }
  if (code === '42501') return { kind: 'no_access', message: 'Brak dostępu do danych CRM Po Drzwi.' }
  return { kind: 'other', message: e.message || 'Nieznany błąd' }
}

const LEAD_EMBED = 'lead:leady(id, nazwa, miejscowosc, telefon, email, kategoria, status, nastepna_akcja, nastepny_krok, akcja_opis)'
const OFERTA_LIST_COLS =
  'id, lead_id, rozmowa_id, wersja, poprzednia_id, status, produkt, cena_razem, dostawa, dostawa_koszt, koszyk_zgodny, sprawdz, mail_do, wyslano_at, liczenie_od, uwagi, created_at, updated_at, rodzaj, numer, brutto, netto, vat_stawka, plik_pdf, konfiguracja_plik, konfiguracja_pliki, z_montazem, streszczenie, nazwa'

type Result<T> = { data: T; error: CrmError | null }

export async function fetchOferty(onlyOpen: boolean): Promise<Result<CrmOferta[]>> {
  let q = crm()
    .from('oferty')
    .select(`${OFERTA_LIST_COLS}, ${LEAD_EMBED}`)
    .order('created_at', { ascending: false })
    .limit(300)
  if (onlyOpen) q = q.in('status', [...CRM_OPEN_STATUSES])
  const { data, error } = await q
  return { data: (data ?? []) as unknown as CrmOferta[], error: crmErrorFrom(error) }
}

export async function fetchOferta(id: string): Promise<Result<CrmOferta | null>> {
  const { data, error } = await crm().from('oferty').select('*, lead:leady(*)').eq('id', id).maybeSingle()
  return { data: (data ?? null) as unknown as CrmOferta | null, error: crmErrorFrom(error) }
}

/** Wszystkie wersje ofert leada (łańcuch poprzednia_id układamy po stronie widoku). */
export async function fetchOfertyLeada(leadId: string): Promise<Result<CrmOferta[]>> {
  const { data, error } = await crm()
    .from('oferty')
    .select(OFERTA_LIST_COLS)
    .eq('lead_id', leadId)
    .order('wersja', { ascending: true })
    .order('created_at', { ascending: true })
  return { data: (data ?? []) as unknown as CrmOferta[], error: crmErrorFrom(error) }
}

export async function fetchZdarzenia(filter: { ofertaId?: string; leadId?: string }): Promise<Result<CrmZdarzenie[]>> {
  // 500 NAJNOWSZYCH (malejąco + odwrócenie) — rosnąco z limitem przy bogatej historii ucinało najświeższe zdarzenia
  let q = crm().from('zdarzenia').select('*').order('created_at', { ascending: false }).limit(500)
  if (filter.ofertaId) q = q.eq('oferta_id', filter.ofertaId)
  else if (filter.leadId) q = q.eq('lead_id', filter.leadId)
  const { data, error } = await q
  return { data: ((data ?? []) as unknown as CrmZdarzenie[]).reverse(), error: crmErrorFrom(error) }
}

export async function fetchLead(id: string): Promise<Result<CrmLead | null>> {
  const { data, error } = await crm().from('leady').select('*').eq('id', id).maybeSingle()
  return { data: (data ?? null) as unknown as CrmLead | null, error: crmErrorFrom(error) }
}

export async function fetchRozmowy(leadId: string): Promise<Result<CrmRozmowa[]>> {
  const { data, error } = await crm()
    .from('rozmowy')
    .select('*')
    .eq('lead_id', leadId)
    .order('data_rozmowy', { ascending: false, nullsFirst: false })
  return { data: (data ?? []) as unknown as CrmRozmowa[], error: crmErrorFrom(error) }
}

const isoDatePlusDays = (days: number): string => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return isoLocal(d) // lokalna data (toISOString = UTC, po północy dawał wczoraj)
}

/**
 * „Wysłane”: status=wyslana, wyslano_at=now(), sprawdzil=ja + zdarzenie `wyslano`.
 * Pilot (brief pkt 6): frontend czyści akcję na leadzie i ustawia follow_up za 3 dni.
 */
/** error = status oferty się nie zmienił; bezFollowUpu = oferta wysłana, ale zadanie follow-up nie zapisało się (zwiad 21.11 — wcześniej tylko console.warn, a toast obiecywał follow-up) */
export async function markOfertaWyslana(oferta: CrmOferta, userId: string): Promise<{ error: CrmError | null; bezFollowUpu?: string }> {
  const { error } = await crm()
    .from('oferty')
    .update({ status: 'wyslana', wyslano_at: new Date().toISOString(), sprawdzil: userId })
    .eq('id', oferta.id)
  if (error) return { error: crmErrorFrom(error) }
  const { error: zErr } = await crm().from('zdarzenia').insert({
    lead_id: oferta.lead_id,
    oferta_id: oferta.id,
    typ: 'wyslano',
    opis: `Mail do ${oferta.mail_do || 'klienta'} wysłany przez handlowca (z aplikacji)`,
    kto: userId,
  })
  // zdarzenie to historia, nie blokujemy na nim — status już zmieniony
  if (zErr) console.warn('crm.zdarzenia wyslano:', zErr.message)
  if (oferta.lead_id) {
    const cena = oferta.cena_razem != null ? ` (${Math.round(Number(oferta.cena_razem))} zł)` : ''
    const { error: lErr } = await crm()
      .from('leady')
      .update({
        nastepna_akcja: 'follow_up',
        nastepny_krok: isoDatePlusDays(CRM_FOLLOW_UP_DAYS),
        akcja_opis: `Follow-up po ofercie v${oferta.wersja}${cena}: zapytaj, czy klient podjął decyzję.`,
        akcja_od: new Date().toISOString(),
      })
      .eq('id', oferta.lead_id)
    if (lErr) {
      console.warn('crm.leady follow_up:', lErr.message)
      return { error: null, bezFollowUpu: lErr.message }
    }
  }
  return { error: null }
}

/** „Przelicz”: poprawka=tekst, status=przelicz. Nową wersję tworzy backend (trigger → crm-oferta). */
export async function requestOfertaPrzelicz(oferta: CrmOferta, poprawka: string, userId?: string | null): Promise<CrmError | null> {
  // 24.11 (Tymek): handlowiec = kto zlecił — crm-oferta pisze mail w jego stylu, nie domyślnej Magdaleny
  const { error } = await crm().from('oferty').update({ poprawka, status: 'przelicz', ...(userId ? { handlowiec: userId } : {}) }).eq('id', oferta.id)
  return crmErrorFrom(error)
}

/** Ponowienie po „BŁĄD systemu”: ten sam update statusu, poprawka bez zmian. */
/** Handlowiec przeczytał ustalenia z rozmowy / maila i chce policzyć ofertę (status wstrzymana → przelicz). */
export async function zlecOferteWstrzymana(ofertaId: string): Promise<CrmError | null> {
  const { error } = await crm().rpc('zlec_oferte_wstrzymana', { p_oferta_id: ofertaId })
  return crmErrorFrom(error)
}

/**
 * 21.11 (oferta v2): poprawka ustaleń PRZED pierwszym liczeniem (status wstrzymana). crm-oferta przy świeżej
 * ofercie czyta oferty.analiza (całość idzie do promptu doboru i maila), a nie pole poprawka — więc dopisujemy
 * „poprawka_handlowca” do analizy tej oferty i zlecamy liczenie jak „Ustalenia OK”.
 */
export async function poprawUstaleniaIPolicz(oferta: CrmOferta, tekst: string): Promise<CrmError | null> {
  const t = tekst.trim()
  if (!t) return { kind: 'other', message: 'Wpisz, co poprawić' }
  if (!oferta.analiza || typeof oferta.analiza !== 'object') return { kind: 'other', message: 'Ta oferta nie ma zapisanych ustaleń — popraw notatkę na karcie klienta i zleć ofertę stamtąd' }
  const poprzednia = typeof (oferta.analiza as Record<string, unknown>).poprawka_handlowca === 'string' ? String((oferta.analiza as Record<string, unknown>).poprawka_handlowca) : ''
  const analiza = { ...(oferta.analiza as Record<string, unknown>), poprawka_handlowca: poprzednia ? `${poprzednia}\n${t}` : t }
  const { error } = await crm().from('oferty').update({ analiza }).eq('id', oferta.id).eq('status', 'wstrzymana')
  if (error) return crmErrorFrom(error)
  return zlecOferteWstrzymana(oferta.id)
}

export async function retryOfertaPrzelicz(oferta: CrmOferta, userId?: string | null): Promise<CrmError | null> {
  const { error } = await crm().from('oferty').update({ status: 'przelicz', ...(userId ? { handlowiec: userId } : {}) }).eq('id', oferta.id)
  return crmErrorFrom(error)
}

/**
 * 24.11 (Tymek, Perzanowski): system nie dobrał produktu i zadał pytania (oferty.pytania). Odpowiedzi handlowca
 * dopisujemy do oferty.analiza.odpowiedzi_handlowca (cała analiza idzie do promptu doboru, prefiltr szuka w nich linii
 * i wzoru) i zlecamy liczenie od nowa (status przelicz → trigger → crm-oferta). Tylko oferta w do_sprawdzenia.
 */
export async function odpowiedzIPolicz(oferta: CrmOferta, tekst: string, userId: string | null): Promise<CrmError | null> {
  const t = tekst.trim()
  if (!t) return { kind: 'other', message: 'Odpowiedz przynajmniej na jedno pytanie' }
  if (!oferta.analiza || typeof oferta.analiza !== 'object') return { kind: 'other', message: 'Ta oferta nie ma zapisanych ustaleń — zleć ofertę od nowa z karty klienta' }
  const poprzednie = typeof oferta.analiza.odpowiedzi_handlowca === 'string' ? oferta.analiza.odpowiedzi_handlowca : ''
  const analiza = { ...oferta.analiza, odpowiedzi_handlowca: poprzednie ? `${poprzednie}\n${t}` : t }
  const { data, error } = await crm().from('oferty').update({ analiza, status: 'przelicz', liczenie_od: null, ...(userId ? { handlowiec: userId } : {}) }).eq('id', oferta.id).eq('status', 'do_sprawdzenia').select('id')
  if (error) return crmErrorFrom(error)
  if (!data?.length) return { kind: 'other', message: 'Ta oferta nie czeka już na odpowiedzi (ktoś ją właśnie przeliczył albo zmienił)' }
  const { error: zErr } = await crm().from('zdarzenia').insert({
    lead_id: oferta.lead_id, oferta_id: oferta.id, typ: 'oferta_zlecona', kto: userId,
    opis: `Handlowiec odpowiedział na pytania systemu — oferta liczy się od nowa: ${t.slice(0, 300)}`,
    dane: { zrodlo: 'klik', odpowiedzi: t },
  })
  if (zErr) console.warn('crm.zdarzenia oferta_zlecona:', zErr.message)
  return null
}

// ---- Zadania handlowca = kolumny na leadzie (brief pkt 6) ----

export type CrmZadanieRow = CrmLead & {
  /** aktywna oferta leada (przelicz / do_sprawdzenia), jeśli jest */
  oferta?: Pick<CrmOferta, 'id' | 'status' | 'wersja' | 'cena_razem' | 'liczenie_od' | 'nazwa'> | null
}

export async function fetchZadania(): Promise<Result<CrmZadanieRow[]>> {
  const { data, error } = await crm()
    .from('leady')
    .select('*')
    .not('nastepna_akcja', 'is', null)
    .order('nastepny_krok', { ascending: true, nullsFirst: false })
    .order('akcja_od', { ascending: true })
    .limit(300)
  if (error) return { data: [], error: crmErrorFrom(error) }
  const leads = (data ?? []) as unknown as CrmLead[]
  const ids = leads.map((l) => l.id)
  const byLead = new Map<string, CrmZadanieRow['oferta']>()
  if (ids.length > 0) {
    const { data: ofs } = await crm()
      .from('oferty')
      .select('id, lead_id, status, wersja, cena_razem, liczenie_od, nazwa')
      .in('lead_id', ids)
      .in('status', [...CRM_OPEN_STATUSES])
      .order('wersja', { ascending: false })
    for (const o of (ofs ?? []) as Array<{ id: string; lead_id: string; status: string; wersja: number; cena_razem: number | null; liczenie_od: string | null; nazwa: string | null }>) {
      if (!byLead.has(o.lead_id)) byLead.set(o.lead_id, o)
    }
  }
  return { data: leads.map((l) => ({ ...l, oferta: byLead.get(l.id) ?? null })), error: null }
}

/** „Zrobione”: czyści akcję na leadzie + zdarzenie zadanie_zrobione. */
export async function markZadanieZrobione(lead: CrmLead, userId: string): Promise<CrmError | null> {
  const { error } = await crm()
    .from('leady')
    .update({ nastepna_akcja: null, nastepny_krok: null, akcja_opis: null })
    .eq('id', lead.id)
  if (error) return crmErrorFrom(error)
  // dane.zrodlo='klik' — ingest zamyka „oddzwon” sam po rozmowie wychodzącej z Ringostatu
  // (zrodlo='ringostat'); historia rozróżnia oba
  const { error: zErr } = await crm().from('zdarzenia').insert({
    lead_id: lead.id,
    typ: 'zadanie_zrobione',
    opis: `${lead.nastepna_akcja ?? 'zadanie'}: ${lead.akcja_opis ?? ''}`.trim(),
    dane: { zrodlo: 'klik', akcja: lead.nastepna_akcja },
    kto: userId,
  })
  if (zErr) console.warn('crm.zdarzenia zadanie_zrobione:', zErr.message)
  return null
}

/**
 * „Zrobione” z następnym krokiem (brief pkt 20): rpc crm.zamknij_zadanie sam zapisuje zdarzenie zadanie_zrobione,
 * ustawia następne zadanie (nastepna_akcja + termin za N dni + opis) i przy wyslano_oferte status klienta 'oferta'.
 * Z nastepna_akcja=null zamyka bez kolejnego kroku; na kliencie bez zadania po prostu ustawia nowe („Dodaj zadanie”).
 */
/** Wynik klienta (brief pkt 31): 'w_grze' = „Przywróć do gry”. */
export type CrmWynik = 'wygrany' | 'przegrany' | 'w_grze'

/**
 * rpc crm.oznacz_wynik: status leada + powód/notatka/kto/kiedy, zamyka zadanie, oferta → zaakceptowana
 * (wygrany) albo wysłane → odrzucona (przegrany), zdarzenie do historii. Przywrócenie stawia nowe zadanie.
 */
export async function oznaczWynik(
  leadId: string,
  wynik: CrmWynik,
  opts: { powod?: string | null; notatka?: string | null; ofertaId?: string | null } = {},
): Promise<CrmError | null> {
  const { error } = await crm().rpc('oznacz_wynik', {
    p_lead_id: leadId,
    p_wynik: wynik,
    p_powod: opts.powod ?? null,
    p_notatka: opts.notatka?.trim() || null,
    p_oferta_id: opts.ofertaId ?? null,
  })
  // funkcji nie ma w bazie (np. stara baza testowa) — nic nie zapisujemy bokiem
  if (error && error.code === 'PGRST202') {
    return { kind: 'other', message: 'Oznaczanie wyniku czeka jeszcze na aktualizację bazy CRM — spróbuj za chwilę.' }
  }
  // pozostałe błędy serwer zwraca jako wyjątki po polsku (brak powodu, notatka przy „inne”, oferta innego klienta) — pokazujemy wprost
  if (error) return { kind: 'other', message: error.message || 'Nie udało się zapisać wyniku' }
  return null
}

/**
 * #167 (23.11): lejek Nowy → „Ma ofertę” ręcznie — oferta poszła poza systemem (mail z Outlooka, PDF
 * z LiczOkno). Rpc dopisuje zdarzenie „oferta wysłana poza systemem” i ustawia status 'oferta';
 * zadanie klienta zostaje. Zamknięty klient (zamówił / przegrany) → wyjątek po polsku z serwera.
 */
export async function oznaczOfertePozaSystemem(leadId: string, notatka?: string | null): Promise<CrmError | null> {
  const { error } = await crm().rpc('oznacz_oferte_poza_systemem', { p_lead_id: leadId, p_notatka: notatka?.trim() || null })
  if (error && error.code === 'PGRST202') return { kind: 'other', message: 'Ta funkcja czeka jeszcze na aktualizację bazy CRM — spróbuj za chwilę.' }
  if (error) return { kind: 'other', message: error.message || 'Nie udało się oznaczyć oferty' }
  return null
}

export async function zamknijZadanie(leadId: string, z: CrmZamknijZadanie): Promise<CrmError | null> {
  const { error } = await crm().rpc('zamknij_zadanie', {
    p_lead_id: leadId,
    p_nastepna_akcja: z.nastepna_akcja,
    p_za_dni: z.za_dni,
    p_opis: z.opis?.trim() || null,
    p_wyslano_oferte: z.wyslano_oferte,
  })
  if (error) return crmErrorFrom(error)
  // konkretna data z kalendarza: rpc liczy dziś+za_dni po czasie serwera (UTC), więc dopinamy dokładny termin;
  // trigger leady_termin_roboczy sam przesunie weekend/święto
  if (z.nastepna_akcja && z.termin) {
    const { error: e2 } = await crm().from('leady').update({ nastepny_krok: z.termin }).eq('id', leadId)
    if (e2) return crmErrorFrom(e2)
  }
  return null
}

// ---- Kontakty (brief pkt 20): wszyscy klienci + ostatnia oferta ----

// ── Usuwanie (zgłoszenie #142, Tymek 16.11): klient, oferta, zadanie ──────────
// RLS: leady/oferty = ALL dla osób z dostępem do CRM; FK kaskadowe (oferty, rozmowy,
// zdarzenia, dokumenty) sprzątają resztę, maile zostają bez lead_id. Pliki PDF z bucketu
// crm-dokumenty usuwamy najlepiej jak się da (błąd pliku nie blokuje usunięcia rekordu).
async function removeCrmFiles(paths: Array<string | null | undefined>): Promise<void> {
  const list = paths.filter((p): p is string => !!p && p.trim().length > 0)
  if (list.length === 0) return
  const { error } = await supabase.storage.from('crm-dokumenty').remove(list)
  if (error) console.warn('[CRM] nie usunięto plików:', error.message)
}

/** Usuwa klienta razem z ofertami, rozmowami, historią i dokumentami. Nieodwracalne. */
export async function deleteLead(id: string): Promise<CrmError | null> {
  const [{ data: of }, { data: dk }] = await Promise.all([
    crm().from('oferty').select('plik_pdf').eq('lead_id', id),
    crm().from('dokumenty').select('plik_pdf').eq('lead_id', id),
  ])
  await removeCrmFiles([...(of ?? []), ...(dk ?? [])].map((r) => (r as { plik_pdf: string | null }).plik_pdf))
  const { error } = await crm().from('leady').delete().eq('id', id)
  return crmErrorFrom(error)
}

/** Usuwa jedną ofertę (i jej zdarzenia); dokumenty i maile tracą tylko powiązanie. */
/** 21.11: tytuł oferty (null = podpowiedź). Oferta PDF: wszystkie wersje z tym samym numerem; zdarzenie w historii klienta. */
export async function nazwijOferte(oferta: Pick<CrmOferta, 'id' | 'lead_id' | 'numer' | 'rodzaj' | 'nazwa'>, nazwa: string | null, userId: string): Promise<CrmError | null> {
  const n = nazwa?.trim() ? nazwa.trim().slice(0, 120) : null
  let q = crm().from('oferty').update({ nazwa: n })
  q = oferta.rodzaj === 'oficjalna' && oferta.numer && oferta.lead_id ? q.eq('lead_id', oferta.lead_id).eq('numer', oferta.numer) : q.eq('id', oferta.id)
  const { error } = await q
  if (error) return crmErrorFrom(error)
  if (oferta.lead_id) {
    await crm().from('zdarzenia').insert({
      lead_id: oferta.lead_id,
      oferta_id: oferta.id,
      typ: 'oferta_nazwa',
      opis: n ? `Tytuł oferty: „${n}”${oferta.nazwa ? ` (było „${oferta.nazwa}”)` : ''}` : 'Usunięto tytuł oferty',
      kto: userId,
      dane: { zrodlo: 'klik', z: oferta.nazwa ?? null, na: n },
    })
  }
  return null
}

export async function deleteOferta(oferta: Pick<CrmOferta, 'id' | 'plik_pdf'>): Promise<CrmError | null> {
  await removeCrmFiles([oferta.plik_pdf])
  const { error } = await crm().from('oferty').delete().eq('id', oferta.id)
  return crmErrorFrom(error)
}

/** Zmienia zadanie (typ / termin / opis) bez oznaczania „zrobione” — termin przelicza trigger dni roboczych. */
export async function edytujZadanie(lead: CrmLead, z: CrmZamknijZadanie, userId: string): Promise<CrmError | null> {
  if (!z.nastepna_akcja) return { kind: 'other', message: 'Wybierz rodzaj zadania' }
  const dzis = new Date()
  const termin = new Date(dzis.getFullYear(), dzis.getMonth(), dzis.getDate() + Math.max(0, z.za_dni))
  const terminIso = z.termin || `${termin.getFullYear()}-${String(termin.getMonth() + 1).padStart(2, '0')}-${String(termin.getDate()).padStart(2, '0')}`
  const opis = `${CRM_AKCJA[z.nastepna_akcja]?.hint ?? ''}${z.opis ? ` ${z.opis}` : ''}`.trim().slice(0, 500)
  const { error } = await crm().from('leady').update({ nastepna_akcja: z.nastepna_akcja, nastepny_krok: terminIso, akcja_opis: opis || null, akcja_od: new Date().toISOString() }).eq('id', lead.id)
  if (error) return crmErrorFrom(error)
  await crm().from('zdarzenia').insert({
    lead_id: lead.id,
    typ: 'zadanie_zmienione',
    opis: `Zmieniono zadanie: ${lead.nastepna_akcja ?? '—'} → ${z.nastepna_akcja}, termin ${terminIso}${z.opis ? ` · ${z.opis}` : ''}`.slice(0, 500),
    kto: userId,
    dane: { zrodlo: 'klik', z: lead.nastepna_akcja, na: z.nastepna_akcja },
  })
  return null
}

/** #162: ręczna wartość klienta (null = wróć do kwoty z oferty); ślad w historii: wartosc_zmieniona (kto i kiedy). */
export async function ustawWartoscKlienta(lead: CrmLead, kwota: number | null, userId: string): Promise<CrmError | null> {
  const { error } = await crm().from('leady').update({ wartosc_szac: kwota }).eq('id', lead.id)
  if (error) return crmErrorFrom(error)
  const fmt = (v: number | null) =>
    v == null ? '—' : `${Number(v).toLocaleString('pl-PL', Number.isInteger(Number(v)) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`
  await crm().from('zdarzenia').insert({
    lead_id: lead.id,
    typ: 'wartosc_zmieniona',
    opis: kwota == null ? `Usunięto wartość wpisaną ręcznie (${fmt(lead.wartosc_szac)}) — liczy się kwota z oferty` : `Wartość klienta wpisana ręcznie: ${fmt(kwota)}${lead.wartosc_szac != null ? ` (było ${fmt(lead.wartosc_szac)})` : ''}`,
    kto: userId,
    dane: { zrodlo: 'klik', z: lead.wartosc_szac, na: kwota },
  })
  return null
}

/** Zdejmuje zadanie z klienta bez oznaczania „zrobione” (ślad w historii: zadanie_usuniete). */
export async function usunZadanie(lead: CrmLead, userId: string): Promise<CrmError | null> {
  const { error } = await crm().from('leady').update({ nastepna_akcja: null, nastepny_krok: null, akcja_opis: null, akcja_od: null }).eq('id', lead.id)
  if (error) return crmErrorFrom(error)
  await crm().from('zdarzenia').insert({
    lead_id: lead.id,
    typ: 'zadanie_usuniete',
    opis: `Usunięto zadanie: ${lead.nastepna_akcja ?? ''} ${lead.akcja_opis ?? ''}`.trim(),
    kto: userId,
    dane: { zrodlo: 'klik', akcja: lead.nastepna_akcja },
  })
  return null
}

export type CrmKontaktRow = CrmLead & {
  ostatnia_oferta?: Pick<CrmOferta, 'id' | 'status' | 'wersja' | 'cena_razem' | 'rodzaj' | 'numer' | 'brutto' | 'created_at' | 'nazwa'> | null
}

/** Statystyki CRM (21.11): wysłane oferty z kwotą i datą wysłania (do 5000). */
export async function fetchOfertyWyslane(): Promise<Result<Array<{ lead_id: string | null; wyslano_at: string | null; rodzaj: string | null; brutto: number | null; cena_razem: number | null }>>> {
  // porcjami po 1000 — PostgREST ucina odpowiedź do 1000 wierszy, .limit(5000) po cichu dawał 1000 (zwiad 21.11)
  const { data, error } = await fetchAllPages<{ lead_id: string | null; wyslano_at: string | null; rodzaj: string | null; brutto: number | null; cena_razem: number | null }>(
    (from, to) => crm().from('oferty').select('lead_id, wyslano_at, rodzaj, brutto, cena_razem').not('wyslano_at', 'is', null).order('wyslano_at', { ascending: false }).order('id', { ascending: false }).range(from, to),
    { max: 5000 },
  )
  return { data: (data ?? []) as Array<{ lead_id: string | null; wyslano_at: string | null; rodzaj: string | null; brutto: number | null; cena_razem: number | null }>, error: crmErrorFrom(error) }
}

export async function fetchKontakty(): Promise<Result<CrmKontaktRow[]>> {
  const { data, error } = await fetchAllPages<CrmLead>(
    (from, to) => crm().from('leady').select('*').order('updated_at', { ascending: false }).order('id', { ascending: false }).range(from, to).overrideTypes<CrmLead[], { merge: false }>(),
    { max: 5000 },
  )
  if (error) return { data: [], error: crmErrorFrom(error) }
  const leads = (data ?? []) as unknown as CrmLead[]
  const byLead = new Map<string, CrmKontaktRow['ostatnia_oferta']>()
  // ostatnia oferta per klient (najnowsza wersja, każdy status) — jedno zapytanie, porcjami po 200 id
  const ids = leads.map((l) => l.id)
  for (let i = 0; i < ids.length; i += 200) {
    const { data: ofs } = await crm()
      .from('oferty')
      .select('id, lead_id, status, wersja, cena_razem, rodzaj, numer, brutto, created_at, nazwa')
      .in('lead_id', ids.slice(i, i + 200))
      .neq('status', 'robocza')
      .order('created_at', { ascending: false })
    for (const o of (ofs ?? []) as Array<NonNullable<CrmKontaktRow['ostatnia_oferta']> & { lead_id: string }>) {
      if (!byLead.has(o.lead_id)) byLead.set(o.lead_id, o)
    }
  }
  return { data: leads.map((l) => ({ ...l, ostatnia_oferta: byLead.get(l.id) ?? null })), error: null }
}

/** Dane kontaktowe klienta (karta klienta, edycja): telefon normalizowany do +48…, 23505 = numer już jest u innego klienta. */
export async function updateLeadDane(id: string, d: { nazwa: string; telefon: string; email: string; miejscowosc: string; profil_social?: string }): Promise<CrmError | null> {
  const telefon = d.telefon.trim() ? normalizePlPhone(d.telefon) : null
  if (d.telefon.trim() && !telefon) return { kind: 'other', message: 'Nieprawidłowy numer telefonu — wpisz 9 cyfr albo z prefiksem +48.' }
  const email = d.email.trim().toLowerCase() || null
  const profil_social = (d.profil_social ?? '').trim() || null
  // #166: klient z Facebooka/Instagrama może mieć tylko profil
  if (!telefon && !email && !profil_social) return { kind: 'other', message: 'Klient musi mieć telefon, e-mail albo profil (Facebook / Instagram).' }
  // 24.11 (Tymek): ten sam telefon / e-mail ma już inny klient (np. zamówienie ze sklepu założyło drugi wpis) —
  // zamiast suchego błędu zwracamy 'duplikat' z danymi tamtego klienta, a ekran proponuje połączenie obu w jednego
  const warunki: string[] = []
  if (telefon) warunki.push(`telefon.eq.${telefon}`)
  if (email) warunki.push(`email.ilike.${email}`)
  if (warunki.length) {
    const { data: inni } = await crm().from('leady').select('id, nazwa, telefon, email, status').neq('id', id).or(warunki.join(',')).limit(1)
    const inny = (inni?.[0] ?? null) as CrmError['inny'] | null
    if (inny) {
      const czym = telefon && inny.telefon === telefon ? `numer ${telefon}` : `adres ${email}`
      return { kind: 'duplikat', message: `Ten ${czym} ma już klient „${inny.nazwa || inny.telefon || inny.email || '?'}”.`, inny }
    }
  }
  const { error } = await crm()
    .from('leady')
    .update({ nazwa: d.nazwa.trim() || null, telefon, email, miejscowosc: d.miejscowosc.trim() || null, profil_social })
    .eq('id', id)
  if (error?.code === '23505') return { kind: 'other', message: 'Inny klient ma już ten numer telefonu.' }
  return crmErrorFrom(error)
}

// ---- Oferta oficjalna z montażem, PDF (brief pkt 21) ----

/** brief pkt 29: rpc przyjmuje maks. 10 plików, crm-oferta-pdf czyta razem do 20 MB */
export const KONFIGURACJA_MAX_PLIKOW = 10
export const KONFIGURACJA_MAX_MB_RAZEM = 20

/** Wszystkie pliki konfiguracji oferty (pkt 29); starsze wiersze mają tylko konfiguracja_plik. */
export function konfiguracjaPliki(o: Pick<CrmOferta, 'konfiguracja_plik' | 'konfiguracja_pliki'>): string[] {
  const lista = Array.isArray(o.konfiguracja_pliki) ? o.konfiguracja_pliki.filter(Boolean) : []
  if (lista.length) return lista
  return o.konfiguracja_plik ? [o.konfiguracja_plik] : []
}

export type OfertaOficjalnaForm = {
  /** brief pkt 29 (#160): kilka plików naraz (w tym zrzuty wklejone Ctrl+V); razem z tekstem */
  konfiguracja_pliki: File[]
  konfiguracja_tekst: string
  producent: string
  uslugi: CrmUsluga[]
  zakres: string
  z_montazem: boolean
  lokal_mieszkalny: boolean | null
  rodzaj_lokalu: string
  powierzchnia_m2: string
}

/**
 * Upload plików z konfiguratora (PDF/JPG/PNG/WEBP/GIF) do crm-dokumenty + rpc zlec_oferte_oficjalna
 * → id oferty (po ~20–40 s do_sprawdzenia). Pkt 29: wiele plików + tekst razem; p_konfiguracja_plik
 * = pierwszy (zgodność), p_konfiguracja_pliki = wszystkie.
 */
export async function zlecOferteOficjalna(leadId: string, f: OfertaOficjalnaForm): Promise<Result<string | null>> {
  const pliki = f.konfiguracja_pliki.slice(0, KONFIGURACJA_MAX_PLIKOW)
  const sciezki: string[] = []
  const stamp = Date.now()
  for (let i = 0; i < pliki.length; i++) {
    const file = pliki[i]
    const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf'
    const sciezka = `${leadId}/konfiguracja-${stamp}-${i}.${ext}`
    const up = await supabase.storage.from(CRM_DOKUMENTY_BUCKET).upload(sciezka, file, { contentType: file.type || undefined, upsert: false })
    if (up.error) {
      // nie zostawiamy osieroconych plików z tej próby
      if (sciezki.length) await supabase.storage.from(CRM_DOKUMENTY_BUCKET).remove(sciezki)
      return { data: null, error: { kind: 'other', message: `Nie udało się wgrać pliku „${file.name}”: ${up.error.message}` } }
    }
    sciezki.push(sciezka)
  }
  const tekst = f.konfiguracja_tekst.trim() || null
  if (!sciezki.length && !tekst) return { data: null, error: { kind: 'other', message: 'Dodaj plik z konfiguratora albo wklej treść konfiguracji.' } }
  const m2 = f.powierzchnia_m2.trim() ? Number(f.powierzchnia_m2.replace(',', '.')) : null
  const { data, error } = await crm().rpc('zlec_oferte_oficjalna', {
    p_lead_id: leadId,
    p_konfiguracja_plik: sciezki[0] ?? null,
    p_konfiguracja_tekst: tekst,
    p_uslugi: f.uslugi.filter((u) => u.nazwa.trim()).map((u) => ({ nazwa: u.nazwa.trim(), netto: Number(u.netto) || 0 })),
    p_zakres: f.zakres.trim() || null,
    p_z_montazem: f.z_montazem,
    p_lokal_mieszkalny: f.lokal_mieszkalny,
    p_rodzaj_lokalu: f.rodzaj_lokalu || null,
    p_powierzchnia_m2: m2 != null && Number.isFinite(m2) ? m2 : null,
    p_producent: f.producent.trim() || null,
    p_konfiguracja_pliki: sciezki,
  })
  return { data: (data as string | null) ?? null, error: crmErrorFrom(error) }
}

/** Link do pobrania dokumentu z prywatnego bucketu crm-dokumenty (PDF oferty, plik konfiguracji), ważny 10 min. */
export async function signedUrlDokument(sciezka: string): Promise<Result<string | null>> {
  const { data, error } = await supabase.storage.from(CRM_DOKUMENTY_BUCKET).createSignedUrl(sciezka, 600)
  return { data: data?.signedUrl ?? null, error: error ? { kind: 'other', message: error.message } : null }
}

/** Logo do nagłówka PDF (superadmin): zawsze pod szablon/logo.png, nadpisanie. */
export async function uploadLogo(file: File): Promise<CrmError | null> {
  const { error } = await supabase.storage.from(CRM_DOKUMENTY_BUCKET).upload(CRM_LOGO_PATH, file, { contentType: 'image/png', upsert: true })
  return error ? { kind: 'other', message: error.message } : null
}

// ---- Dokumenty klienta (brief pkt 22): karta pomiarowa / umowa / protokół ----

export async function fetchDokumenty(leadId: string): Promise<Result<CrmDokument[]>> {
  const { data, error } = await crm().from('dokumenty').select('*').eq('lead_id', leadId).order('created_at', { ascending: false })
  return { data: (data ?? []) as unknown as CrmDokument[], error: crmErrorFrom(error) }
}

/** RLS: aplikacja zmienia w crm.dokumenty TYLKO status (np. umowa → wyslana po Autenti, → podpisana po podpisie) */
export async function updateDokumentStatus(id: string, status: string): Promise<CrmError | null> {
  const { error } = await crm().from('dokumenty').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
  return crmErrorFrom(error)
}

export type GenerujDokument = {
  rodzaj: 'karta_pomiarowa' | 'umowa' | 'protokol'
  lead_id: string
  /** umowa: oferta oficjalna z montażem */
  oferta_id?: string
  /** regeneracja istniejącego dokumentu (umowa zachowuje numer); protokół: id umowy */
  dokument_id?: string
  dane: Record<string, unknown>
}

/**
 * Wywołanie Edge Function crm-dokumenty: synchronicznie (kilka sekund, zimny start do ~1 min),
 * z JWT użytkownika. 400 = brak danych („Brakuje: …”) — tekst błędu pokazujemy jak jest.
 */
export async function generujDokument(req: GenerujDokument): Promise<Result<CrmDokumentOdp | null>> {
  const { data: auth } = await supabase.auth.getUser()
  const body = { akcja: 'dokument', ...req, user_id: auth.user?.id ?? null }
  try {
    const { data, error } = await supabase.functions.invoke<CrmDokumentOdp>(CRM_EDGE_DOKUMENTY, { body })
    if (error) return { data: null, error: { kind: 'other', message: await fnErrorMessage(error, 'Funkcja crm-dokumenty nie odpowiada') } }
    if (!data?.ok || !data.dokument_id) return { data: null, error: { kind: 'other', message: (data as { error?: string } | null)?.error ?? 'Pusta odpowiedź funkcji crm-dokumenty' } }
    return { data, error: null }
  } catch (e) {
    return { data: null, error: { kind: 'other', message: e instanceof Error ? e.message : String(e) } }
  }
}

export async function fetchLiczniki(): Promise<Result<CrmLicznik[]>> {
  const { data, error } = await crm().from('liczniki').select('*').order('klucz')
  return { data: (data ?? []) as unknown as CrmLicznik[], error: crmErrorFrom(error) }
}

/** Numer startowy ofert: wartość = ostatni UŻYTY numer (następna oferta dostanie +1). */
export async function saveLicznik(klucz: string, wartosc: number): Promise<CrmError | null> {
  const { error } = await crm().from('liczniki').upsert({ klucz, wartosc, updated_at: new Date().toISOString() }, { onConflict: 'klucz' })
  return crmErrorFrom(error)
}

/** Rozmowy, których system nie przetworzył (sekcja „Błędy systemu”, tylko superadmin). */
export type CrmBladRozmowy = CrmRozmowa & {
  lead?: Pick<CrmLead, 'id' | 'nazwa' | 'telefon'> | null
  /** licznik ponowień z pg_cron (rozmowy.raw._proby, maks. 6) */
  proby?: string | null
}

export async function fetchBledyRozmow(): Promise<Result<CrmBladRozmowy[]>> {
  const { data, error } = await crm()
    .from('rozmowy')
    .select('id, lead_id, data_rozmowy, created_at, kierunek, czas_s, numer_dzwoniacego, status_przetwarzania, blad, proby:raw->>_proby, lead:leady(id, nazwa, telefon)')
    .eq('status_przetwarzania', 'blad')
    .order('data_rozmowy', { ascending: false, nullsFirst: false })
    .limit(50)
  return { data: (data ?? []) as unknown as CrmBladRozmowy[], error: crmErrorFrom(error) }
}

/** Imiona do kolumny „kto” w historii (profiles, schemat public). */
export async function fetchProfileNames(ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))]
  const out = new Map<string, string>()
  if (uniq.length === 0) return out
  const { data } = await supabase.from('profiles').select('id, full_name, initials').in('id', uniq)
  for (const r of (data ?? []) as Array<{ id: string; full_name?: string | null; initials?: string | null }>) {
    out.set(r.id, (r.full_name || r.initials || '').trim() || r.id.slice(0, 8))
  }
  return out
}

// ---- Dostęp do CRM (crm.dostep) — tylko superadmin pisze (RLS) ----

export type CrmDostepRow = { user_id: string; nadal: string | null; nadano_at: string; uwagi: string | null }

export async function fetchCrmDostep(): Promise<Result<CrmDostepRow[]>> {
  const { data, error } = await crm().from('dostep').select('user_id, nadal, nadano_at, uwagi')
  return { data: (data ?? []) as unknown as CrmDostepRow[], error: crmErrorFrom(error) }
}

export async function grantCrmDostep(userId: string, grantedBy: string): Promise<CrmError | null> {
  const { error } = await crm().from('dostep').insert({ user_id: userId, nadal: grantedBy })
  return crmErrorFrom(error)
}

export async function revokeCrmDostep(userId: string): Promise<CrmError | null> {
  const { error } = await crm().from('dostep').delete().eq('user_id', userId)
  return crmErrorFrom(error)
}

// ---- Skrzynki pocztowe (crm.skrzynki, brief pkt 11) ----
// Hasło: nigdy nie logujemy, nie trzymamy dłużej niż do zapisu, idzie TYLKO do
// rpc ustaw_skrzynke (vault) i do funkcji crm-mail-sent (test połączenia).

export async function fetchSkrzynki(): Promise<Result<CrmSkrzynka[]>> {
  const { data, error } = await crm().from('skrzynki').select('*').order('nazwa', { ascending: true })
  return { data: (data ?? []) as unknown as CrmSkrzynka[], error: crmErrorFrom(error) }
}

export type SkrzynkaForm = {
  nazwa: string
  host: string
  port: number
  login: string
  aktywna: boolean
  czyta_wyslane: boolean
  folder_wyslane: string
  czyta_odebrane: boolean
  folder_odebrane: string
  handlowiec: string
  /** właściciel (skrzynka osobista); null = wspólna. Zwykły użytkownik: rpc i tak wymusza auth.uid() */
  user_id: string | null
}

/** `id` null = nowa skrzynka. `haslo`: null = zostaw dotychczasowe, '' = usuń, tekst = ustaw (semantyka rpc). */
export async function saveSkrzynka(id: string | null, form: SkrzynkaForm, haslo: string | null): Promise<Result<CrmSkrzynka | null>> {
  const { data, error } = await crm().rpc('ustaw_skrzynke', {
    p_id: id,
    p_nazwa: form.nazwa.trim(),
    p_host: form.host.trim(),
    p_port: form.port,
    p_login: form.login.trim(),
    p_haslo: haslo,
    p_aktywna: form.aktywna,
    p_czyta_wyslane: form.czyta_wyslane,
    p_folder_wyslane: form.folder_wyslane.trim() || 'Sent',
    p_czyta_odebrane: form.czyta_odebrane,
    p_folder_odebrane: form.folder_odebrane.trim() || 'INBOX',
    p_handlowiec: form.handlowiec.trim() || null,
    p_user_id: form.user_id,
  })
  const row = Array.isArray(data) ? (data[0] ?? null) : (data ?? null)
  return { data: row as CrmSkrzynka | null, error: crmErrorFrom(error) }
}

/** Kasuje hasło z vault i wiersz; maile zostają (skrzynka_id → null), punkt startu przepada. */
export async function deleteSkrzynka(id: string): Promise<CrmError | null> {
  const { error } = await crm().rpc('usun_skrzynke', { p_id: id })
  return crmErrorFrom(error)
}

async function invokeMailSent<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('crm-mail-sent', { body })
  if (error) throw new Error(await fnErrorMessage(error, 'Funkcja crm-mail-sent nie odpowiada'))
  if (!data) throw new Error('Pusta odpowiedź funkcji crm-mail-sent')
  return data
}

/**
 * Test połączenia. Z `skrzynkaId` brakujące dane i hasło biorą się z bazy/sejfu, więc test
 * zapisanej skrzynki nie wymaga hasła; puste pola pomijamy (undefined), żeby funkcja je dopełniła.
 */
export async function testPoczta(
  skrzynkaId: string | null,
  form: Pick<SkrzynkaForm, 'host' | 'port' | 'login' | 'folder_wyslane'>,
  haslo: string,
): Promise<CrmPocztaTest> {
  return invokeMailSent<CrmPocztaTest>({
    akcja: 'test_poczty',
    skrzynka_id: skrzynkaId ?? undefined,
    host: form.host.trim() || undefined,
    port: form.port || undefined,
    login: form.login.trim() || undefined,
    haslo: haslo || undefined,
    folder: form.folder_wyslane.trim() || undefined,
  })
}

/** Ręczne „Sprawdź teraz”: bez id wszystkie aktywne, z id jedna (także nieaktywna). Cron robi to co 5 min. */
export async function sprawdzSkrzynki(skrzynkaId?: string): Promise<CrmSprawdzenieSkrzynek> {
  return invokeMailSent<CrmSprawdzenieSkrzynek>({ akcja: 'sprawdz_skrzynki', skrzynka_id: skrzynkaId ?? undefined })
}

/**
 * Import ostatnich N maili z folderu Wysłane sprzed punktu startu jako próbek stylu handlowca
 * (brief pkt 23; superadmin). Bez dopasowania do zadań — tylko crm.maile kierunek wychodzacy.
 */
export async function wczytajHistorieWyslanych(skrzynkaId: string, ile = CRM_PROBKI_STYLU_ILE): Promise<CrmHistoriaWyslanych> {
  return invokeMailSent<CrmHistoriaWyslanych>({ akcja: 'historia_wyslanych', skrzynka_id: skrzynkaId, ile })
}

/**
 * Szkic odpowiedzi mailowej (brief pkt 23): Edge Function crm-szkic, synchronicznie (10–40 s).
 * Handlowiec = zalogowany użytkownik (z JWT). `rodzaj` domyślnie z zadania (dopytaj/follow_up,
 * inne → odpowiedz); `uwagi` = „co zmienić”. 400 `{error}` (np. klient bez e-maila) pokazujemy dosłownie.
 */
export async function generujSzkic(leadId: string, opts: { rodzaj?: string; uwagi?: string } = {}): Promise<Result<CrmSzkic | null>> {
  try {
    const body: Record<string, unknown> = { akcja: 'szkic', lead_id: leadId }
    if (opts.rodzaj) body.rodzaj = opts.rodzaj
    if (opts.uwagi?.trim()) body.uwagi = opts.uwagi.trim()
    const { data, error } = await supabase.functions.invoke<CrmSzkicOdp>(CRM_EDGE_SZKIC, { body })
    if (error) return { data: null, error: { kind: 'other', message: await fnErrorMessage(error, 'Funkcja crm-szkic nie odpowiada') } }
    if (!data?.ok || !data.szkic) return { data: null, error: { kind: 'other', message: data?.error || 'Funkcja crm-szkic nie zwróciła szkicu' } }
    return { data: data.szkic, error: null }
  } catch (e) {
    return { data: null, error: { kind: 'other', message: e instanceof Error ? e.message : 'Błąd generowania szkicu' } }
  }
}

/**
 * Mail oferty w stylu handlowca (brief pkt 30, #159): crm-szkic akcja mail_oferty, 10–40 s.
 * Handlowiec = zalogowany (JWT). Zapis do oferty tylko w statusie do_sprawdzenia; inaczej
 * zapisano=false i tekst tylko do skopiowania.
 */
export async function napiszMailOferty(ofertaId: string, uwagi?: string): Promise<Result<CrmMailOfertyOdp | null>> {
  try {
    const body: Record<string, unknown> = { akcja: 'mail_oferty', oferta_id: ofertaId }
    if (uwagi?.trim()) body.uwagi = uwagi.trim()
    const { data, error } = await supabase.functions.invoke<CrmMailOfertyOdp>(CRM_EDGE_SZKIC, { body })
    if (error) return { data: null, error: { kind: 'other', message: await fnErrorMessage(error, 'Funkcja crm-szkic nie odpowiada') } }
    if (!data?.ok || !data.mail) return { data: null, error: { kind: 'other', message: data?.error || 'Funkcja crm-szkic nie zwróciła maila' } }
    return { data, error: null }
  } catch (e) {
    return { data: null, error: { kind: 'other', message: e instanceof Error ? e.message : 'Błąd pisania maila' } }
  }
}

/** Użytkownicy z dostępem do CRM (do wyboru właściciela skrzynki osobistej — superadmin). */
export async function fetchCrmUserIds(): Promise<string[]> {
  const { data } = await crm().from('dostep').select('user_id')
  return ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)
}

// ---- Maile (crm.maile, brief pkt 11) ----

const MAIL_LEAD_EMBED = 'lead:leady(id, nazwa, telefon, email, miejscowosc)'
const MAIL_LIST_COLS =
  'id, skrzynka_id, kierunek, od_adres, od_nazwa, do_adresy, temat, data, lead_id, oferta_id, typ, status_przetwarzania, podsumowanie, nastepna_akcja, zalaczniki, blad, proby, koszt_ai_usd, created_at'

export async function fetchMaile(opts: { kierunek?: 'przychodzacy' | 'wychodzacy' | null; limit?: number } = {}): Promise<Result<CrmMail[]>> {
  let q = crm().from('maile').select(`${MAIL_LIST_COLS}, ${MAIL_LEAD_EMBED}`)
  if (opts.kierunek) q = q.eq('kierunek', opts.kierunek)
  const { data, error } = await q.order('data', { ascending: false, nullsFirst: false }).limit(opts.limit ?? 300)
  return { data: (data ?? []) as unknown as CrmMail[], error: crmErrorFrom(error) }
}

export async function fetchMail(id: string): Promise<Result<CrmMail | null>> {
  const { data, error } = await crm().from('maile').select(`*, ${MAIL_LEAD_EMBED}`).eq('id', id).maybeSingle()
  return { data: (data ?? null) as unknown as CrmMail | null, error: crmErrorFrom(error) }
}

export async function fetchMaileLeada(leadId: string, opts: { zTrescia?: boolean } = {}): Promise<Result<CrmMail[]>> {
  // karta klienta v2: korespondencja jako wątek potrzebuje treści (ostatnie 60 maili klienta)
  const cols = opts.zTrescia ? `${MAIL_LIST_COLS}, tresc, tresc_ucieta, kanal` : MAIL_LIST_COLS
  let q = crm().from('maile').select(cols).eq('lead_id', leadId).order('data', { ascending: false, nullsFirst: false })
  if (opts.zTrescia) q = q.limit(60)
  const { data, error } = await q
  return { data: (data ?? []) as unknown as CrmMail[], error: crmErrorFrom(error) }
}

// ---- Walk-in: „Dodaj klienta” (brief pkt 13.1) ----

export type NowyKlient = {
  /** kanał (leady.zrodlo): wizyta w salonie albo zapytanie z Facebooka / Instagrama (#166) */
  kanal: 'wizyta' | 'social'
  nazwa: string
  telefon: string
  email: string
  /** #166: profil / nick z Facebooka lub Instagrama — wystarczy zamiast telefonu i maila */
  profil_social: string
  miejscowosc: string
  notatka: string
  /** oddzwon | dopytaj | przygotuj_oferte | null */
  nastepna_akcja: string | null
  /** YYYY-MM-DD */
  nastepny_krok: string | null
  etykiety: string[]
}

/**
 * Lead ze zrodlo='wizyta' + zdarzenie lead_utworzony. Telefon normalizowany do +48… (UNIQUE
 * w leady); przy duplikacie zwracamy id istniejącego klienta, żeby UI mógł go otworzyć.
 */
export async function createLeadWizyta(k: NowyKlient, userId: string): Promise<{ id: string | null; error: CrmError | null; existingId?: string }> {
  const telefon = k.telefon.trim() ? normalizePlPhone(k.telefon) : null
  if (k.telefon.trim() && !telefon) return { id: null, error: { kind: 'other', message: 'Nieprawidłowy numer telefonu — wpisz 9 cyfr albo z prefiksem +48.' } }
  const email = k.email.trim().toLowerCase() || null
  const profil_social = k.profil_social.trim() || null
  // #166: z Facebooka/Instagrama klient często nie zostawia telefonu ani maila — wystarczy profil
  if (!telefon && !email && !profil_social) {
    return { id: null, error: { kind: 'other', message: k.kanal === 'social' ? 'Podaj profil (link albo @nazwa), telefon albo e-mail klienta.' : 'Podaj telefon albo e-mail klienta.' } }
  }
  const notatka = k.notatka.trim() || null
  const { data, error } = await crm()
    .from('leady')
    .insert({
      zrodlo: k.kanal,
      status: 'nowy',
      nazwa: k.nazwa.trim() || null,
      telefon,
      email,
      profil_social,
      miejscowosc: k.miejscowosc.trim() || null,
      podsumowanie: notatka,
      nastepna_akcja: k.nastepna_akcja,
      nastepny_krok: k.nastepna_akcja ? k.nastepny_krok : null,
      // 21.11: bez notatki „Zapytaj o decyzję” pokazywał podpowiedź „Oferta wysłana…”, a klient z salonu oferty nie dostał
      akcja_opis: k.nastepna_akcja ? notatka?.slice(0, 200) ?? (k.nastepna_akcja === 'follow_up' ? (k.kanal === 'social' ? 'Klient z Facebooka/Instagrama — zapytaj, czy się zdecydował.' : 'Klient z salonu — zapytaj, czy się zdecydował.') : null) : null,
      akcja_od: k.nastepna_akcja ? new Date().toISOString() : null,
      etykiety: k.etykiety,
    })
    .select('id')
    .single()
  if (error || !data) {
    if (error?.code === '23505' && telefon) {
      const { data: ex } = await crm().from('leady').select('id').eq('telefon', telefon).maybeSingle()
      return { id: null, error: { kind: 'other', message: 'Klient z tym numerem telefonu już jest w CRM.' }, existingId: (ex as { id: string } | null)?.id }
    }
    return { id: null, error: crmErrorFrom(error) ?? { kind: 'other', message: 'Nie udało się zapisać klienta' } }
  }
  const id = (data as { id: string }).id
  await crm().from('zdarzenia').insert({
    lead_id: id,
    typ: 'lead_utworzony',
    opis: k.kanal === 'social' ? 'Nowy klient z Facebooka / Instagrama' : 'Nowy klient z wizyty w salonie',
    kto: userId,
    dane: { zrodlo: 'klik', kanal: k.kanal },
  })
  return { id, error: null }
}

// ---- Etykiety (crm.etykiety + crm.leady.etykiety, brief pkt 12) ----

export async function fetchEtykiety(): Promise<Result<CrmEtykieta[]>> {
  const { data, error } = await crm().from('etykiety').select('*').order('grupa').order('kolejnosc').order('nazwa')
  return { data: (data ?? []) as unknown as CrmEtykieta[], error: crmErrorFrom(error) }
}

/** Klik w badge: dodaje/zdejmuje; w grupie „jedna na grupę” podmienia. Zwraca nową tablicę slugów. */
export async function toggleEtykieta(leadId: string, slug: string): Promise<Result<string[]>> {
  const { data, error } = await crm().rpc('przelacz_etykiete', { p_lead_id: leadId, p_slug: slug })
  return { data: (data ?? []) as string[], error: crmErrorFrom(error) }
}

/** Superadmin: nowa etykieta w słowniku (RLS odrzuci innych). */
export async function addEtykieta(e: Pick<CrmEtykieta, 'slug' | 'nazwa' | 'grupa' | 'kolor' | 'jedna_na_grupe'> & { kolejnosc?: number }): Promise<CrmError | null> {
  const { error } = await crm().from('etykiety').insert({
    slug: e.slug,
    nazwa: e.nazwa,
    grupa: e.grupa,
    kolor: e.kolor,
    jedna_na_grupe: e.jedna_na_grupe,
    kolejnosc: e.kolejnosc ?? 100,
    aktywna: true,
  })
  return crmErrorFrom(error)
}

export async function setEtykietaAktywna(slug: string, aktywna: boolean): Promise<CrmError | null> {
  const { error } = await crm().from('etykiety').update({ aktywna }).eq('slug', slug)
  return crmErrorFrom(error)
}

// ---- Pomoc CRM (crm.pomoc, markdown) — czyta każdy z CRM, pisze superadmin (RLS) ----

export async function fetchPomoc(): Promise<Result<CrmPomocStrona[]>> {
  const { data, error } = await crm().from('pomoc').select('*').order('kolejnosc', { ascending: true, nullsFirst: false }).order('tytul')
  return { data: (data ?? []) as unknown as CrmPomocStrona[], error: crmErrorFrom(error) }
}

export async function savePomoc(slug: string, patch: { tytul: string; tresc_md: string }, userId: string): Promise<CrmError | null> {
  const { error } = await crm()
    .from('pomoc')
    .update({ tytul: patch.tytul.trim(), tresc_md: patch.tresc_md, updated_at: new Date().toISOString(), updated_by: userId })
    .eq('slug', slug)
  return crmErrorFrom(error)
}

export async function addPomoc(s: { slug: string; tytul: string; tresc_md: string; kolejnosc: number }, userId: string): Promise<CrmError | null> {
  const { error } = await crm().from('pomoc').insert({ ...s, tytul: s.tytul.trim(), updated_by: userId })
  return crmErrorFrom(error)
}

export async function deletePomoc(slug: string): Promise<CrmError | null> {
  const { error } = await crm().from('pomoc').delete().eq('slug', slug)
  return crmErrorFrom(error)
}

// ---- Oferta z notatki handlowca (brief pkt 15, klient z salonu) ----

/**
 * rpc crm.zlec_oferte_z_notatki: zapisuje notatkę do leady.podsumowanie (gdy podana), zleca analizę
 * i ofertę w tle (po ~15 s oferta `przelicz`, po ~30 s `do_sprawdzenia`). Przy ofercie już w `przelicz`
 * nic nie robi; przy `do_sprawdzenia` robi nową wersję. Wyjątek (np. „Brak notatki…”) wraca jako error.
 */
export async function zlecOferteZNotatki(leadId: string, notatka: string | null): Promise<CrmError | null> {
  const n = notatka?.trim() || null
  const { error } = await crm().rpc('zlec_oferte_z_notatki', { p_lead_id: leadId, p_notatka: n })
  return crmErrorFrom(error)
}

// ---- Notatka głosowa (brief pkt 18): upload do Storage + rpc crm.zlec_oferte_z_nagrania ----

/**
 * Wgrywa nagranie do bucketu crm-nagrania (`${leadId}/${Date.now()}.webm`) i zleca transkrypcję + ofertę.
 * Po ~20 s transkrypcja ląduje w leady.podsumowanie (zdarzenie notatka_glosowa), dalej jak „Zleć ofertę”.
 */
export async function zlecOferteZNagrania(leadId: string, blob: Blob, contentType: string): Promise<CrmError | null> {
  const ext = contentType.includes('mp4') ? 'mp4' : contentType.includes('ogg') ? 'ogg' : 'webm'
  const sciezka = `${leadId}/${Date.now()}.${ext}`
  const up = await supabase.storage.from(CRM_NAGRANIE_BUCKET).upload(sciezka, blob, { contentType, upsert: false })
  if (up.error) return { kind: 'other', message: `Nie udało się wgrać nagrania: ${up.error.message}` }
  const { error } = await crm().rpc('zlec_oferte_z_nagrania', { p_lead_id: leadId, p_sciezka: sciezka })
  return crmErrorFrom(error)
}

// ---- Zasady domyślne ofert (crm.zasady, brief pkt 16) — czyta każdy z CRM, pisze superadmin ----

export async function fetchZasady(): Promise<Result<CrmZasada[]>> {
  const { data, error } = await crm().from('zasady').select('*').order('grupa').order('kolejnosc').order('created_at')
  return { data: (data ?? []) as unknown as CrmZasada[], error: crmErrorFrom(error) }
}

export async function addZasada(grupa: string, tresc: string, kolejnosc: number, userId: string): Promise<CrmError | null> {
  const { error } = await crm().from('zasady').insert({ grupa, tresc: tresc.trim(), kolejnosc, aktywna: true, updated_by: userId })
  return crmErrorFrom(error)
}

export async function updateZasada(id: string, patch: Partial<Pick<CrmZasada, 'tresc' | 'aktywna' | 'kolejnosc'>>, userId: string): Promise<CrmError | null> {
  const p: Record<string, unknown> = { ...patch, updated_by: userId, updated_at: new Date().toISOString() }
  if (typeof patch.tresc === 'string') p.tresc = patch.tresc.trim()
  const { error } = await crm().from('zasady').update(p).eq('id', id)
  return crmErrorFrom(error)
}

export async function deleteZasada(id: string): Promise<CrmError | null> {
  const { error } = await crm().from('zasady').delete().eq('id', id)
  return crmErrorFrom(error)
}

// ---- Duplikaty klientów (brief pkt 26) ----

/** Wszystkie pary możliwych duplikatów (widok crm.duplikaty), najpewniejsze pierwsze. */
export async function fetchDuplikaty(): Promise<Result<CrmDuplikat[]>> {
  const { data, error } = await crm().from('duplikaty').select('*').order('pewnosc', { ascending: false })
  return { data: (data ?? []) as unknown as CrmDuplikat[], error: crmErrorFrom(error) }
}
/** Możliwe duplikaty jednego klienta (rpc duplikaty_leada) — baner na karcie. */
export async function fetchDuplikatyLeada(leadId: string): Promise<Result<CrmDuplikatLeada[]>> {
  const { data, error } = await crm().rpc('duplikaty_leada', { p_lead: leadId })
  return { data: (data ?? []) as unknown as CrmDuplikatLeada[], error: crmErrorFrom(error) }
}
/** NIEODWRACALNE: źródło wchodzi w cel (rpc polacz_leady). Zwraca id celu; błąd = komunikat rpc po polsku. */
export async function polaczLeady(celId: string, zrodloId: string): Promise<Result<string | null>> {
  const { data, error } = await crm().rpc('polacz_leady', { p_cel: celId, p_zrodlo: zrodloId })
  if (error) return { data: null, error: crmErrorFrom(error) }
  return { data: (data as string | null) ?? celId, error: null }
}

// ---- Dni wolne (crm.dni_wolne, brief pkt 25) ----

/** Dni wolne od dziś (podpowiedź terminu i lista w Ustawieniach). `odDzis=false` = wszystkie (nie używamy). */
export async function fetchDniWolne(): Promise<Result<CrmDzienWolny[]>> {
  const dzis = new Date()
  const iso = `${dzis.getFullYear()}-${String(dzis.getMonth() + 1).padStart(2, '0')}-${String(dzis.getDate()).padStart(2, '0')}`
  const { data, error } = await crm().from('dni_wolne').select('*').gte('data', iso).order('data')
  return { data: (data ?? []) as unknown as CrmDzienWolny[], error: crmErrorFrom(error) }
}
/** Dzień firmowy (superadmin). Święta robi cron — aplikacja ich nie dodaje. */
export async function addDzienWolny(data: string, nazwa: string): Promise<CrmError | null> {
  const { error } = await crm().from('dni_wolne').insert({ data, nazwa: nazwa.trim() || null, rodzaj: 'firmowe' })
  return crmErrorFrom(error)
}
/** Usuwanie tylko dni firmowych (święto wróciłoby po cronie — guard także w UI). */
export async function deleteDzienWolny(data: string): Promise<CrmError | null> {
  const { error } = await crm().from('dni_wolne').delete().eq('data', data).eq('rodzaj', 'firmowe')
  return crmErrorFrom(error)
}

// ---- Ustawienia CRM (crm.ustawienia, brief pkt 16: alerty) ----

export async function fetchUstawienia(): Promise<Result<CrmUstawienie[]>> {
  const { data, error } = await crm().from('ustawienia').select('*').order('klucz')
  return { data: (data ?? []) as unknown as CrmUstawienie[], error: crmErrorFrom(error) }
}

/** Zapis kilku kluczy naraz (upsert po kluczu); opis zostaje z bazy. */
export async function saveUstawienia(values: Record<string, string>): Promise<CrmError | null> {
  const rows = Object.entries(values).map(([klucz, wartosc]) => ({ klucz, wartosc, updated_at: new Date().toISOString() }))
  const { error } = await crm().from('ustawienia').upsert(rows, { onConflict: 'klucz' })
  return crmErrorFrom(error)
}

/** „Wyślij mail próbny” (superadmin): crm-mail-sent wysyła alert testowy na alert_email przez alert_skrzynka_id. */
export async function testAlert(): Promise<CrmAlertTest> {
  return invokeMailSent<CrmAlertTest>({ akcja: 'test_alertu' })
}

// ---- Przegląd poprawek (widok crm.poprawki_ostatnie, 30 dni, brief pkt 17) ----

export async function fetchPoprawkiOstatnie(): Promise<Result<CrmPoprawkaRow[]>> {
  const { data, error } = await crm().from('poprawki_ostatnie').select('*').order('created_at', { ascending: false }).limit(500)
  return { data: (data ?? []) as unknown as CrmPoprawkaRow[], error: crmErrorFrom(error) }
}

/** „Analizuj ponownie”: status → 'nowy', trigger w bazie sam zleca analizę (tylko przychodzące). */
export async function retryMailAnaliza(id: string): Promise<CrmError | null> {
  const { error } = await crm().from('maile').update({ status_przetwarzania: 'nowy' }).eq('id', id)
  return crmErrorFrom(error)
}
