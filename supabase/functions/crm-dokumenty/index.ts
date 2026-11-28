// crm-dokumenty: dokumenty klienta Po Drzwi jako PDF w szablonie wtyczki dokumenty-po-drzwi (dokumenty.ts + rysuj.ts).
//
// Wejście (POST JSON, autoryzacja jak crm-oferta-pdf: x-ingest-key, x-internal-key albo JWT użytkownika z dostępem do CRM):
//   { akcja: 'dokument', rodzaj: 'karta_pomiarowa' | 'umowa' | 'protokol', lead_id, oferta_id?, dokument_id?, dane, user_id? }
//     karta_pomiarowa: dane { data_pomiaru 'DD.MM.RRRR', godzina 'HH:MM', adres_pomiaru, pietro?, wykonal, otwory?: [{rodzaj, pomieszczenie}],
//                      klient_nazwa?/telefon?/email? (domyślnie z leada) } → blankiet A4 poziomo, 2 strony.
//     umowa:  oferta_id (oficjalna, z montażem, policzona) + dane { klient_adres, adres_montazu?, zaliczka_proc? (40), termin_tygodnie? (8) |
//             termin_data?, gwarancja_miesiace? (24), data_zawarcia?, miejsce_zawarcia?, przedmiot?, zakres_prac?, numer? } → numer NN/MM/RRRR
//             z crm.nastepny_numer_umowy() (dokument_id = regeneracja z tym samym numerem), Załącznik nr 1 = PDF oferty (+ konfiguracja PDF).
//     protokol: dane.umowa_id (albo ostatnia umowa klienta; dokument_id z id umowy też działa) + dane { data_odbioru?, adres_montazu? }
//             → blankiet protokołu; dokument_id = id istniejącego protokołu → regeneracja tego samego wiersza.
//   Wynik: { ok, dokument_id, rodzaj, numer, plik_pdf, url (podpisany, 10 min) }; wiersz w crm.dokumenty + zdarzenie 'dokument'.
//   Brak wymaganych danych → HTTP 400 { error: 'Brakuje: …' }.
//   { akcja: 'podglad', sciezka } → podpisany link do dowolnego pliku z bucketu (diagnostyka).
//   D20 (28.11, RODO) — usuwanie razem z plikami (usuwanie.ts):
//   { akcja: 'usun', lead_id } | { akcja: 'usun', oferta_id } → tylko JWT użytkownika z CRM; rekord kasowany jako użytkownik
//     (RLS), potem pliki z crm-dokumenty (i crm-nagrania przy kliencie). Wynik: { ok, usuniety, plikow_usunietych, blad_plikow }.
//   { akcja: 'sprzatnij_pliki', usun?: true } → pliki po klientach usuniętych wcześniej (domyślnie podgląd) + lista plików
//     bez odwołania u istniejących klientów (tylko do wglądu).
// Czcionki Poppins i logo: bucket crm-dokumenty/szablon/ (wgrywane przez crm-oferta-pdf: wgraj_szablon / aplikacja „Wgraj logo”).

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { kartaPomiarowa, umowa, protokolOdbioru, type KartaDane, type UmowaDane, type ProtokolDane } from './dokumenty.ts'
import { fmt, type Czcionki, type Logo } from './rysuj.ts'
import { usun, sprzatnijPliki, BladUsuwania } from './usuwanie.ts'

