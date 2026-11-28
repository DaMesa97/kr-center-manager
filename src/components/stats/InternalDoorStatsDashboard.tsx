import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from '../../supabaseClient'
import Spinner from '../Spinner'
import DataTable, { type DataTableColumn } from '../DataTable'
import { fetchAllPages } from '../../lib/fetchPaged'
import { localDateStr, minusMonths } from '../../lib/localDates'
import { appPrompt } from '../../lib/appDialogs'
import { FIRMA_LABELS, firmaArgs, type FirmaStat } from '../../lib/wewFirma'
import {
  BRAK,
  ITEM_TYPE_LABELS,
  NIEROZPOZNANE,
  TREND_BADGE,
  TREND_MODE_LABELS,
  WYKONANIE_LABELS,
  distribution,
  filterRows,
  formatDays,
  formatPct,
  groupName,
  monthlySeries,
  monthsEndingAt,
  normalizeWewBrak,
  normalizeWewMiesiac,
  normalizeWewSprzedaz,
  periodLabel,
  rankGroups,
  shortageLabel,
  sortShortagesHist,
  sortShortagesNow,
  trendPeriods,
  wewTrend,
  type RankRow,
  type TrendMode,
  type TrendRow,
  type WewBrakRow,
  type WewMiesiacRow,
  type WewSprzedazRow,
  type Wykonanie,
} from '../../lib/salesStats'

/**
 * Statystyki → Drzwi wewnętrzne (Etap 25): co się sprzedaje po grupach modelowych, kolorach
 * i rozmiarach, co spada / rośnie, na co czeka klient. Liczby przychodzą z RPC
 * stat_wew_sprzedaz / stat_wew_miesiace / stat_wew_braki (migrate/statystyki_sprzedazy_wew.sql),
 * cechy pozycji ze słownika interior_item_dict (rozbiór nazwy kartoteki Optimy).
 */

type Props = {
  /** kierownik może przypisać grupę nierozpoznanej pozycji (rpc interior_item_dict_set) */
  isManager?: boolean
}

const ITEM_FILTERS = [
  { key: 'door_wing', label: 'Skrzydła' },
  { key: 'door_frame', label: 'Ościeżnice' },
  { key: 'door_handle', label: 'Klamki' },
  { key: 'door_hinge_cover', label: 'Osłonki' },
  { key: 'door_accessory', label: 'Akcesoria' },
  { key: 'all', label: 'Wszystko' },
] as const

type ItemFilter = (typeof ITEM_FILTERS)[number]['key']
type BrakiTab = 'teraz' | 'historia'
type DictRow = { optima_code: string; optima_name: string | null; item_type: string | null; pomijane?: boolean }

const LS = {
  typ: 'stats.wew.typ',
  wykonanie: 'stats.wew.wykonanie',
  okres: 'stats.wew.okres',
  trend: 'stats.wew.trend',
  firma: 'stats.wew.firma',
}

function readLs<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

function writeLs(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* prywatne okno / brak miejsca — ustawienie po prostu nie zostaje */
  }
}

const COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4']

