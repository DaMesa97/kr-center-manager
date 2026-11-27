// Czysta logika bez Deno i bez bazy: da się testować Node'em (node --test normalizacja.test.mjs).

export type Rozmowa = {
  ringostat_call_id: string | null
  kierunek: 'przychodzaca' | 'wychodzaca'
  odebrana: boolean
  czas_s: number            // czas rozmowy (billsec / dialog), nie czas dzwonienia
  ivr: string | null
  numer_dzwoniacego: string | null   // E.164 albo null (zastrzeżony/brak)
  numer_docelowy: string | null
  link_nagrania: string | null
  data_rozmowy: string             // ISO
  kampania: string | null
}

// Ringostat w Webhooks 2.0 wysyła klucze takie, jak nazwał je właściciel w panelu, a wartości to zmienne typu $cdr_id.
// Nie mamy jeszcze prawdziwego payloadu, więc przyjmujemy kilka wariantów nazw każdego pola.
const ALIASY = {
  ringostat_call_id: ['call_id', 'cdr_id', 'callid', 'id', 'uniqueid'],
  numer_dzwoniacego: ['caller', 'userfield', 'full_num', 'caller_number', 'src', 'from', 'phone', 'client_number', 'number'],
  numer_docelowy: ['callee', 'dst', 'destination', 'to', 'called_number', 'did'],
  status: ['status', 'disposition', 'call_status', 'result'],
  typ_polaczenia: ['type', 'call_type', 'direction', 'kierunek'],
  czas_s: ['billsec', 'dialog', 'talk_time', 'talktime', 'conversation_duration', 'bill_sec'],
  czas_calk: ['duration', 'call_duration', 'total_duration'],
  ivr: ['ivr', 'dtmf', 'ivr_choice', 'menu', 'ivr_option', 'digit'],
  link_nagrania: ['recording_wav', 'recording', 'record_link', 'recording_url', 'record_url', 'recording_mp3', 'record'],
  data_rozmowy: ['date', 'calldate', 'call_date', 'datetime', 'start_time', 'timestamp', 'calldate_timestamp_micros'],
  kampania: ['campaign', 'utm_campaign', 'source', 'utm_source', 'pool_name'],
} as const

// Klucze porównujemy bez wielkości liter i bez '$'.
function pole(p: Record<string, unknown>, nazwy: readonly string[]): unknown {
  const mapa = new Map<string, unknown>()
  for (const [k, v] of Object.entries(p)) mapa.set(k.toLowerCase().replace(/^\$/, ''), v)
  for (const n of nazwy) {
    const v = mapa.get(n)
    if (v !== undefined && v !== null && String(v).trim() !== '') return v
  }
  return null
}

export function normalizujTelefon(x: unknown): string | null {
  if (x === null || x === undefined) return null
  let s = String(x).trim().toLowerCase()
  if (!s || /anonym|unknown|private|restricted|zastrze|hidden|withheld/.test(s)) return null
  // testy 27.11 (2. seria): podpis maila z dwoma numerami („601 234 567, 602 345 678”) sklejał się w 18 cyfr —
  // bierzemy pierwszy numer z listy
  // testy 27.11 (runda 3): „/” nie jest już zwykłym separatorem — „32/455 00 00”, „tel./fax 32 455 00 00” dawały null
  // pierwszy kawałek z co najmniej 7 cyframi — „tel. i fax 32 455 00 00”, „tel., fax: …” nie kończą się na samym „tel.”
  const kawalki = s.split(/[,;]|\s(?:i|lub|or|albo)\s/)
  s = (kawalki.find((k) => k.replace(/\D/g, '').length >= 7) ?? kawalki[0]).trim()
  s = pierwszyPrzedUkosnikiem(s)
  s = s.replace(/[^\d+]/g, '')
  if (s.startsWith('00')) s = '+' + s.slice(2)
  const cyfry = s.replace(/\D/g, '')
  // E.164 ma najwyżej 15 cyfr (dłuższe = sklejone numery); minimum 7 jak dotąd — ta sama funkcja obsługuje Ringostat
  if (cyfry.length < 7 || cyfry.length > 15) return null
  if (s.startsWith('+')) return '+' + cyfry
  if (cyfry.length === 9) return '+48' + cyfry                 // polski numer bez prefiksu
  if (cyfry.length === 11 && cyfry.startsWith('48')) return '+' + cyfry
  if (cyfry.length === 10 && cyfry.startsWith('0')) return '+48' + cyfry.slice(1)
  return '+' + cyfry
}

// „/” tnie tylko wtedy, gdy przed nim jest już pełny numer (≥ 9 cyfr): „601 234 567 / 602 345 678” → pierwszy,
// „32 455 00 00/01” → „32 455 00 00”; przy krótszym początku „/” jest częścią zapisu: „32/455 00 00”, „tel./fax …”.
// testy 27.11 (runda 3)
function pierwszyPrzedUkosnikiem(s: string): string {
  const czesci = s.split('/')
  let lewa = ''
  for (let i = 0; i < czesci.length - 1; i++) {
    lewa = i === 0 ? czesci[0] : `${lewa}/${czesci[i]}`
    if (lewa.replace(/\D/g, '').length >= 9) return lewa.trim()
  }
  return s
}

