/**
 * Ekran oferty v2 (21.11, makieta „v2 · Oferta”): krok oferty (Ustalenia → Liczenie → Wysyłka → Decyzja klienta)
 * i ustalenia z analizy po polsku — tylko wypełnione pola.
 */

import { CRM_BRAK_CEN_PREFIX, CRM_BRAK_DOBORU_PREFIXES, CRM_SYSTEM_ERROR_PREFIX } from '../types/crm'

/** 'dobor' (24.11): system nie dobrał produktu i zadał pytania — handlowiec odpowiada, oferta liczy się od nowa */
/** 'ceny' (27.11): oferta z montażem zatrzymana, bo pozycje nie mają cen — PDF i mail nie powstały, handlowiec wpisuje ceny w poprawce */
export type KrokOferty = 'ustalenia' | 'liczenie' | 'dobor' | 'ceny' | 'blad' | 'wysylka' | 'decyzja' | 'koniec' | 'stara'

export const KROKI_OFERTY: Array<{ key: string; nazwa: string; opis: string }> = [
  { key: 'ustalenia', nazwa: 'Ustalenia', opis: 'sprawdź, czego chce klient' },
  { key: 'liczenie', nazwa: 'Liczenie', opis: 'system dobiera i liczy' },
  { key: 'wysylka', nazwa: 'Wysyłka', opis: 'sprawdź mail i wyślij' },
  { key: 'decyzja', nazwa: 'Decyzja klienta', opis: 'przyjął albo odmówił' },
]

/** Na którym kroku jest oferta i który z 4 kroków podświetlić (-1 = stara wersja, bez kroków). */
export function krokOferty(status: string | null | undefined, f: { sysErr?: boolean; pending?: boolean; brakDoboru?: boolean; brakCen?: boolean }): { krok: KrokOferty; idx: number } {
  if (status === 'robocza') return { krok: 'stara', idx: -1 }
  if (status === 'wstrzymana') return { krok: 'ustalenia', idx: 0 }
  if (f.sysErr) return { krok: 'blad', idx: 1 }
  if (f.brakDoboru) return { krok: 'dobor', idx: 1 }
  if (f.brakCen && status === 'do_sprawdzenia') return { krok: 'ceny', idx: 1 }
  if (f.pending || status === 'przelicz') return { krok: 'liczenie', idx: 1 }
  if (status === 'wyslana') return { krok: 'decyzja', idx: 3 }
  if (status === 'zaakceptowana' || status === 'odrzucona') return { krok: 'koniec', idx: 3 }
  return { krok: 'wysylka', idx: 2 }
}

/** Oferta z montażem zatrzymana bez cen: crm-oferta-pdf nie zrobił PDF-a ani maila, w sprawdz[0] jest „BRAK CEN: …”. */
export function brakCenOferty(o: { status?: string | null; rodzaj?: string | null; sprawdz?: unknown[] | null }): boolean {
  if (o.status !== 'do_sprawdzenia' || o.rodzaj !== 'oficjalna') return false
  const pierwsze = Array.isArray(o.sprawdz) && typeof o.sprawdz[0] === 'string' ? o.sprawdz[0] : ''
  return pierwsze.startsWith(CRM_BRAK_CEN_PREFIX)
}

/** Treść komunikatu „BRAK CEN: …” bez prefiksu (do paska „Co teraz”). */
export function brakCenOpis(sprawdz: string[]): string {
  const s = sprawdz[0] ?? ''
  return s.startsWith(CRM_BRAK_CEN_PREFIX) ? s.slice(CRM_BRAK_CEN_PREFIX.length).trim() : s
}