function shortName(s: string, max = 26): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export default function InternalDoorStatsDashboard({ isManager = false }: Props) {
  const [itemFilter, setItemFilter] = useState<ItemFilter>(() => readLs(LS.typ, ITEM_FILTERS.map((f) => f.key), 'door_wing'))
  const [wykonanie, setWykonanie] = useState<Wykonanie>(() => readLs(LS.wykonanie, ['all', 'WEW', 'NSTD'] as const, 'all'))
  // D10 (28.11): KR Center / MR Profil / obie — parametr p_firma funkcji stat_wew_* (migracja 20261128036102)
  const [firma, setFirma] = useState<FirmaStat>(() => readLs(LS.firma, ['KR', 'MR', 'all'] as const, 'KR'))
  /** baza bez p_firma (migracja niewgrana) — liczby jak dotąd, wszystkie zlecenia */
  const [firmaNiedostepna, setFirmaNiedostepna] = useState(false)
  const [months, setMonths] = useState<number>(() => Number(readLs(LS.okres, ['3', '6', '12', '24'] as const, '12')))
  const [trendMode, setTrendMode] = useState<TrendMode>(() => readLs(LS.trend, ['1m', '3m', '6m'] as const, '3m'))
  const [zBiezacym, setZBiezacym] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [brakiTab, setBrakiTab] = useState<BrakiTab>('teraz')
  const [brakiDays, setBrakiDays] = useState(180)
  const [brakiProg, setBrakiProg] = useState(7)
  const [visibleBraki, setVisibleBraki] = useState(30)

  const [sprzedaz, setSprzedaz] = useState<WewSprzedazRow[]>([])
  const [miesiace, setMiesiace] = useState<WewMiesiacRow[]>([])
  const [braki, setBraki] = useState<WewBrakRow[]>([])
  const [nierozpoznane, setNierozpoznane] = useState<DictRow[]>([])
  const [loadingSprzedaz, setLoadingSprzedaz] = useState(true)
  const [loadingMiesiace, setLoadingMiesiace] = useState(true)
  const [loadingBraki, setLoadingBraki] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => writeLs(LS.typ, itemFilter), [itemFilter])
  useEffect(() => writeLs(LS.wykonanie, wykonanie), [wykonanie])
  useEffect(() => writeLs(LS.okres, String(months)), [months])
  useEffect(() => writeLs(LS.trend, trendMode), [trendMode])
  useEffect(() => writeLs(LS.firma, firma), [firma])

  const loadSprzedaz = useCallback(async (m: number) => {
    setLoadingSprzedaz(true)
    const from = minusMonths(new Date(), m) // runda 10: 31.05 − 3 mies. dawało 3.03
    const pobierz = (zFirma: boolean) => fetchAllPages<Record<string, unknown>>((a, b) =>
      supabase
        .rpc('stat_wew_sprzedaz', firmaArgs({ p_from: localDateStr(from), p_to: localDateStr(new Date()) }, firma, zFirma))
        .order('item_type').order('grupa').order('model').order('linia').order('wykonanie').order('kolor').order('rozmiar')
        .range(a, b),
    )
    let { data, error: err } = await pobierz(true)
    if (err?.code === 'PGRST202') { setFirmaNiedostepna(true); ({ data, error: err } = await pobierz(false)) }
    setLoadingSprzedaz(false)
    if (err) {
      console.error('[Statystyki wewnętrzne] sprzedaż', err)
      setError(`Nie wczytano sprzedaży: ${err.message}`)
      setSprzedaz([])
      return
    }
    setSprzedaz((data ?? []).map(normalizeWewSprzedaz))
  }, [firma])

  const loadMiesiace = useCallback(async () => {
    setLoadingMiesiace(true)
    const pobierz = (zFirma: boolean) => fetchAllPages<Record<string, unknown>>((a, b) =>
      supabase.rpc('stat_wew_miesiace', firmaArgs({ p_months: 13 }, firma, zFirma)).order('miesiac').order('item_type').order('grupa').order('wykonanie').range(a, b),
    )
    let { data, error: err } = await pobierz(true)
    if (err?.code === 'PGRST202') { setFirmaNiedostepna(true); ({ data, error: err } = await pobierz(false)) }
    setLoadingMiesiace(false)
    if (err) {
      console.error('[Statystyki wewnętrzne] miesiące', err)
      setError(`Nie wczytano trendu: ${err.message}`)
      setMiesiace([])
      return
    }
    setMiesiace((data ?? []).map(normalizeWewMiesiac))
  }, [firma])

  const loadBraki = useCallback(async (days: number, prog: number) => {
    setLoadingBraki(true)
    const pobierz = (zFirma: boolean) => fetchAllPages<Record<string, unknown>>((a, b) =>
      supabase.rpc('stat_wew_braki', firmaArgs({ p_days: days, p_prog: prog }, firma, zFirma)).order('optima_code').range(a, b),
    )
    let { data, error: err } = await pobierz(true)
    if (err?.code === 'PGRST202') { setFirmaNiedostepna(true); ({ data, error: err } = await pobierz(false)) }
    setLoadingBraki(false)
    if (err) {
      console.error('[Statystyki wewnętrzne] braki', err)
      setError(`Nie wczytano braków: ${err.message}`)
      setBraki([])
      return
    }
    setBraki((data ?? []).map(normalizeWewBrak))
  }, [firma])

  const loadNierozpoznane = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('interior_item_dict')
      .select('optima_code, optima_name, item_type, pomijane')
      .eq('rozpoznane', false)
      .eq('pomijane', false)
      .order('optima_code')
      .limit(300)
    if (err) {
      console.error('[Statystyki wewnętrzne] słownik', err)
      return
    }
    setNierozpoznane((data ?? []) as DictRow[])
  }, [])

  useEffect(() => { void loadSprzedaz(months) }, [months, loadSprzedaz])
  useEffect(() => { void loadMiesiace() }, [loadMiesiace])
  useEffect(() => { void loadBraki(brakiDays, brakiProg) }, [brakiDays, brakiProg, loadBraki])
  useEffect(() => { void loadNierozpoznane() }, [loadNierozpoznane])

  // ── sprzedaż po cechach ──
  const rows = useMemo(() => filterRows(sprzedaz, itemFilter, wykonanie), [sprzedaz, itemFilter, wykonanie])
  const ranking = useMemo(() => rankGroups(rows), [rows])
  const totalSzt = useMemo(() => rows.reduce((s, r) => s + r.szt, 0), [rows])
  // zlecenia liczone per cecha, więc suma = „ile razy pozycja była w zleceniu”
  const totalZlecenia = useMemo(() => rows.reduce((s, r) => s + r.zlecenia, 0), [rows])
  const rozpoznanePct = useMemo(() => {
    const ok = rows.filter((r) => r.rozpoznane).reduce((s, r) => s + r.szt, 0)
    return totalSzt > 0 ? (ok / totalSzt) * 100 : 100
  }, [rows, totalSzt])

  const activeGroup = useMemo(() => {
    if (selectedGroup && ranking.some((r) => r.nazwa === selectedGroup)) return selectedGroup
    return null
  }, [selectedGroup, ranking])
  const kolory = useMemo(() => distribution(rows, 'kolor', activeGroup), [rows, activeGroup])
  const rozmiary = useMemo(() => distribution(rows, 'rozmiar', activeGroup), [rows, activeGroup])
  const linie = useMemo(() => distribution(rows, 'linia', activeGroup), [rows, activeGroup])
  const wykonania = useMemo(() => distribution(rows, 'wykonanie', activeGroup), [rows, activeGroup])

  const top12 = useMemo(() => ranking.slice(0, 12).map((r) => ({ ...r, krotka: shortName(r.nazwa, 22) })), [ranking])

  // ── w czasie i trend ──
  const miesiaceFiltr = useMemo(() => filterRows(miesiace, itemFilter, wykonanie), [miesiace, itemFilter, wykonanie])
  const seria = useMemo(() => {
    const now = new Date()
    const keys = monthsEndingAt(new Date(now.getFullYear(), now.getMonth(), 1), 13)
    const src = activeGroup ? miesiaceFiltr.filter((r) => groupName(r) === activeGroup) : miesiaceFiltr
    return monthlySeries(src, keys)
  }, [miesiaceFiltr, activeGroup])
  const trend = useMemo(() => wewTrend(miesiaceFiltr, trendMode, new Date(), { zBiezacym }), [miesiaceFiltr, trendMode, zBiezacym])
  const okresy = useMemo(() => trendPeriods(trendMode, new Date(), zBiezacym), [trendMode, zBiezacym])
  const trendPodsumowanie = useMemo(() => {
    const c = { spada: 0, rośnie: 0, stabilne: 0 }
    for (const t of trend) if (t.kierunek in c) c[t.kierunek as keyof typeof c] += 1
    return c
  }, [trend])

  // ── braki ──
  const brakiFiltr = useMemo(() => filterRows(braki, itemFilter, wykonanie), [braki, itemFilter, wykonanie])
  const brakiTeraz = useMemo(() => sortShortagesNow(brakiFiltr), [brakiFiltr])
  const brakiHist = useMemo(() => sortShortagesHist(brakiFiltr), [brakiFiltr])
  const brakiRows = brakiTab === 'teraz' ? brakiTeraz : brakiHist

  const reloadAll = useCallback(
    () => Promise.all([loadNierozpoznane(), loadSprzedaz(months), loadMiesiace(), loadBraki(brakiDays, brakiProg)]),
    [loadNierozpoznane, loadSprzedaz, loadMiesiace, loadBraki, months, brakiDays, brakiProg],
  )

  const assignGroup = useCallback(async (code: string, name: string | null) => {
    const v = await appPrompt(`Grupa modelowa dla „${name ?? code}” (np. VERONA, OR3, IBERIA):`, { title: 'Przypisz grupę', confirmLabel: 'Zapisz' })
    if (v == null || !v.trim()) return
    const { error: err } = await supabase.rpc('interior_item_dict_set', { p_code: code, p_grupa: v.trim() })
    if (err) {
      setError(`Nie zapisano grupy: ${err.message}`)
      return
    }
    await reloadAll()
  }, [reloadAll])

  // „To nie drzwi wewnętrzne” (np. kartoteka Bastion w RO) — pozycja znika ze wszystkich liczb w tej zakładce
  const excludeItem = useCallback(async (code: string) => {
    const { error: err } = await supabase.rpc('interior_item_dict_set', { p_code: code, p_pomijane: true })
    if (err) {
      setError(`Nie oznaczono pozycji: ${err.message}`)
      return
    }
    await reloadAll()
  }, [reloadAll])

  const rankColumns = useMemo<DataTableColumn<RankRow>[]>(() => [
    {
      key: 'nazwa', label: 'Grupa modelowa', sortValue: (r) => r.nazwa,
      render: (r) => (
        <button type="button" className="btn-link" onClick={() => setSelectedGroup((g) => (g === r.nazwa ? null : r.nazwa))} title="Pokaż kolory i rozmiary tej grupy">
          {r.nazwa === NIEROZPOZNANE ? <span style={{ color: '#6b7280' }}>{r.nazwa}</span> : r.nazwa}
        </button>
      ),
    },
    { key: 'szt', label: 'Sztuki', align: 'right', sortValue: (r) => r.szt, render: (r) => r.szt.toLocaleString('pl-PL') },
    { key: 'zlecenia', label: 'W zleceniach', align: 'right', sortValue: (r) => r.zlecenia, render: (r) => r.zlecenia.toLocaleString('pl-PL'), title: 'Ile zleceń miało pozycję z tej grupy' },
    { key: 'udzial', label: 'Udział', align: 'right', sortValue: (r) => r.udzial, render: (r) => `${r.udzial.toFixed(1)} %` },
  ], [])

  const trendColumns = useMemo<DataTableColumn<TrendRow>[]>(() => [
    { key: 'nazwa', label: 'Grupa modelowa', sortValue: (r) => r.nazwa, render: (r) => r.nazwa },
    { key: 'poprzednio', label: periodLabel(okresy.poprzednio), align: 'right', sortValue: (r) => r.poprzednio, render: (r) => r.poprzednio.toLocaleString('pl-PL') },
    { key: 'teraz', label: periodLabel(okresy.teraz), align: 'right', sortValue: (r) => r.teraz, render: (r) => r.teraz.toLocaleString('pl-PL') },
    { key: 'zmiana', label: 'Zmiana', align: 'right', sortValue: (r) => r.zmianaPct ?? -999, render: (r) => formatPct(r.zmianaPct) },
    { key: 'kierunek', label: 'Ocena', sortValue: (r) => r.kierunek, render: (r) => <span className={`badge ${TREND_BADGE[r.kierunek]}`}>{r.kierunek}</span> },
    {
      key: 'seria', label: 'Miesiące', title: 'Sztuki w kolejnych miesiącach obu okresów',
      render: (r) => <span style={{ fontVariantNumeric: 'tabular-nums', color: '#6b7280' }}>{r.seria.join(' · ')}</span>,
    },
  ], [okresy])

  const brakiColumns = useMemo<DataTableColumn<WewBrakRow>[]>(() => {
    const base: DataTableColumn<WewBrakRow>[] = [
      {
        key: 'pozycja', label: 'Pozycja', sortValue: (r) => shortageLabel(r),
        render: (r) => (
          <span title={r.optima_name ?? r.optima_code}>
            {shortageLabel(r)}
            {r.wykonanie === 'NSTD' && <span className="badge badge-neutral" style={{ marginLeft: 6 }}>na zamówienie</span>}
          </span>
        ),
      },
      { key: 'typ', label: 'Typ', sortValue: (r) => r.item_type ?? '', render: (r) => ITEM_TYPE_LABELS[r.item_type ?? 'inne'] ?? r.item_type ?? '—' },
    ]
    if (brakiTab === 'teraz') {
      base.push(
        { key: 'otw', label: 'Otwarte zlecenia', align: 'right', sortValue: (r) => r.otwarte_zlecenia, render: (r) => r.otwarte_zlecenia },
        { key: 'szt', label: 'Sztuki', align: 'right', sortValue: (r) => r.otwarte_szt, render: (r) => r.otwarte_szt },
        { key: 'sr', label: 'Czeka średnio', align: 'right', sortValue: (r) => r.otwarte_sr_dni ?? 0, render: (r) => formatDays(r.otwarte_sr_dni) },
        { key: 'max', label: 'Najdłużej', align: 'right', sortValue: (r) => r.otwarte_max_dni ?? 0, render: (r) => formatDays(r.otwarte_max_dni) },
        { key: 'od', label: 'Najstarsze zlecenie', sortValue: (r) => r.otwarte_najstarsze ?? '', render: (r) => r.otwarte_najstarsze ?? '—' },
      )
    } else {
      base.push(
        { key: 'hz', label: 'Zleceń', align: 'right', sortValue: (r) => r.hist_zlecenia, render: (r) => r.hist_zlecenia, title: 'Wydane zlecenia z tą pozycją w wybranym okresie' },
        { key: 'hc', label: `Czekały > ${brakiProg} dni`, align: 'right', sortValue: (r) => r.hist_czekaly, render: (r) => <b>{r.hist_czekaly}</b> },
        { key: 'hp', label: '% zleceń', align: 'right', sortValue: (r) => (r.hist_zlecenia ? r.hist_czekaly / r.hist_zlecenia : 0), render: (r) => (r.hist_zlecenia ? `${Math.round((r.hist_czekaly / r.hist_zlecenia) * 100)} %` : '—') },
        { key: 'hs', label: 'Czekały średnio', align: 'right', sortValue: (r) => r.hist_sr_dni ?? 0, render: (r) => formatDays(r.hist_sr_dni) },
        { key: 'hm', label: 'Najdłużej', align: 'right', sortValue: (r) => r.hist_max_dni ?? 0, render: (r) => formatDays(r.hist_max_dni) },
      )
    }
    base.push({
      key: 'mag', label: 'Na magazynie', title: 'Pole „Na magazynie” komponentu i stan w magazynie wewnętrznym',
      sortValue: (r) => (r.is_stocked ? 1 : 0),
      render: (r) => (r.component_id == null ? '—' : r.is_stocked ? `TAK · stan ${r.stan ?? 0}` : 'NIE (kartoteka w tle)'),
    })
    return base
  }, [brakiTab, brakiProg])

  if (loadingSprzedaz && sprzedaz.length === 0 && !error) {
    return <div className="stats-dashboard"><Spinner center label="Ładowanie…" /></div>
  }

  const grupaTytul = activeGroup ? `— ${activeGroup}` : '— wszystkie grupy'
  const typLabel = ITEM_FILTERS.find((f) => f.key === itemFilter)?.label ?? ''

  return (
    <div className="stats-dashboard">
      {error && <div className="stats-card" style={{ color: '#b3261e', marginBottom: 12 }}>{error}</div>}

      <div className="stats-card-header" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="alerts-filter-pills" style={{ margin: 0 }}>
          {ITEM_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`alerts-filter-pill ${itemFilter === f.key ? 'alerts-filter-pill--active' : ''}`}
              onClick={() => { setItemFilter(f.key); setSelectedGroup(null) }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          className="day-filter"
          value={firma}
          onChange={(e) => setFirma(e.target.value as FirmaStat)}
          disabled={firmaNiedostepna}
          title={firmaNiedostepna ? 'Filtr firmy zadziała po aktualizacji bazy — teraz liczone są wszystkie zlecenia' : 'Zlecenia z RO bazy MR Profil liczą się osobno (numery „MR/…”)'}
        >
          {(Object.keys(FIRMA_LABELS) as FirmaStat[]).map((k) => <option key={k} value={k}>{FIRMA_LABELS[k]}</option>)}
        </select>
        <select className="day-filter" value={wykonanie} onChange={(e) => setWykonanie(e.target.value as Wykonanie)} title="Skrzydła WEW trzymamy na półce, NSTD są na zamówienie">
          {(Object.keys(WYKONANIE_LABELS) as Wykonanie[]).map((k) => <option key={k} value={k}>{WYKONANIE_LABELS[k]}</option>)}
        </select>
        <select className="day-filter" value={months} onChange={(e) => setMonths(Number(e.target.value))} title="Okres sprzedaży (po dacie zlecenia, bez anulowanych)">
          <option value={3}>ostatnie 3 miesiące</option>
          <option value={6}>ostatnie 6 miesięcy</option>
          <option value={12}>ostatnie 12 miesięcy</option>
          <option value={24}>ostatnie 24 miesiące</option>
        </select>
        {loadingSprzedaz && <Spinner label="" />}
      </div>

      <div className="stats-grid-full">
        <div className="stats-card">
          <div className="stats-kpi-row">
            <div className="stats-kpi">
              <div className="stats-kpi-value">{totalSzt.toLocaleString('pl-PL')}</div>
              <div className="stats-kpi-label">{typLabel} — sztuki w okresie</div>
            </div>
            <div className="stats-kpi">
              <div className="stats-kpi-value">{ranking.filter((r) => r.nazwa !== NIEROZPOZNANE).length}</div>
              <div className="stats-kpi-label">grup modelowych</div>
            </div>
            <div className="stats-kpi">
              <div className="stats-kpi-value">{totalZlecenia.toLocaleString('pl-PL')}</div>
              <div className="stats-kpi-label">pozycji w zleceniach</div>
            </div>
            <div className="stats-kpi">
              <div className="stats-kpi-value">{rozpoznanePct.toFixed(1)} %</div>
              <div className="stats-kpi-label">sztuk z rozpoznaną grupą</div>
            </div>
            <div className="stats-kpi">
              <div className="stats-kpi-value" style={{ color: trendPodsumowanie.spada ? '#b3261e' : undefined }}>{trendPodsumowanie.spada}</div>
              <div className="stats-kpi-label">grup spada ({TREND_MODE_LABELS[trendMode]})</div>
            </div>
            <div className="stats-kpi">
              <div className="stats-kpi-value">{brakiTeraz.length}</div>
              <div className="stats-kpi-label">pozycji, na które klient teraz czeka</div>
            </div>
          </div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stats-card">
          <h3>Co się sprzedaje — grupy modelowe</h3>
          {ranking.length === 0 ? (
            <p style={{ color: '#6b7280' }}>Brak sprzedaży dla wybranego filtra.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={Math.max(220, top12.length * 26)}>
                <BarChart data={top12} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="krotka" width={150} />
                  <Tooltip formatter={(v) => [Number(v).toLocaleString('pl-PL'), 'Sztuki']} />
                  <Bar dataKey="szt" name="Sztuki" fill={COLORS[0]} />
                </BarChart>
              </ResponsiveContainer>
              <DataTable rows={ranking} rowKey={(r) => r.nazwa} columns={rankColumns} />
              <p className="help-note" style={{ marginTop: 8 }}>Kliknij grupę, żeby zobaczyć jej kolory, rozmiary i sprzedaż w czasie. Grupa = model bez „BLACK” (VERONA = VERONA + VERONA BLACK); linia jest osobno. Kartoteki BOLD (to Bastion) i inne oznaczone „to nie wewnętrzne” są pominięte.</p>
            </>
          )}
        </div>

        <div className="stats-card">
          <div className="stats-card-header">
            <h3>Sprzedaż w czasie {grupaTytul}</h3>
            {activeGroup && <button type="button" className="btn btn-sm btn-secondary" onClick={() => setSelectedGroup(null)}>Wszystkie grupy</button>}
          </div>
          {loadingMiesiace ? <Spinner center label="Ładowanie…" /> : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={seria}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="etykieta" />
                <YAxis />
                <Tooltip formatter={(v) => [Number(v).toLocaleString('pl-PL'), 'Sztuki']} />
                <Line type="monotone" dataKey="szt" name="Sztuki" stroke={COLORS[0]} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
          <p className="help-note">Po dacie zlecenia, bez anulowanych; bieżący miesiąc jest niepełny.</p>
        </div>

        <div className="stats-card">
          <h3>Kolory {grupaTytul}</h3>
          <DistributionChart rows={kolory} color={COLORS[4]} />
        </div>

        <div className="stats-card">
          <h3>Rozmiary {grupaTytul}</h3>
          <DistributionChart rows={rozmiary} color={COLORS[2]} horizontal />
          {(itemFilter === 'door_wing' || itemFilter === 'all') && (
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 8 }}>
              <MiniList title="Linie" rows={linie} />
              <MiniList title="Wykonanie" rows={wykonania} labels={{ WEW: 'z półki (WEW)', NSTD: 'na zamówienie (NSTD)' }} />
            </div>
          )}
        </div>
      </div>

      <div className="stats-grid-full">
        <div className="stats-card">
          <div className="stats-card-header" style={{ flexWrap: 'wrap', gap: 12 }}>
            <h3>Trend: co spada, co rośnie</h3>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <select className="day-filter" value={trendMode} onChange={(e) => setTrendMode(e.target.value as TrendMode)}>
                {(Object.keys(TREND_MODE_LABELS) as TrendMode[]).map((k) => <option key={k} value={k}>{TREND_MODE_LABELS[k]}</option>)}
              </select>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.9rem' }}>
                <input type="checkbox" checked={zBiezacym} onChange={(e) => setZBiezacym(e.target.checked)} />
                licz też bieżący (niepełny) miesiąc
              </label>
            </div>
          </div>
          <p className="help-note">
            Porównanie: <b>{periodLabel(okresy.poprzednio)}</b> → <b>{periodLabel(okresy.teraz)}</b>. Zmiana w granicach ±10 % = stabilne; poniżej 20 sztuk w obu okresach = mało danych.
            {' '}Spada: {trendPodsumowanie.spada}, rośnie: {trendPodsumowanie.rośnie}, stabilne: {trendPodsumowanie.stabilne}.
          </p>
          {loadingMiesiace ? <Spinner center label="Ładowanie…" /> : trend.length === 0 ? (
            <p style={{ color: '#6b7280' }}>Brak danych w porównywanych okresach.</p>
          ) : (
            <DataTable rows={trend} rowKey={(r) => r.nazwa} columns={trendColumns} />
          )}
        </div>
      </div>

      <div className="stats-grid-full">
        <div className="stats-card">
          <div className="stats-card-header" style={{ flexWrap: 'wrap', gap: 12 }}>
            <h3>Braki, na które czeka klient</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="alerts-filter-pills" style={{ margin: 0 }}>
                <button type="button" className={`alerts-filter-pill ${brakiTab === 'teraz' ? 'alerts-filter-pill--active' : ''}`} onClick={() => { setBrakiTab('teraz'); setVisibleBraki(30) }}>
                  Teraz czekają ({brakiTeraz.length})
                </button>
                <button type="button" className={`alerts-filter-pill ${brakiTab === 'historia' ? 'alerts-filter-pill--active' : ''}`} onClick={() => { setBrakiTab('historia'); setVisibleBraki(30) }}>
                  Czekały w przeszłości ({brakiHist.length})
                </button>
              </div>
              <select className="day-filter" value={brakiDays} onChange={(e) => setBrakiDays(Number(e.target.value))} title="Okres historii">
                <option value={90}>ostatnie 90 dni</option>
                <option value={180}>ostatnie 180 dni</option>
                <option value={365}>ostatni rok</option>
              </select>
              <select className="day-filter" value={brakiProg} onChange={(e) => setBrakiProg(Number(e.target.value))} title="Od ilu dni liczymy, że klient czekał (mediana realizacji RO to 3 dni)">
                <option value={5}>czekał &gt; 5 dni</option>
                <option value={7}>czekał &gt; 7 dni</option>
                <option value={14}>czekał &gt; 14 dni</option>
              </select>
            </div>
          </div>
          <p className="help-note">
            {brakiTab === 'teraz'
              ? 'Pozycje w otwartych zleceniach (niewydane, nieanulowane, RO otwarte w Optimie) — dni liczone od daty zlecenia do dziś. Kolejność: najwięcej zleceń × najdłużej czekają.'
              : `Wydane zlecenia z ostatnich ${brakiDays} dni, w których pozycja czekała dłużej niż ${brakiProg} dni od zlecenia do wydania. Kolejność: ile razy czekała × ile średnio dni.`}
            {' '}Magazyn wewnętrzny nie ma jeszcze stanów ani komponentów „Na magazynie = TAK” — gdy się pojawią, kolumna „Na magazynie” pokaże pokrycie.
          </p>
          {loadingBraki ? <Spinner center label="Ładowanie…" /> : brakiRows.length === 0 ? (
            <p style={{ color: '#6b7280' }}>Nic nie czeka dla wybranego filtra.</p>
          ) : (
            <>
              <DataTable rows={brakiRows.slice(0, visibleBraki)} rowKey={(r) => r.optima_code} columns={brakiColumns} />
              {visibleBraki < brakiRows.length && (
                <button type="button" className="btn btn-sm btn-primary" style={{ marginTop: 10 }} onClick={() => setVisibleBraki((v) => v + 30)}>
                  Pokaż więcej ({brakiRows.length - visibleBraki})
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {nierozpoznane.length > 0 && (
        <div className="stats-grid-full">
          <div className="stats-card">
            <h3>Nierozpoznane pozycje ({nierozpoznane.length})</h3>
            <p className="help-note">
              Nazwa kartoteki nie pasuje do wzoru „SKRZYDŁO … MODEL wzór KOLOR rozmiar” — liczą się jako „{NIEROZPOZNANE}”.
              {isManager ? ' Kliknij „Przypisz grupę”, żeby wpisać grupę ręcznie (ręczny wpis wygrywa z automatem).' : ' Grupę może przypisać kierownik.'}
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, columns: 2, columnGap: 24 }}>
              {nierozpoznane.slice(0, 60).map((d) => (
                <li key={d.optima_code} style={{ marginBottom: 4, breakInside: 'avoid' }}>
                  <span title={d.optima_code}>{d.optima_name ?? d.optima_code}</span>
                  {d.item_type && <span className="badge badge-neutral" style={{ marginLeft: 6 }}>{ITEM_TYPE_LABELS[d.item_type] ?? d.item_type}</span>}
                  {isManager && (
                    <>
                      <button type="button" className="btn-link" style={{ marginLeft: 6 }} onClick={() => void assignGroup(d.optima_code, d.optima_name)}>Przypisz grupę</button>
                      <button type="button" className="btn-link" style={{ marginLeft: 6 }} title="Pozycja nie jest drzwiami wewnętrznymi (np. Bastion) — znika z tej zakładki" onClick={() => void excludeItem(d.optima_code)}>To nie wewnętrzne</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            {nierozpoznane.length > 60 && <p className="help-note">…i {nierozpoznane.length - 60} więcej.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function DistributionChart({ rows, color, horizontal = false }: { rows: RankRow[]; color: string; horizontal?: boolean }) {
  if (rows.length === 0) return <p style={{ color: '#6b7280' }}>Brak danych.</p>
  const data = rows.slice(0, 15).map((r) => ({ ...r, krotka: shortName(r.nazwa === BRAK ? '(brak)' : r.nazwa, 22) }))
  const tip = (v: unknown, _n: unknown, p: { payload?: RankRow }) =>
    [`${Number(v).toLocaleString('pl-PL')} (${(p.payload?.udzial ?? 0).toFixed(1)} %)`, 'Sztuki'] as [string, string]
  if (horizontal) {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="krotka" />
          <YAxis />
          <Tooltip formatter={tip} />
          <Bar dataKey="szt" name="Sztuki" fill={color} />
        </BarChart>
      </ResponsiveContainer>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 26)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" />
        <YAxis type="category" dataKey="krotka" width={150} />
        <Tooltip formatter={tip} />
        <Bar dataKey="szt" name="Sztuki" fill={color} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function MiniList({ title, rows, labels = {} }: { title: string; rows: RankRow[]; labels?: Record<string, string> }) {
  if (rows.length === 0) return null
  return (
    <div style={{ minWidth: 180 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {rows.map((r) => (
        <div key={r.nazwa} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '0.9rem' }}>
          <span>{labels[r.nazwa] ?? r.nazwa}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.szt.toLocaleString('pl-PL')} · {r.udzial.toFixed(0)} %</span>
        </div>
      ))}
    </div>
  )
}