function liczba(x: unknown): number {
  if (x === null || x === undefined) return 0
  if (typeof x === 'number') return Math.max(0, Math.round(x))
  const m = String(x).match(/\d+/)
  return m ? parseInt(m[0], 10) : 0
}

function czyLatoPL(d: Date): boolean {
  const r = d.getUTCFullYear()
  const ostatniaNiedz = (m: number) => {
    const x = new Date(Date.UTC(r, m + 1, 0))
    x.setUTCDate(x.getUTCDate() - x.getUTCDay())
    x.setUTCHours(1, 0, 0, 0)
    return x
  }
  return d >= ostatniaNiedz(2) && d < ostatniaNiedz(9)
}

export function normalizujDate(x: unknown): string | null {
  if (x === null || x === undefined) return null
  if (typeof x === 'number') return new Date(x > 1e12 ? Math.floor(x / 1000) : x * 1000).toISOString()
  const s = String(x).trim()
  if (/^\d{16}$/.test(s)) return new Date(parseInt(s.slice(0, 13), 10)).toISOString()   // mikrosekundy
  if (/^\d{13}$/.test(s)) return new Date(parseInt(s, 10)).toISOString()                 // milisekundy
  if (/^\d{10}$/.test(s)) return new Date(parseInt(s, 10) * 1000).toISOString()          // sekundy
  // "2026-11-14 11:11:11" bez strefy: Ringostat podaje czas lokalny projektu, czyli polski
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (m) {
    const utc = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? '0')))
    return new Date(utc.getTime() - (czyLatoPL(utc) ? 2 : 1) * 3600_000).toISOString()
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

export function czyOdebrana(status: unknown, czas_s: number): boolean {
  const s = String(status ?? '').toUpperCase()
  if (/MISSED|NO.?ANSWER|UNANSWER|BUSY|CANCEL|FAIL|VOICEMAIL|REJECT/.test(s)) return false
  if (/PROPER|ANSWER|SUCCESS|COMPLETED|^OK$/.test(s)) return true
  return czas_s > 0
}

export function kierunek(typ: unknown): 'przychodzaca' | 'wychodzaca' {
  const s = String(typ ?? '').toLowerCase()
  return /out|wych/.test(s) ? 'wychodzaca' : 'przychodzaca'
}

export function normalizujPayload(p: Record<string, unknown>): Rozmowa {
  const czas_s = liczba(pole(p, ALIASY.czas_s))
  const ivrRaw = pole(p, ALIASY.ivr)
  const id = pole(p, ALIASY.ringostat_call_id)
  const link = pole(p, ALIASY.link_nagrania)
  const kamp = pole(p, ALIASY.kampania)
  return {
    ringostat_call_id: id === null ? null : String(id),
    kierunek: kierunek(pole(p, ALIASY.typ_polaczenia)),
    odebrana: czyOdebrana(pole(p, ALIASY.status), czas_s),
    czas_s,
    ivr: ivrRaw === null ? null : String(ivrRaw).trim().slice(0, 10),
    numer_dzwoniacego: normalizujTelefon(pole(p, ALIASY.numer_dzwoniacego)),
    numer_docelowy: normalizujTelefon(pole(p, ALIASY.numer_docelowy)),
    link_nagrania: link !== null && /^https?:\/\//.test(String(link)) ? String(link) : null,
    data_rozmowy: normalizujDate(pole(p, ALIASY.data_rozmowy)) ?? new Date().toISOString(),
    kampania: kamp === null ? null : String(kamp).slice(0, 200),
  }
}

// Numer klienta: przy przychodzącej dzwoniący, przy wychodzącej ten, do kogo dzwoniła Magda.
export function numerKlienta(r: Rozmowa): string | null {
  return r.kierunek === 'przychodzaca' ? r.numer_dzwoniacego : r.numer_docelowy
}

// Decyzja, co robić z rozmową (zasady z CRM_PODRZWI_KONTEKST.md, „Przepływ: rozmowa z Ringostatu”).
export type Decyzja =
  | { krok: 'pomin'; powod: string }      // zapis rozmowy, nic więcej
  | { krok: 'nieodebrana' }               // nieodebrana przychodząca: lead + wpis w historii, BEZ zadania (Tymek 24.11), bez AI
  | { krok: 'bez_ai'; powod: string }     // zapis + podpięcie do leada, bez AI
  | { krok: 'analizuj' }                  // transkrypcja + AI

export const MIN_CZAS_S = 20

