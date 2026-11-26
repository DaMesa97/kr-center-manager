// Statystyki sprzedaży (Etap 25): logika po stronie aplikacji dla danych z RPC
// stat_wew_sprzedaz / stat_wew_miesiace / stat_wew_braki (drzwi wewnętrzne z Optimy)
// oraz stat_zew_miesiace / stat_zew_braki (STA, Disting, ST, Techniczne, Bastion).
// Ciężkie agregacje robi baza (migrate/statystyki_sprzedazy_wew.sql); tu tylko
// ranking, rozkłady, porównanie okresów („spada / rośnie / stabilne”) i kolejność braków.

export type WewSprzedazRow = {
  item_type: string
  grupa: string | null
  model: string | null
  linia: string | null
  wykonanie: string | null
  kolor: string | null
  rozmiar: string | null
  rozpoznane: boolean
  szt: number
  zlecenia: number
}

export type WewMiesiacRow = {
  /** pierwszy dzień miesiąca, 'YYYY-MM-DD' */
  miesiac: string
  item_type: string
  grupa: string | null
  wykonanie: string | null
  szt: number
  zlecenia: number
}

export type WewBrakRow = {
  optima_code: string
  optima_name: string | null
  item_type: string | null
  grupa: string | null
  model: string | null
  kolor: string | null
  rozmiar: string | null
  wykonanie: string | null
  component_id: number | null
  is_stocked: boolean | null
  stan: number | null
  otwarte_zlecenia: number
  otwarte_szt: number
  otwarte_sr_dni: number | null
  otwarte_max_dni: number | null
  otwarte_najstarsze: string | null
  hist_zlecenia: number
  hist_czekaly: number
  hist_sr_dni: number | null
  hist_max_dni: number | null
}

export type ZewMiesiacRow = {
  miesiac: string
  wymiar: 'system' | 'model' | 'kolor'
  wartosc: string
  zlecenia: number
  szt: number
}

export type ZewBrakRow = {
  component_id: number
  kod: string | null
  nazwa: string | null
  kategoria: string | null
  zlecenia: number
  wydania: number
  brak_szt: number | null
  pierwsze: string | null
  ostatnie: string | null
  sr_realizacja: number | null
  sr_realizacja_kat: number | null
  stan: number | null
  rezerwacje: number | null
  dostepne: number | null
}

export const ITEM_TYPE_LABELS: Record<string, string> = {
  door_wing: 'Skrzydła',
  door_frame: 'Ościeżnice',
  door_handle: 'Klamki',
  door_hinge_cover: 'Osłonki',
  door_accessory: 'Akcesoria',
  inne: 'Inne',
}

export const NIEROZPOZNANE = '(nierozpoznane)'
export const BRAK = '(brak)'

export type Wykonanie = 'all' | 'WEW' | 'NSTD'

export const WYKONANIE_LABELS: Record<Wykonanie, string> = {
  all: 'Wszystko',
  WEW: 'Z półki (WEW)',
  NSTD: 'Na zamówienie (NSTD)',
}

export function groupName(r: { grupa: string | null }): string {
  return (r.grupa ?? '').trim() || NIEROZPOZNANE
}

/** Filtr typu pozycji i wykonania. Wykonanie znają tylko skrzydła — przy innych typach filtr WEW/NSTD nic nie wycina. */
export function filterRows<T extends { item_type: string | null; wykonanie: string | null }>(
  rows: T[],
  itemType: string,
  wykonanie: Wykonanie,
): T[] {
  return rows.filter((r) => {
    if (itemType !== 'all' && (r.item_type ?? 'inne') !== itemType) return false
    if (wykonanie !== 'all' && r.wykonanie != null && r.wykonanie !== wykonanie) return false
    return true
  })
}

export type RankRow = {
  nazwa: string
  szt: number
  zlecenia: number
  /** procent sztuk w całości listy */
  udzial: number
}

export function rankBy<T>(
  rows: T[],
  key: (r: T) => string,
  qty: (r: T) => number,
  orders: (r: T) => number = () => 0,
): RankRow[] {
  const map = new Map<string, { szt: number; zlecenia: number }>()
  for (const r of rows) {
    const k = key(r)
    const cur = map.get(k) ?? { szt: 0, zlecenia: 0 }
    cur.szt += Number(qty(r)) || 0
    cur.zlecenia += Number(orders(r)) || 0
    map.set(k, cur)
  }
  const total = Array.from(map.values()).reduce((s, v) => s + v.szt, 0)
  return Array.from(map.entries())
    .map(([nazwa, v]) => ({ nazwa, szt: v.szt, zlecenia: v.zlecenia, udzial: total > 0 ? (v.szt / total) * 100 : 0 }))
    .sort((a, b) => b.szt - a.szt || a.nazwa.localeCompare(b.nazwa, 'pl'))
}