const ETYKIETY: Record<string, string> = {
  rodzaj: 'Rodzaj drzwi', kategoria: 'Rodzaj drzwi', typ: 'Rodzaj drzwi', model: 'Model', wzor: 'Wzór', system: 'System',
  ilosc: 'Ilość', sztuk: 'Ilość', rozmiar: 'Rozmiar skrzydła', szerokosc: 'Szerokość', wymiar_otworu: 'Wymiar otworu', wymiary: 'Wymiary',
  kierunek: 'Kierunek', sposob_otwierania: 'Sposób otwierania', otwieranie: 'Otwieranie',
  kolor: 'Kolor', kolor_skrzydla: 'Kolor skrzydła', kolor_osciezy: 'Kolor ościeżnicy', kolor_oscieznicy: 'Kolor ościeżnicy',
  wariant_panelu: 'Wariant panelu', panel: 'Panel', przeszklenie: 'Przeszklenie', szyba: 'Szyba', oslonki: 'Osłonki',
  okucia: 'Okucia', klamka: 'Klamka', zamek: 'Zamek', oscieznica: 'Ościeżnica',
  montaz: 'Montaż', dostawa: 'Dostawa', termin: 'Termin', budzet: 'Budżet', miejscowosc: 'Miejscowość', adres: 'Adres',
  inne: 'Inne', uwagi: 'Uwagi', poprawka_handlowca: 'Poprawka handlowca',
}

/** Klucz z analizy → etykieta po polsku; nieznany: podkreślniki na spacje, wielka litera. */
export function etykietaUstalenia(klucz: string): string {
  const k = klucz.toLowerCase()
  if (ETYKIETY[k]) return ETYKIETY[k]
  const t = klucz.replace(/_/g, ' ').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : klucz
}

const tekst = (v: unknown): string => {
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? 'tak' : 'nie'
  if (Array.isArray(v)) return v.map(tekst).filter(Boolean).join(', ')
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).map(([k, x]) => (tekst(x) ? `${etykietaUstalenia(k)}: ${tekst(x)}` : '')).filter(Boolean).join('; ')
  return String(v).trim()
}

/** Wypełnione pola ustaleń w czytelnej kolejności (najważniejsze najpierw), bez pustych. */
export function ustaleniaLista(dane: Record<string, unknown> | null | undefined): Array<{ klucz: string; nazwa: string; wartosc: string }> {
  if (!dane || typeof dane !== 'object') return []
  const kolejnosc = Object.keys(ETYKIETY)
  return Object.entries(dane)
    .map(([klucz, v]) => ({ klucz, nazwa: etykietaUstalenia(klucz), wartosc: tekst(v) }))
    .filter((u) => u.wartosc && u.wartosc !== '-' && u.wartosc.toLowerCase() !== 'brak' && u.wartosc.toLowerCase() !== 'null')
    .sort((a, b) => {
      const ia = kolejnosc.indexOf(a.klucz.toLowerCase())
      const ib = kolejnosc.indexOf(b.klucz.toLowerCase())
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib)
    })
}

/**
 * Wersje JEDNEJ oferty (łańcuch poprzednia_id), nie wszystkie oferty klienta — od 21.11 klient może mieć
 * kilka ofert równolegle (tytuł), a „Otwórz najnowszą” i lista „Wersje” miały skakać tylko po swojej.
 */
export function wersjeOferty<T extends { id: string; poprzednia_id?: string | null }>(wszystkie: T[], biezaca: { id: string; poprzednia_id?: string | null }): T[] {
  const po = new Map(wszystkie.map((w) => [w.id, w]))
  const korzen = (w: { id: string; poprzednia_id?: string | null }): string => {
    let cur = w
    const byly = new Set<string>()
    while (cur.poprzednia_id && po.has(cur.poprzednia_id) && !byly.has(cur.id)) {
      byly.add(cur.id)
      cur = po.get(cur.poprzednia_id)!
    }
    return cur.id
  }
  const moj = korzen(biezaca)
  return wszystkie.filter((w) => korzen(w) === moj)
}

/**
 * 24.11 (Perzanowski): oferta sklepowa, której system nie dobrał produktu — skończona (do_sprawdzenia), ale bez produktu,
 * ceny i maila. Dotąd ekran brał to za „w przygotowaniu” i kręcił spinner bez końca; teraz pokazuje pytania systemu.
 */