export function zdecyduj(r: Rozmowa, maTranskrypcje = false): Decyzja {
  if (!r.odebrana) {
    if (r.kierunek === 'przychodzaca') {
      return r.numer_dzwoniacego ? { krok: 'nieodebrana' } : { krok: 'pomin', powod: 'nieodebrana, numer zastrzeżony' }
    }
    return { krok: 'bez_ai', powod: 'wychodząca nieodebrana' }
  }
  if (maTranskrypcje) return { krok: 'analizuj' }
  if (r.czas_s < MIN_CZAS_S) return { krok: 'pomin', powod: `rozmowa krótsza niż ${MIN_CZAS_S} s` }
  if (!r.link_nagrania) return { krok: 'bez_ai', powod: 'brak linku do nagrania' }
  return { krok: 'analizuj' }
}

// Termin zadania (data) wg akcji, liczony w czasie polskim, zawsze w dzień roboczy.
export function terminAkcji(akcja: string, teraz = new Date()): string {
  const dni: Record<string, number> = { oddzwon: 0, dopytaj: 0, przygotuj_oferte: 1, follow_up: 3, reklamacja: 0 }
  return dzienRoboczy(dni[akcja] ?? 0, teraz)
}

// Zasada właściciela (2026-11-15): firma pracuje pn–pt 9–17, więc zadanie nigdy nie dostaje terminu w weekend.
// Dziś + N dni w czasie polskim; „dziś” po 17:00 → jutro; sobota/niedziela → poniedziałek.
// To samo robi w bazie crm.termin_roboczy() (trigger leady_termin_roboczy) – tu liczymy, żeby zdarzenia i opisy miały tę samą datę.
export function dzienRoboczy(plusDni: number, teraz = new Date()): string {
  const pl = new Date(teraz.getTime() + (czyLatoPL(teraz) ? 2 : 1) * 3600_000)
  if (plusDni === 0 && pl.getUTCHours() >= 17) plusDni = 1
  pl.setUTCDate(pl.getUTCDate() + plusDni)
  while (pl.getUTCDay() === 0 || pl.getUTCDay() === 6) pl.setUTCDate(pl.getUTCDate() + 1)
  return pl.toISOString().slice(0, 10)
}

// Etykiety (badge) z analizy AI; to samo, co crm.etykiety_z_analizy(jsonb) w bazie (zmieniasz tu = zmień tam).
export function etykietyZAnalizy(a: { kategoria?: string; dane?: Record<string, unknown>; rodzaj_klienta?: string; potrzeba?: string; podsumowanie?: string } | null | undefined): string[] {
  // uwaga: ta sama logika w crm.etykiety_z_analizy(jsonb) (migracja 20261117_crm_etykieta_alu.sql)
  if (!a) return []
  const out: string[] = []
  let kat = String(a.kategoria ?? '').toLowerCase()
  // „alu” = stolarka aluminiowa; drzwi KR Center w systemie Alu / Alu extra (Otto 41 Alu extra, TEST 01 17.11) to drzwi zewnętrzne
  const opis = `${a.dane?.system ?? ''} ${a.dane?.model ?? ''} ${a.potrzeba ?? ''}`.toLowerCase()
  if (kat === 'alu' && /alu extra|systemie alu|\botto\b|\blibre\b|kr center|steel|wood extra|drzwi zewn/.test(opis)) kat = 'zewnetrzne'
  if (kat === 'zewnetrzne') out.push('zewnetrzne')
  else if (kat === 'titan' || kat === 'bastion') out.push('wejsciowe')
  else if (kat === 'wewnetrzne') out.push('wewnetrzne')
  else if (kat === 'alu') out.push('alu')
  else if (kat === 'inne') out.push('inne')
  const dost = String(a.dane?.dostawa ?? '').toLowerCase()
  if (dost === 'kurier') out.push('dostawa')
  else if (dost === 'odbior_osobisty') out.push('odbior')
  const mont = String(a.dane?.montaz ?? '').toLowerCase()
  if (mont && !/(^| )(bez|nie|brak|sam|samodziel|własn|wlasn)/.test(mont)) out.push('montaz')
  const klient = String(a.rodzaj_klienta ?? '').toLowerCase()
  if (['indywidualny', 'firma', 'inwestycja'].includes(klient)) out.push(klient)
  const tekst = `${a.potrzeba ?? ''} ${a.dane?.inne ?? ''} ${a.podsumowanie ?? ''}`.toLowerCase()
  if (/czyste powietrze|dotacj/.test(tekst)) out.push('dotacja')
  return out
}

export const OPISY_AKCJI: Record<string, string> = {
  oddzwon: 'Oddzwoń do klienta.',
  dopytaj: 'Dopytaj o brakujące dane.',
  przygotuj_oferte: 'Sprawdź i wyślij ofertę.',
  follow_up: 'Zapytaj klienta o decyzję.',
  reklamacja: 'Reklamacja, skontaktuj się z klientem.',
}