const JSON_H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
const CORS_H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ingest-key' }
const odp = (status: number, dane: unknown) => new Response(JSON.stringify(dane), { status, headers: JSON_H })
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const BUCKET = 'crm-dokumenty'
const POPPINS = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/poppins/'
const CZCIONKI: Record<keyof Czcionki, { sciezka: string; url: string }> = {
  light: { sciezka: 'szablon/Poppins-Light.ttf', url: POPPINS + 'Poppins-Light.ttf' },
  regular: { sciezka: 'szablon/Poppins-Regular.ttf', url: POPPINS + 'Poppins-Regular.ttf' },
  medium: { sciezka: 'szablon/Poppins-Medium.ttf', url: POPPINS + 'Poppins-Medium.ttf' },
  semibold: { sciezka: 'szablon/Poppins-SemiBold.ttf', url: POPPINS + 'Poppins-SemiBold.ttf' },
}
let kluczWewnetrzny: string | null = null
let czcionkiCache: Czcionki | null = null
class BladWejscia extends Error {}
const dataPL = (d: Date) => d.toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric' })
const zaokr = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_H })
  if (req.method !== 'POST') return odp(405, { error: 'Tylko POST' })
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: 'crm' } })
  const kto = await autoryzuj(req, db)
  if (!kto) return odp(401, { error: 'Brak uprawnień' })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return odp(400, { error: 'Oczekiwano JSON' }) }
  const akcja = String(body.akcja ?? '')
  try {
    if (akcja === 'dokument') return odp(200, await dokument(db, body, kto === 'uzytkownik' ? (body.user_id as string | undefined) ?? null : null))
    if (akcja === 'podglad') {
      const sciezka = String(body.sciezka ?? '')
      const { data: s, error } = await db.storage.from(BUCKET).createSignedUrl(sciezka, 600)
      if (error || !s) return odp(500, { error: 'Nie utworzono linku: ' + (error?.message ?? '?') })
      return odp(200, { sciezka, url: s.signedUrl })
    }
    if (akcja === 'usun') {
      // D20: usuwa tylko zalogowany użytkownik z CRM (rekord jego JWT, pliki kluczem serwisowym)
      if (kto !== 'uzytkownik') return odp(403, { error: 'Usuwanie tylko z aplikacji (zalogowany użytkownik z dostępem do CRM)' })
      const uzytk = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, db: { schema: 'crm' } })
      return odp(200, await usun(db, uzytk, body))
    }
    if (akcja === 'sprzatnij_pliki') return odp(200, await sprzatnijPliki(db, body.usun === true))
    return odp(400, { error: 'Nieznana akcja' })
  } catch (e) {
    if (e instanceof BladWejscia || e instanceof BladUsuwania) return odp(400, { error: e.message })
    return odp(500, { error: e instanceof Error ? e.message : String(e) })
  }
})

async function autoryzuj(req: Request, db: SupabaseClient): Promise<'system' | 'uzytkownik' | null> {
  const ingest = Deno.env.get('CRM_INGEST_KEY')
  if (ingest && req.headers.get('x-ingest-key') === ingest) return 'system'
  const wew = req.headers.get('x-internal-key')
  if (wew) {
    if (!kluczWewnetrzny) {
      const { data } = await db.rpc('klucz_wewnetrzny')
      kluczWewnetrzny = typeof data === 'string' ? data : null
    }
    if (kluczWewnetrzny && wew === kluczWewnetrzny) return 'system'
  }
  const auth = req.headers.get('Authorization')
  if (auth?.startsWith('Bearer ')) {
    const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const jakoUzytkownik = createClient(SUPABASE_URL, anon, { global: { headers: { Authorization: auth } } })
    const { data: u } = await jakoUzytkownik.auth.getUser(auth.slice(7))
    if (!u?.user) return null
    const { data: ma } = await jakoUzytkownik.rpc('current_user_has_crm')
    return ma === true ? 'uzytkownik' : null
  }
  return null
}

