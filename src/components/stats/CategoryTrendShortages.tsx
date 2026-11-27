import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabaseClient'
import Spinner from '../Spinner'
import DataTable, { type DataTableColumn } from '../DataTable'
import { fetchAllPages } from '../../lib/fetchPaged'
import {
  TREND_BADGE,
  TREND_MODE_LABELS,
  formatDays,
  formatPct,
  normalizeZewBrak,
  monthLabel,
  normalizeZewMiesiac,
  periodLabel,
  sortZewShortages,
  trendPeriods,
  zewTrend,
  type TrendMode,
  type TrendRow,
  type ZewBrakRow,
  type ZewMiesiacRow,
} from '../../lib/salesStats'

/**
 * Statystyki → STA / Disting / ST / Techniczne / Bastion — dwie karty pod dotychczasowym pulpitem (Etap 25):
 * trend po systemach / modelach / kolorach (rpc stat_zew_miesiace) i braki materiałowe, na które czekały
 * zlecenia = wymuszone wydania „[WYMUSZONE brak N]” (rpc stat_zew_braki).
 */

type Props = { category: string }
type Wymiar = ZewMiesiacRow['wymiar']

const WYMIAR_LABELS: Record<Wymiar, string> = { system: 'Systemy', model: 'Modele', kolor: 'Kolory skrzydła' }