/** Ranking grup modelowych (nierozpoznane pozycje jako jedna pozycja na końcu listy, jeśli są). */
export function rankGroups(rows: WewSprzedazRow[]): RankRow[] {
  return rankBy(rows, groupName, (r) => r.szt, (r) => r.zlecenia)
}

export type Wymiar = 'kolor' | 'rozmiar' | 'linia' | 'model' | 'wykonanie'

/** Rozkład cechy (kolor / rozmiar / linia / model) w obrębie grupy albo całości. Rozmiary rosnąco, reszta po sztukach. */
export function distribution(rows: WewSprzedazRow[], wymiar: Wymiar, grupa: string | null = null): RankRow[] {
  const src = grupa ? rows.filter((r) => groupName(r) === grupa) : rows
  const out = rankBy(
    src,
    (r) => {
      const v = (r[wymiar] ?? '').trim()
      if (wymiar === 'linia' && !v) return 'standard'
      return v || BRAK
    },
    (r) => r.szt,
    (r) => r.zlecenia,
  )
  if (wymiar === 'rozmiar') {
    out.sort((a, b) => {
      const na = Number(a.nazwa)
      const nb = Number(b.nazwa)
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
      if (Number.isFinite(na)) return -1
      if (Number.isFinite(nb)) return 1
      return a.nazwa.localeCompare(b.nazwa, 'pl')
    })
  }
  return out
}

// ── Trend ────────────────────────────────────────────────────────────────

export type TrendMode = '1m' | '3m' | '6m'
export const TREND_MODE_LABELS: Record<TrendMode, string> = {
  '1m': 'miesiąc do miesiąca',
  '3m': '3 miesiące vs poprzednie 3',
  '6m': '6 miesięcy vs poprzednie 6',
}
export const TREND_MONTHS: Record<TrendMode, number> = { '1m': 1, '3m': 3, '6m': 6 }

export type TrendKind = 'rośnie' | 'spada' | 'stabilne' | 'nowe' | 'znika' | 'mało danych'

export type TrendRow = {
  nazwa: string
  teraz: number
  poprzednio: number
  /** procent zmiany (null, gdy poprzednio = 0) */
  zmianaPct: number | null
  kierunek: TrendKind
  /** sztuki w kolejnych miesiącach (od najstarszego), do małego wykresu */
  seria: number[]
  miesiace: string[]
}

export type TrendOpts = {
  /** próg procentowy „stabilne” (domyślnie ±10 %) */
  prog?: number
  /** poniżej tyle sztuk w obu okresach = „mało danych” (domyślnie 20) */
  min?: number
  /** licz też bieżący (niepełny) miesiąc — domyślnie nie */
  zBiezacym?: boolean
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** `n` kolejnych kluczy miesięcy kończących się miesiącem `end` (włącznie), od najstarszego. */
export function monthsEndingAt(end: Date, n: number): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(new Date(end.getFullYear(), end.getMonth() - i, 1)))
  return out
}

const MIESIACE_SKROT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru']

export function monthLabel(key: string): string {
  const [y, m] = key.split('-')
  const idx = Number(m) - 1
  return `${MIESIACE_SKROT[idx] ?? m} ${y}`
}

/** Okresy porównania: [bieżący okres, poprzedni okres] jako listy kluczy miesięcy. */
export function trendPeriods(mode: TrendMode, now: Date, zBiezacym = false): { teraz: string[]; poprzednio: string[] } {
  const n = TREND_MONTHS[mode]
  const end = zBiezacym ? new Date(now.getFullYear(), now.getMonth(), 1) : new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const teraz = monthsEndingAt(end, n)
  const poprzednio = monthsEndingAt(new Date(end.getFullYear(), end.getMonth() - n, 1), n)
  return { teraz, poprzednio }
}

export function periodLabel(keys: string[]): string {
  if (keys.length === 0) return '—'
  if (keys.length === 1) return monthLabel(keys[0])
  return `${monthLabel(keys[0])} – ${monthLabel(keys[keys.length - 1])}`
}

export function classifyTrend(teraz: number, poprzednio: number, opts: TrendOpts = {}): { kierunek: TrendKind; zmianaPct: number | null } {
  const prog = opts.prog ?? 10
  const min = opts.min ?? 20
  if (teraz < min && poprzednio < min) return { kierunek: 'mało danych', zmianaPct: poprzednio > 0 ? ((teraz - poprzednio) / poprzednio) * 100 : null }
  if (poprzednio === 0) return { kierunek: 'nowe', zmianaPct: null }
  if (teraz === 0) return { kierunek: 'znika', zmianaPct: -100 }
  const pct = ((teraz - poprzednio) / poprzednio) * 100
  if (Math.abs(pct) <= prog) return { kierunek: 'stabilne', zmianaPct: pct }
  return { kierunek: pct > 0 ? 'rośnie' : 'spada', zmianaPct: pct }
}