export function brakDoboruOferty(o: {
  status?: string | null; rodzaj?: string | null; produkt?: string | null; cena_razem?: number | null; sprawdz?: unknown[] | null; pytania?: unknown[] | null
}): boolean {
  if (o.status !== 'do_sprawdzenia' || o.rodzaj === 'oficjalna' || o.produkt || o.cena_razem != null) return false
  const pierwsze = Array.isArray(o.sprawdz) && typeof o.sprawdz[0] === 'string' ? o.sprawdz[0] : ''
  if (CRM_BRAK_DOBORU_PREFIXES.some((p) => pierwsze.startsWith(p))) return true
  return pytaniaOferty(o).length > 0
}

export function pytaniaOferty(o: { pytania?: unknown[] | null }): string[] {
  return Array.isArray(o.pytania) ? o.pytania.map((p) => String(p ?? '').trim()).filter(Boolean) : []
}

/** Tekst do analiza.odpowiedzi_handlowca: „pytanie → odpowiedź” (puste pomijane) + uwagi; pusty = nic nie wpisano. */
export function tekstOdpowiedzi(pytania: string[], odpowiedzi: Record<number, string>, uwagi: string): string {
  const linie = pytania.map((p, i) => ({ p, o: (odpowiedzi[i] ?? '').trim() })).filter((x) => x.o).map((x) => `${x.p} → ${x.o}`)
  const u = uwagi.trim()
  if (u) linie.push(u)
  return linie.join('\n')
}

/** Stan oferty na liście (v3, makieta „Oferty — lista”): krótka nazwa, jedno zdanie, kolor pigułki i przycisk. */
export type StanOferty = { label: string; opis: string; pill: '' | 'blue' | 'ok' | 'warn' | 'late'; przycisk: string; glowny: boolean }

export function stanOferty(o: {
  status: string; rodzaj?: string | null; sprawdz?: unknown[] | null; pytania?: unknown[] | null; produkt?: string | null; cena_razem?: number | null
  wyslano_at?: string | null; liczenie_od?: string | null
}, fmtData: (iso: string) => string = (iso) => iso.slice(0, 10)): StanOferty {
  const pierwsze = Array.isArray(o.sprawdz) && typeof o.sprawdz[0] === 'string' ? o.sprawdz[0] : ''
  if (o.status === 'wstrzymana') return { label: 'Sprawdź ustalenia', opis: 'system czeka na Twoje OK', pill: 'warn', przycisk: 'Sprawdź', glowny: true }
  if (o.status === 'przelicz') return { label: 'Liczy się', opis: 'zwykle do minuty', pill: '', przycisk: 'Podgląd', glowny: false }
  if (o.status === 'do_sprawdzenia') {
    if (pierwsze.startsWith(CRM_SYSTEM_ERROR_PREFIX)) return { label: 'Błąd liczenia', opis: 'nie wysyłaj — ponów albo zgłoś', pill: 'late', przycisk: 'Otwórz', glowny: true }
    if (brakCenOferty(o)) return { label: 'Brakuje cen', opis: 'PDF nie powstał — wpisz ceny', pill: 'late', przycisk: 'Wpisz ceny', glowny: true }
    if (brakDoboruOferty(o)) return { label: 'Pytania systemu', opis: 'odpowiedz, żeby dobrać produkt', pill: 'late', przycisk: 'Odpowiedz', glowny: true }
    return { label: 'Gotowa do wysłania', opis: o.rodzaj === 'oficjalna' ? 'dołącz PDF do maila' : 'sprawdź mail i wyślij', pill: 'warn', przycisk: 'Sprawdź i wyślij', glowny: true }
  }
  if (o.status === 'wyslana') return { label: 'Wysłana', opis: o.wyslano_at ? `czeka na decyzję od ${fmtData(o.wyslano_at)}` : 'czeka na decyzję', pill: 'blue', przycisk: 'Otwórz', glowny: false }
  if (o.status === 'zaakceptowana') return { label: 'Przyjęta', opis: 'klient zamówił', pill: 'ok', przycisk: 'Otwórz', glowny: false }
  if (o.status === 'odrzucona') return { label: 'Odrzucona', opis: '', pill: '', przycisk: 'Otwórz', glowny: false }
  if (o.status === 'wygasla') return { label: 'Wygasła', opis: '', pill: '', przycisk: 'Otwórz', glowny: false }
  if (o.status === 'robocza') return { label: 'Stara wersja', opis: 'klient dostał nowszą', pill: '', przycisk: 'Otwórz', glowny: false }
  return { label: o.status, opis: '', pill: '', przycisk: 'Otwórz', glowny: false }
}