/** Dokument klienta (karta pomiarowa / umowa / protokół) z danych leada, oferty i formularza; PDF do bucketu + wiersz crm.dokumenty. */
async function dokument(db: SupabaseClient, body: Record<string, unknown>, userId: string | null) {
  const rodzaj = String(body.rodzaj ?? '')
  if (!['karta_pomiarowa', 'umowa', 'protokol'].includes(rodzaj)) throw new BladWejscia('rodzaj: karta_pomiarowa, umowa albo protokol')
  const leadId = String(body.lead_id ?? '')
  const dane = body.dane && typeof body.dane === 'object' ? body.dane as Record<string, unknown> : {}
  const s = (k: string) => { const v = dane[k]; return v == null ? '' : String(v).trim() }
  const { data: lead } = await db.from('leady').select('id, nazwa, telefon, email, miejscowosc, nip, firma_nazwa').eq('id', leadId).maybeSingle()
  if (!lead) throw new BladWejscia('Nie ma takiego klienta (lead_id)')
  let dokId = String(body.dokument_id ?? '')
  const u = await ustawienia(db)
  const czcionki = await zaladujCzcionki(db)
  const logo = await zaladujLogo(db)
  const klientNazwa = s('klient_nazwa') || lead.nazwa || ''
  const telefon = s('telefon') || lead.telefon || ''
  const email = s('email') || lead.email || ''
  const zl = (x: number) => `${fmt(x)} zł`

  let pdf: Uint8Array, migawka: Record<string, unknown>, sciezka: string, opis: string, status: string
  let numer: string | null = null, ofertaId: string | null = null

  if (rodzaj === 'karta_pomiarowa') {
    const otwory = Array.isArray(dane.otwory) ? (dane.otwory as Record<string, unknown>[]).map((o) => ({ rodzaj: String(o?.rodzaj ?? '').trim(), pomieszczenie: String(o?.pomieszczenie ?? '').trim() })) : []
    const k: KartaDane = { data_pomiaru: s('data_pomiaru'), godzina: s('godzina'), klient_nazwa: klientNazwa, telefon, email, adres_pomiaru: s('adres_pomiaru') || lead.miejscowosc || '', pietro: s('pietro'), wykonal: s('wykonal'), otwory }
    // zgł. #151 (16.11): karta to blankiet do ręki – wymagane tylko nazwisko, reszta może zostać pusta (wpisze się długopisem)
    if (!k.klient_nazwa) throw new BladWejscia('Brakuje: imię i nazwisko klienta')
    pdf = await kartaPomiarowa(k, czcionki, logo, u)
    migawka = { ...k }
    const d = k.data_pomiaru.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
    sciezka = `${leadId}/karta-pomiarowa-${d ? `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}` : Date.now()}.pdf`
    opis = 'Karta pomiarowa' + [k.data_pomiaru && `: ${k.data_pomiaru}`, k.godzina && ` godz. ${k.godzina}`, k.adres_pomiaru && `, ${k.adres_pomiaru}`, k.wykonal && ` (${k.wykonal})`].filter(Boolean).join('')
    status = 'blankiet'
  } else if (rodzaj === 'umowa') {
    ofertaId = String(body.oferta_id ?? dane.oferta_id ?? '')
    const { data: o } = ofertaId ? await db.from('oferty').select('*').eq('id', ofertaId).maybeSingle() : { data: null }
    if (!o || o.rodzaj !== 'oficjalna') throw new BladWejscia('Umowa powstaje z oferty oficjalnej (PDF): wskaż oferta_id')
    if (o.z_montazem === false) throw new BladWejscia('Oferta bez montażu nie idzie na umowę; umowa powstaje wyłącznie na montaż')
    if (o.brutto == null || !o.numer || !o.plik_pdf) throw new BladWejscia('Oferta nie jest jeszcze policzona (brak kwoty brutto, numeru albo PDF)')
    const vat8 = String(o.vat_stawka ?? '').includes('8%')
    if (vat8 && o.lokal_mieszkalny === false) throw new BladWejscia('VAT 8% w ofercie, a lokal oznaczony jako niemieszkalny: popraw ofertę albo dane o obiekcie')
    // testy 27.11 (2. seria): umowa nie powstaje z oferty, w której towar ma cenę 0 zł (oferta sprzed blokady „Brakuje cen”);
    // zero celowe (gratis, w cenie, w komplecie…) przechodzi — ta sama reguła co w crm-oferta-pdf
    const CELOWO_ZERO = /gratis|w cenie|w komplecie|wliczon|bez dopłat|bez dopłaty|bezpłatn/i
    const bezCeny = (Array.isArray(o.pozycje) ? o.pozycje as Array<{ nazwa?: string; opis?: string; netto_szt?: number | null }> : [])
      .filter((p) => Number(p.netto_szt ?? 0) === 0 && !CELOWO_ZERO.test(`${p.nazwa ?? ''} ${p.opis ?? ''}`))
    if (bezCeny.length) throw new BladWejscia(`W ofercie ${bezCeny.length} ${bezCeny.length === 1 ? 'pozycja ma' : 'pozycji ma'} cenę 0 zł (np. „${String(bezCeny[0].nazwa ?? '').slice(0, 60)}”) — popraw ofertę („Poproś o zmianę”), potem umowa`)
    // braki danych klienta sprawdzamy PRZED nadaniem numeru — wcześniej każda nieudana próba zjadała numer z licznika
    const brakiKlienta = [!klientNazwa && 'imię i nazwisko', !s('klient_adres') && 'adres klienta', !email && 'e-mail (do Autenti)', !telefon && 'telefon'].filter(Boolean)
    if (brakiKlienta.length) throw new BladWejscia('Brakuje: ' + brakiKlienta.join(', '))
    let istniejacy: { numer: string | null } | null = null
    if (dokId) {
      const { data } = await db.from('dokumenty').select('numer, status').eq('id', dokId).eq('rodzaj', 'umowa').maybeSingle()
      // testy 27.11 (runda 3): podpisanej ani anulowanej umowy nie generujemy ponownie (aplikacja też chowa wtedy „generuj ponownie”)
      if (data?.status === 'podpisana' || data?.status === 'anulowana') throw new BladWejscia(`Umowa nr ${data.numer ?? '?'} jest ${data.status} — nie generuję jej ponownie; przygotuj nową umowę`)
      istniejacy = data
    }
    // druga umowa z tej samej oferty: ten sam numer (jedna sprzedaż = jeden numer), zamiast nowego z licznika.
    // testy 27.11 (runda 3): numer bierzemy tylko z umowy tej oferty w statusie „projekt” — wysłana/podpisana/anulowana
    // zostaje nietknięta, a nowa umowa dostaje nowy numer z licznika (numer anulowanej nie wraca do użycia)
    if (!istniejacy?.numer && !s('numer')) {
      const { data: zTejOferty } = await db.from('dokumenty').select('numer').eq('rodzaj', 'umowa').eq('lead_id', leadId).eq('oferta_id', ofertaId).eq('status', 'projekt').not('numer', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (zTejOferty?.numer) istniejacy = zTejOferty
    }
    numer = istniejacy?.numer || s('numer') || null
    if (!numer) {
      const { data: n, error } = await db.rpc('nastepny_numer_umowy')
      if (error || typeof n !== 'string') throw new Error('Nie nadano numeru umowy: ' + (error?.message ?? '?'))
      numer = n
    }
    const brutto = zaokr(Number(o.brutto))
    const proc = Number(dane.zaliczka_proc ?? 40) || 40
    const zaliczka = zaokr(brutto * proc / 100), pozostalo = zaokr(brutto - zaliczka)
    if (zaokr(zaliczka + pozostalo) !== brutto) throw new Error('Zaliczka + reszta ≠ brutto')
    const pozycje = Array.isArray(o.pozycje) ? o.pozycje as { nazwa?: string }[] : []
    const uslugi = Array.isArray(o.uslugi) ? (o.uslugi as { nazwa?: string }[]).map((x) => String(x.nazwa ?? '').trim()).filter(Boolean) : []
    const przedmiot = s('przedmiot') || `${o.streszczenie || `${pozycje[0]?.nazwa ?? 'stolarka wg oferty'}${pozycje.length === 2 ? ' wraz z 1 pozycją dodatkową' : pozycje.length > 2 ? ` wraz z ${pozycje.length - 1} pozycjami dodatkowymi` : ''}`}${o.producent ? ` (konfiguracja producenta ${o.producent})` : ''}`
    const zakresPrac = s('zakres_prac') || [o.zakres ?? '', uslugi.length ? `Usługi objęte umową: ${uslugi.join(', ').toLowerCase()}.` : ''].filter(Boolean).join(' ')
    const terminData = s('termin_data') || null
    const um: UmowaDane = {
      numer, data_zawarcia: s('data_zawarcia') || dataPL(new Date()), miejsce_zawarcia: s('miejsce_zawarcia') || u.firma_miejsce_umowy || 'Wodzisławiu Śląskim',
      klient_nazwa: klientNazwa, klient_adres: s('klient_adres'), adres_montazu: s('adres_montazu') || s('klient_adres'), email, telefon,
      // 27.11: klient-firma — NIP i nazwa firmy z danych dokumentu albo z karty klienta
      klient_firma: s('klient_firma') || lead.firma_nazwa || null,
      klient_nip: nipDoDruku(s('klient_nip') || lead.nip || ''),
      przedmiot, zakres_prac: zakresPrac || 'dostawę i montaż stolarki wg Załącznika nr 1',
      termin_tygodnie: terminData ? null : (Number(dane.termin_tygodnie ?? 8) || 8), termin_data: terminData,
      brutto, stawka_vat: o.vat_stawka ?? '23%', zaliczka, pozostalo, zaliczka_proc: proc,
      gwarancja_miesiace: Number(dane.gwarancja_miesiace ?? 24) || 24, vat8,
      numer_oferty: o.numer, oferta_opis: `${o.producent ? `konfiguracja ${o.producent}` : 'konfiguracja producenta'} z dnia ${dataPL(new Date(o.updated_at ?? o.created_at))}`,
    }
    const braki = [!um.klient_nazwa && 'imię i nazwisko', !um.klient_adres && 'adres klienta', !um.email && 'e-mail (do Autenti)', !um.telefon && 'telefon'].filter(Boolean)
    if (braki.length) throw new BladWejscia('Brakuje: ' + braki.join(', '))
    const stempel = `ZAŁĄCZNIK NR 1 do umowy nr ${numer} z dnia ${um.data_zawarcia}`
    const zalaczniki: { bajty: Uint8Array; stempel: string }[] = []
    // załącznik nr 1: PDF oferty + wszystkie PDF-y z konfiguratora producenta (od 18.11 może ich być kilka, oferty.konfiguracja_pliki)
    const konf = [...new Set([...((o.konfiguracja_pliki as string[] | null) ?? []), ...(o.konfiguracja_plik ? [o.konfiguracja_plik as string] : [])])].filter((p) => /\.pdf$/i.test(p))
    for (const plik of [o.plik_pdf, ...konf]) {
      if (!plik) continue
      const { data } = await db.storage.from(BUCKET).download(plik)
      if (data) zalaczniki.push({ bajty: new Uint8Array(await data.arrayBuffer()), stempel })
    }
    pdf = await umowa(um, czcionki, logo, u, zalaczniki)
    migawka = { ...um, oferta_id: ofertaId }
    // testy 27.11 (runda 3): każda wygenerowana umowa ma własny plik (znacznik czasu w nazwie) — wcześniej druga umowa
    // z tym samym numerem nadpisywała PDF istniejącej (także podpisanej), a dwa wiersze wskazywały ten sam plik
    sciezka = `${leadId}/umowa-${numer.replace(/\//g, '-')}-${znacznikCzasu()}.pdf`
    opis = `Umowa nr ${numer}: ${zl(brutto)} brutto (VAT ${um.stawka_vat}), zaliczka ${zl(zaliczka)}, po odbiorze ${zl(pozostalo)}; załącznik: oferta ${o.numer}`
    status = 'projekt'
  } else {
    // dokument_id = regenerowany protokół (ten sam wiersz); umowę wskazuje dane.umowa_id, a bez niej: umowa z migawki protokołu
    // albo ostatnia umowa klienta. Gdy aplikacja poda w dokument_id id umowy, traktujemy to jak umowa_id (nowy wiersz protokołu).
    let umowaId = s('umowa_id')
    if (dokId) {
      const { data: d0 } = await db.from('dokumenty').select('rodzaj, dane').eq('id', dokId).eq('lead_id', leadId).maybeSingle()
      if (d0?.rodzaj === 'umowa') { umowaId = umowaId || dokId; dokId = '' }
      else if (d0?.rodzaj === 'protokol') umowaId = umowaId || String((d0.dane as { umowa_id?: string })?.umowa_id ?? '')
      else throw new BladWejscia('dokument_id nie wskazuje protokołu ani umowy tego klienta')
    }
    const q = db.from('dokumenty').select('id, numer, dane, oferta_id').eq('rodzaj', 'umowa').eq('lead_id', leadId)
    const { data: um } = umowaId ? await q.eq('id', umowaId).maybeSingle() : await q.order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!um?.numer) throw new BladWejscia('Protokół powstaje z umowy: najpierw wystaw umowę dla tego klienta')
    const ud = um.dane as UmowaDane
    const pr: ProtokolDane = {
      numer_umowy: um.numer, data_umowy: ud.data_zawarcia, data_odbioru: s('data_odbioru') || null,
      adres_montazu: s('adres_montazu') || ud.adres_montazu, klient_nazwa: ud.klient_nazwa, klient_adres: ud.klient_adres, telefon: ud.telefon,
      klient_firma: ud.klient_firma ?? null, klient_nip: ud.klient_nip ?? null,
      brutto: Number(ud.brutto), zaliczka: Number(ud.zaliczka), pozostalo: Number(ud.pozostalo),
    }
    pdf = await protokolOdbioru(pr, czcionki, logo, u)
    migawka = { ...pr, umowa_id: um.id }
    numer = um.numer; ofertaId = um.oferta_id ?? null
    sciezka = `${leadId}/protokol-${(numer ?? '').replace(/\//g, '-')}.pdf`
    opis = `Protokół odbioru do umowy nr ${numer}: do zapłaty po odbiorze ${zl(pr.pozostalo)}`
    status = 'blankiet'
  }

  // testy 27.11 (runda 3): umowa nigdy nie nadpisuje istniejącego pliku (upsert tylko dla blankietów karty/protokołu)
  const { error: eU } = await db.storage.from(BUCKET).upload(sciezka, pdf, { contentType: 'application/pdf', upsert: rodzaj !== 'umowa' })
  if (eU) throw new Error('Nie zapisano PDF w buckecie: ' + eU.message)
  let dokumentId = dokId
  if (dokId) {
    const { error } = await db.from('dokumenty').update({ numer, dane: migawka, plik_pdf: sciezka, oferta_id: ofertaId }).eq('id', dokId).eq('rodzaj', rodzaj)
    if (error) throw new Error('Nie zapisano dokumentu: ' + error.message)
  } else {
    const { data, error } = await db.from('dokumenty').insert({ lead_id: leadId, oferta_id: ofertaId, rodzaj, numer, dane: migawka, plik_pdf: sciezka, status, utworzyl: userId }).select('id').single()
    if (error) throw new Error('Nie zapisano dokumentu: ' + error.message)
    dokumentId = data.id
  }
  const { error: eZ } = await db.from('zdarzenia').insert({ lead_id: leadId, oferta_id: ofertaId, typ: 'dokument', kto: userId, opis: opis.slice(0, 500), dane: { rodzaj, dokument_id: dokumentId, numer, plik_pdf: sciezka } })
  if (eZ) console.error('zdarzenie:', eZ.message)
  const { data: sg } = await db.storage.from(BUCKET).createSignedUrl(sciezka, 600)
  return { ok: true, dokument_id: dokumentId, rodzaj, numer, plik_pdf: sciezka, url: sg?.signedUrl ?? null }
}