export default function CategoryTrendShortages({ category }: Props) {
  const [wymiar, setWymiar] = useState<Wymiar>('system')
  const [mode, setMode] = useState<TrendMode>('3m')
  const [zBiezacym, setZBiezacym] = useState(false)
  const [days, setDays] = useState(90)
  const [miesiace, setMiesiace] = useState<ZewMiesiacRow[]>([])
  const [braki, setBraki] = useState<ZewBrakRow[]>([])
  const [loadingM, setLoadingM] = useState(true)
  const [loadingB, setLoadingB] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [visible, setVisible] = useState(25)

  const loadMiesiace = useCallback(async (cat: string) => {
    setLoadingM(true)
    const { data, error: err } = await fetchAllPages<Record<string, unknown>>((a, b) =>
      supabase.rpc('stat_zew_miesiace', { p_category: cat, p_months: 13 }).order('miesiac').order('wymiar').order('wartosc').range(a, b),
    )
    setLoadingM(false)
    if (err) {
      console.error('[Statystyki] trend', err)
      setError(`Nie wczytano trendu: ${err.message}`)
      setMiesiace([])
      return
    }
    setMiesiace((data ?? []).map(normalizeZewMiesiac))
  }, [])

  const loadBraki = useCallback(async (cat: string, d: number) => {
    setLoadingB(true)
    const { data, error: err } = await fetchAllPages<Record<string, unknown>>((a, b) =>
      supabase.rpc('stat_zew_braki', { p_category: cat, p_days: d }).order('zlecenia', { ascending: false }).order('component_id').range(a, b),
    )
    setLoadingB(false)
    if (err) {
      console.error('[Statystyki] braki', err)
      setError(`Nie wczytano braków: ${err.message}`)
      setBraki([])
      return
    }
    setBraki((data ?? []).map(normalizeZewBrak))
  }, [])

  useEffect(() => { void loadMiesiace(category) }, [category, loadMiesiace])
  useEffect(() => { void loadBraki(category, days) }, [category, days, loadBraki])

  const trend = useMemo(() => zewTrend(miesiace, wymiar, mode, new Date(), { zBiezacym, min: 10 }), [miesiace, wymiar, mode, zBiezacym])
  const okresy = useMemo(() => trendPeriods(mode, new Date(), zBiezacym), [mode, zBiezacym])
  // testy 27.11 (runda 3): ST / Bastion / Techniczne mają zlecenia dopiero od czerwca 2026 — porównanie z okresem
  // sprzed pierwszego zlecenia dawało same „nowe” albo fałszywe „rośnie”; mówimy to wprost
  const daneOd = useMemo(() => {
    const m = miesiace.filter((r) => r.szt > 0).map((r) => r.miesiac.slice(0, 7)).sort()[0]
    return m ?? null
  }, [miesiace])
  const zaKrotkaHistoria = daneOd != null && okresy.poprzednio.length > 0 && daneOd > okresy.poprzednio[0]
  const brakiSorted = useMemo(() => sortZewShortages(braki), [braki])
  const srKat = braki[0]?.sr_realizacja_kat ?? null

  const trendColumns = useMemo<DataTableColumn<TrendRow>[]>(() => [
    { key: 'nazwa', label: WYMIAR_LABELS[wymiar].replace(/y$/, '').replace('Kolory skrzydła', 'Kolor skrzydła'), sortValue: (r) => r.nazwa, render: (r) => r.nazwa },
    { key: 'poprzednio', label: periodLabel(okresy.poprzednio), align: 'right', sortValue: (r) => r.poprzednio, render: (r) => r.poprzednio.toLocaleString('pl-PL') },
    { key: 'teraz', label: periodLabel(okresy.teraz), align: 'right', sortValue: (r) => r.teraz, render: (r) => r.teraz.toLocaleString('pl-PL') },
    { key: 'zmiana', label: 'Zmiana', align: 'right', sortValue: (r) => r.zmianaPct ?? -999, render: (r) => formatPct(r.zmianaPct) },
    { key: 'kierunek', label: 'Ocena', sortValue: (r) => r.kierunek, render: (r) => <span className={`badge ${TREND_BADGE[r.kierunek]}`}>{r.kierunek}</span> },
    { key: 'seria', label: 'Miesiące', render: (r) => <span style={{ fontVariantNumeric: 'tabular-nums', color: '#6b7280' }}>{r.seria.join(' · ')}</span> },
  ], [okresy, wymiar])

  const brakiColumns = useMemo<DataTableColumn<ZewBrakRow>[]>(() => [
    { key: 'komponent', label: 'Komponent', sortValue: (r) => r.nazwa ?? r.kod ?? '', render: (r) => <span title={r.kod ?? ''}>{r.nazwa ?? r.kod}</span> },
    { key: 'kat', label: 'Kategoria', sortValue: (r) => r.kategoria ?? '', render: (r) => r.kategoria ?? '—' },
    { key: 'zlecenia', label: 'Zleceń z brakiem', align: 'right', sortValue: (r) => r.zlecenia, render: (r) => <b>{r.zlecenia}</b> },
    { key: 'brak', label: 'Brakowało szt.', align: 'right', sortValue: (r) => r.brak_szt ?? 0, render: (r) => (r.brak_szt == null ? '—' : Number(r.brak_szt).toLocaleString('pl-PL')) },
    { key: 'ostatnie', label: 'Ostatnio', sortValue: (r) => r.ostatnie ?? '', render: (r) => r.ostatnie ?? '—' },
    {
      key: 'real', label: 'Realizacja zleceń z brakiem', align: 'right', title: 'Średnio dni od zlecenia do wydania dla zleceń, w których tego brakowało; w nawiasie średnia całej kategorii',
      sortValue: (r) => r.sr_realizacja ?? 0,
      render: (r) => (
        <span style={{ color: r.sr_realizacja != null && srKat != null && r.sr_realizacja > srKat ? '#b3261e' : undefined }}>
          {formatDays(r.sr_realizacja)}{srKat != null && <span style={{ color: '#6b7280' }}> (kat. {formatDays(srKat)})</span>}
        </span>
      ),
    },
    {
      key: 'stan', label: 'Stan / rezerw. / dostępne', align: 'right', sortValue: (r) => r.dostepne ?? 0,
      render: (r) => (r.stan == null ? '—' : `${fmt(r.stan)} / ${fmt(r.rezerwacje)} / ${fmt(r.dostepne)}`),
    },
  ], [srKat])

  return (
    <>
      {error && <div className="stats-grid-full"><div className="stats-card" style={{ color: '#b3261e' }}>{error}</div></div>}
      <div className="stats-grid-full">
        <div className="stats-card">
          <div className="stats-card-header" style={{ flexWrap: 'wrap', gap: 12 }}>
            <h3>Trend: co spada, co rośnie — {category}</h3>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="alerts-filter-pills" style={{ margin: 0 }}>
                {(Object.keys(WYMIAR_LABELS) as Wymiar[]).map((w) => (
                  <button key={w} type="button" className={`alerts-filter-pill ${wymiar === w ? 'alerts-filter-pill--active' : ''}`} onClick={() => setWymiar(w)}>
                    {WYMIAR_LABELS[w]}
                  </button>
                ))}
              </div>
              <select className="day-filter" value={mode} onChange={(e) => setMode(e.target.value as TrendMode)}>
                {(Object.keys(TREND_MODE_LABELS) as TrendMode[]).map((k) => <option key={k} value={k}>{TREND_MODE_LABELS[k]}</option>)}
              </select>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.9rem' }}>
                <input type="checkbox" checked={zBiezacym} onChange={(e) => setZBiezacym(e.target.checked)} />
                licz też bieżący miesiąc
              </label>
            </div>
          </div>
          <p className="help-note">
            Sztuki drzwi po dacie zlecenia, bez anulowanych: <b>{periodLabel(okresy.poprzednio)}</b> → <b>{periodLabel(okresy.teraz)}</b>. ±10 % = stabilne; poniżej 10 sztuk w obu okresach = mało danych.
          </p>
          {loadingM ? <Spinner center label="Ładowanie…" /> : trend.length === 0 ? (
            <p style={{ color: '#6b7280' }}>Brak danych w porównywanych okresach.</p>
          ) : (
            <>
              {zaKrotkaHistoria && daneOd && (
                <p role="note" style={{ color: '#b45309', margin: '0 0 8px' }}>
                  Za krótka historia: dane w tej kategorii są od {monthLabel(daneOd)}, a poprzedni okres zaczyna się w {monthLabel(okresy.poprzednio[0])} — ocena „rośnie” / „nowe” nie jest wiarygodna. Wybierz krótszy tryb porównania.
                </p>
              )}
              <DataTable rows={trend} rowKey={(r) => r.nazwa} columns={trendColumns} />
            </>
          )}
        </div>
      </div>

      <div className="stats-grid-full">
        <div className="stats-card">
          <div className="stats-card-header" style={{ flexWrap: 'wrap', gap: 12 }}>
            <h3>Braki materiałowe, na które czekały zlecenia — {category}</h3>
            <select className="day-filter" value={days} onChange={(e) => { setDays(Number(e.target.value)); setVisible(25) }}>
              <option value={30}>ostatnie 30 dni</option>
              <option value={90}>ostatnie 90 dni</option>
              <option value={180}>ostatnie 180 dni</option>
            </select>
          </div>
          <p className="help-note">
            Wydania materiału z wymuszeniem (stan zszedł na minus, WZ „[WYMUSZONE brak N]”) przy etapach produkcji tej kategorii. Najczęściej brakujące komponenty u góry;
            na czerwono realizacja dłuższa niż średnia kategorii. Stany ujemne z wymuszonych wydań czekają na inwentaryzację.
          </p>
          {loadingB ? <Spinner center label="Ładowanie…" /> : brakiSorted.length === 0 ? (
            <p style={{ color: '#6b7280' }}>Brak wymuszonych wydań w tym okresie.</p>
          ) : (
            <>
              <DataTable rows={brakiSorted.slice(0, visible)} rowKey={(r) => r.component_id} columns={brakiColumns} />
              {visible < brakiSorted.length && (
                <button type="button" className="btn btn-sm btn-primary" style={{ marginTop: 10 }} onClick={() => setVisible((v) => v + 25)}>
                  Pokaż więcej ({brakiSorted.length - visible})
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

function fmt(v: number | null): string {
  if (v == null) return '—'
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}