/**
 * „Poproś o zmianę” (v3, Tymek 27.11: kilka pól — poprawka oferty, styl maila — było nieczytelne, a odpowiedź systemu
 * „nie umiałem” chowała się w „sprawdź”). Jedna lista próśb z wynikiem, z łańcucha wersji oferty:
 * wersja z `poprawka_wynik` = wynik prośby (tekst w `poprawka`), bieżąca w 'przelicz' z `poprawka` = prośba w toku.
 */
export type ProsbaOferty = {
  id: string
  wersja: number
  tekst: string | null
  stan: 'w_toku' | 'zrobione' | 'czesciowo' | 'nie'
  powody: string[]
  streszczenie: string | null
  kiedy: string
}

type WersjaMin = {
  id: string; wersja: number; status: string; poprzednia_id?: string | null; created_at: string; updated_at?: string | null
  poprawka?: string | null; poprawka_wynik?: Record<string, unknown> | null; rodzaj?: string | null; sprawdz?: unknown[] | null
}

export function prosbyOferty(lancuch: WersjaMin[]): ProsbaOferty[] {
  const out: ProsbaOferty[] = []
  const dzieci = new Map<string, WersjaMin[]>()
  for (const w of lancuch) if (w.poprzednia_id) dzieci.set(w.poprzednia_id, [...(dzieci.get(w.poprzednia_id) ?? []), w])
  for (const w of lancuch) {
    const tekst = (w.poprawka ?? '').trim()
    if (w.status === 'przelicz' && tekst) {
      out.push({ id: `${w.id}-w-toku`, wersja: w.wersja + 1, tekst, stan: 'w_toku', powody: [], streszczenie: null, kiedy: w.updated_at ?? w.created_at })
    }
    if (!w.poprawka_wynik) continue
    // tekst prośby nadpisany kolejną prośbą do tej wersji — zostaje sam wynik (streszczenie)
    const nadpisany = w.status === 'przelicz' || (dzieci.get(w.id) ?? []).some((c) => (c.poprawka ?? '').trim() === tekst)
    const pw = w.poprawka_wynik
    const niezrozumiane = Array.isArray(pw.niezrozumiane) ? (pw.niezrozumiane as unknown[]).map(String).filter(Boolean) : []
    const brakCen = brakCenOferty({ status: 'do_sprawdzenia', rodzaj: w.rodzaj, sprawdz: w.sprawdz })
    const powody = [...(brakCen ? [brakCenOpis(w.sprawdz as string[])] : []), ...niezrozumiane.map((n) => `nie zrozumiałem: „${n}”`)]
    out.push({
      id: w.id,
      wersja: w.wersja,
      tekst: nadpisany ? null : tekst || null,
      stan: brakCen ? 'nie' : niezrozumiane.length ? 'czesciowo' : 'zrobione',
      powody,
      streszczenie: typeof pw.streszczenie === 'string' && pw.streszczenie.trim() ? pw.streszczenie.trim() : null,
      kiedy: w.created_at,
    })
  }
  return out.sort((a, b) => b.kiedy.localeCompare(a.kiedy))
}