/**
 * Porównanie okresów po kluczu (grupa / system / model / kolor). `miesiac` w wierszach: 'YYYY-MM' albo 'YYYY-MM-DD'.
 * Wynik posortowany: najpierw „spada” (największy spadek), potem „rośnie”, „stabilne”, „nowe”, „znika”, „mało danych”.
 */
export function trendCompare(
  rows: Array<{ miesiac: string; klucz: string; szt: number }>,
  mode: TrendMode,
  now: Date,
  opts: TrendOpts = {},
): TrendRow[] {
  const { teraz, poprzednio } = trendPeriods(mode, now, opts.zBiezacym)
  const seriaKeys = [...poprzednio, ...teraz]
  const terazSet = new Set(teraz)
  const poprzSet = new Set(poprzednio)
  const perKey = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const mk = r.miesiac.slice(0, 7)
    if (!terazSet.has(mk) && !poprzSet.has(mk)) continue
    const m = perKey.get(r.klucz) ?? new Map<string, number>()
    m.set(mk, (m.get(mk) ?? 0) + (Number(r.szt) || 0))
    perKey.set(r.klucz, m)
  }
  const out: TrendRow[] = []
  for (const [klucz, m] of perKey) {
    const t = teraz.reduce((s, k) => s + (m.get(k) ?? 0), 0)
    const p = poprzednio.reduce((s, k) => s + (m.get(k) ?? 0), 0)
    const c = classifyTrend(t, p, opts)
    out.push({ nazwa: klucz, teraz: t, poprzednio: p, zmianaPct: c.zmianaPct, kierunek: c.kierunek, seria: seriaKeys.map((k) => m.get(k) ?? 0), miesiace: seriaKeys })
  }
  const order: Record<TrendKind, number> = { spada: 0, rośnie: 1, stabilne: 2, nowe: 3, znika: 4, 'mało danych': 5 }
  out.sort((a, b) => {
    const o = order[a.kierunek] - order[b.kierunek]
    if (o !== 0) return o
    if (a.kierunek === 'spada') return (a.zmianaPct ?? 0) - (b.zmianaPct ?? 0)
    if (a.kierunek === 'rośnie') return (b.zmianaPct ?? 0) - (a.zmianaPct ?? 0)
    return b.teraz - a.teraz
  })
  return out
}

export function wewTrend(rows: WewMiesiacRow[], mode: TrendMode, now: Date, opts: TrendOpts = {}): TrendRow[] {
  return trendCompare(rows.map((r) => ({ miesiac: r.miesiac, klucz: groupName(r), szt: r.szt })), mode, now, opts)
}

export function zewTrend(rows: ZewMiesiacRow[], wymiar: ZewMiesiacRow['wymiar'], mode: TrendMode, now: Date, opts: TrendOpts = {}): TrendRow[] {
  return trendCompare(
    rows.filter((r) => r.wymiar === wymiar).map((r) => ({ miesiac: r.miesiac, klucz: r.wartosc, szt: r.szt })),
    mode,
    now,
    opts,
  )
}

/** Suma sztuk per miesiąc (do wykresu w czasie), tylko miesiące z listy `keys`, w jej kolejności. */
export function monthlySeries(rows: Array<{ miesiac: string; szt: number }>, keys: string[]): Array<{ miesiac: string; etykieta: string; szt: number }> {
  const map = new Map<string, number>()
  for (const r of rows) {
    const mk = r.miesiac.slice(0, 7)
    map.set(mk, (map.get(mk) ?? 0) + (Number(r.szt) || 0))
  }
  return keys.map((k) => ({ miesiac: k, etykieta: monthLabel(k), szt: map.get(k) ?? 0 }))
}

export const TREND_BADGE: Record<TrendKind, string> = {
  spada: 'badge-danger',
  rośnie: 'badge-success',
  stabilne: 'badge-neutral',
  nowe: 'badge-info',
  znika: 'badge-warning',
  'mało danych': 'badge-neutral',
}

export function formatPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const r = Math.round(v)
  return `${r > 0 ? '+' : ''}${r} %`
}

// ── Braki, na które czeka klient ───────────────────────────────────────────

/** Ranking „teraz czekają”: najwięcej otwartych zleceń × najdłużej (średnio) czekają. */
export function shortageScoreNow(r: WewBrakRow): number {
  return r.otwarte_zlecenia * Math.max(Number(r.otwarte_sr_dni) || 0, 1)
}

/** Ranking „ostatnie N dni”: ile razy klient czekał dłużej niż próg × ile średnio dni. */
export function shortageScoreHist(r: WewBrakRow): number {
  return r.hist_czekaly * Math.max(Number(r.hist_sr_dni) || 0, 1)
}