async function ustawienia(db: SupabaseClient): Promise<Record<string, string | null>> {
  const { data } = await db.from('ustawienia').select('klucz, wartosc')
  const out: Record<string, string | null> = {}
  for (const r of data ?? []) out[r.klucz] = r.wartosc
  return out
}
/** Czcionki Poppins: bucket (szablon/), przy braku pobranie z CDN i zapis do bucketu. */
async function zaladujCzcionki(db: SupabaseClient): Promise<Czcionki> {
  if (czcionkiCache) return czcionkiCache
  const jedna = async (c: { sciezka: string; url: string }): Promise<Uint8Array> => {
    const { data } = await db.storage.from(BUCKET).download(c.sciezka)
    if (data && data.size > 10_000) return new Uint8Array(await data.arrayBuffer())
    const r = await fetch(c.url)
    if (!r.ok) throw new Error(`Nie pobrano czcionki ${c.url}: HTTP ${r.status}`)
    const bajty = new Uint8Array(await r.arrayBuffer())
    await db.storage.from(BUCKET).upload(c.sciezka, bajty, { contentType: 'font/ttf', upsert: true })
    return bajty
  }
  czcionkiCache = { light: await jedna(CZCIONKI.light), regular: await jedna(CZCIONKI.regular), medium: await jedna(CZCIONKI.medium), semibold: await jedna(CZCIONKI.semibold) }
  return czcionkiCache
}
async function zaladujLogo(db: SupabaseClient): Promise<Logo> {
  for (const [nazwa, typ] of [['szablon/logo.png', 'png'], ['szablon/logo.jpg', 'jpg'], ['szablon/logo.jpeg', 'jpg']] as const) {
    const { data } = await db.storage.from(BUCKET).download(nazwa)
    if (data && data.size > 100) return { bajty: new Uint8Array(await data.arrayBuffer()), typ }
  }
  return null
}

/** Znacznik do nazwy pliku: 20261127-213045-123 (UTC, z milisekundami — dwie umowy w tej samej sekundzie też się nie zderzą). testy 27.11 (runda 3) */
function znacznikCzasu(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-').replace('Z', '')
}

/** NIP do druku: 7740001454 → 774-000-14-54; pusty → null */
function nipDoDruku(v: string): string | null {
  const n = String(v ?? '').replace(/^PL/i, '').replace(/\D/g, '')
  if (!n) return null
  return n.length === 10 ? `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6, 8)}-${n.slice(8)}` : String(v).trim()
}