export function sortShortagesNow(rows: WewBrakRow[]): WewBrakRow[] {
  return rows
    .filter((r) => r.otwarte_zlecenia > 0)
    .sort((a, b) => shortageScoreNow(b) - shortageScoreNow(a) || b.otwarte_zlecenia - a.otwarte_zlecenia)
}

export function sortShortagesHist(rows: WewBrakRow[]): WewBrakRow[] {
  return rows
    .filter((r) => r.hist_czekaly > 0)
    .sort((a, b) => shortageScoreHist(b) - shortageScoreHist(a) || b.hist_czekaly - a.hist_czekaly)
}

/** Opis pozycji braku: grupa + kolor + rozmiar, a gdy nierozpoznana — nazwa z Optimy. */
export function shortageLabel(r: Pick<WewBrakRow, 'grupa' | 'model' | 'kolor' | 'rozmiar' | 'optima_name' | 'optima_code'>): string {
  if (!r.grupa) return r.optima_name ?? r.optima_code
  return [r.model ?? r.grupa, r.kolor, r.rozmiar].filter((x) => x && String(x).trim()).join(' · ')
}

export function sortZewShortages(rows: ZewBrakRow[]): ZewBrakRow[] {
  return [...rows].sort((a, b) => b.zlecenia - a.zlecenia || (Number(b.brak_szt) || 0) - (Number(a.brak_szt) || 0))
}

// ── Normalizacja wierszy z PostgREST (numeric przychodzi jako tekst, bigint jako liczba) ──

const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v) || 0)
const numOrNull = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
const str = (v: unknown): string | null => (v == null ? null : String(v))

export function normalizeWewSprzedaz(r: Record<string, unknown>): WewSprzedazRow {
  return {
    item_type: String(r.item_type ?? 'inne'), grupa: str(r.grupa), model: str(r.model), linia: str(r.linia), wykonanie: str(r.wykonanie),
    kolor: str(r.kolor), rozmiar: str(r.rozmiar), rozpoznane: r.rozpoznane === true, szt: num(r.szt), zlecenia: num(r.zlecenia),
  }
}

export function normalizeWewMiesiac(r: Record<string, unknown>): WewMiesiacRow {
  return { miesiac: String(r.miesiac ?? ''), item_type: String(r.item_type ?? 'inne'), grupa: str(r.grupa), wykonanie: str(r.wykonanie), szt: num(r.szt), zlecenia: num(r.zlecenia) }
}

export function normalizeWewBrak(r: Record<string, unknown>): WewBrakRow {
  return {
    optima_code: String(r.optima_code ?? ''), optima_name: str(r.optima_name), item_type: str(r.item_type), grupa: str(r.grupa), model: str(r.model),
    kolor: str(r.kolor), rozmiar: str(r.rozmiar), wykonanie: str(r.wykonanie), component_id: numOrNull(r.component_id),
    is_stocked: typeof r.is_stocked === 'boolean' ? r.is_stocked : null, stan: numOrNull(r.stan),
    otwarte_zlecenia: num(r.otwarte_zlecenia), otwarte_szt: num(r.otwarte_szt), otwarte_sr_dni: numOrNull(r.otwarte_sr_dni), otwarte_max_dni: numOrNull(r.otwarte_max_dni),
    otwarte_najstarsze: str(r.otwarte_najstarsze), hist_zlecenia: num(r.hist_zlecenia), hist_czekaly: num(r.hist_czekaly), hist_sr_dni: numOrNull(r.hist_sr_dni), hist_max_dni: numOrNull(r.hist_max_dni),
  }
}

export function normalizeZewMiesiac(r: Record<string, unknown>): ZewMiesiacRow {
  const w = String(r.wymiar ?? 'system')
  return { miesiac: String(r.miesiac ?? ''), wymiar: w === 'model' || w === 'kolor' ? w : 'system', wartosc: String(r.wartosc ?? BRAK), zlecenia: num(r.zlecenia), szt: num(r.szt) }
}

export function normalizeZewBrak(r: Record<string, unknown>): ZewBrakRow {
  return {
    component_id: num(r.component_id), kod: str(r.kod), nazwa: str(r.nazwa), kategoria: str(r.kategoria), zlecenia: num(r.zlecenia), wydania: num(r.wydania),
    brak_szt: numOrNull(r.brak_szt), pierwsze: str(r.pierwsze), ostatnie: str(r.ostatnie), sr_realizacja: numOrNull(r.sr_realizacja), sr_realizacja_kat: numOrNull(r.sr_realizacja_kat),
    stan: numOrNull(r.stan), rezerwacje: numOrNull(r.rezerwacje), dostepne: numOrNull(r.dostepne),
  }
}

export function formatDays(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const n = Number(v)
  const r = Math.round(n * 10) / 10
  return `${Number.isInteger(r) ? r : r.toFixed(1)} dn.`
}
