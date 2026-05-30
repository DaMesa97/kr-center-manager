import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { supabase } from '../../supabaseClient'
import type { ConsumptionHistoryPoint, ForecastRun, WarehouseComponent } from '../../types'
import SeasonalFactorsEditor from './SeasonalFactorsEditor'

type Props = {
  components: WarehouseComponent[]
  isManager: boolean
}

function parseForecastJson(raw: unknown): ForecastRun['forecast_json'] {
  if (raw == null) return []
  let arr: unknown = raw
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw) as unknown
    } catch {
      return []
    }
  }
  if (!Array.isArray(arr)) return []
  return arr.map((item) => {
    const o = item as Record<string, unknown>
    return {
      year: Number(o.year ?? 0),
      month: Number(o.month ?? 0),
      forecast_qty: Number(o.forecast_qty ?? 0),
      baseline: Number(o.baseline ?? 0),
      seasonal_factor: Number(o.seasonal_factor ?? 0),
      insufficient_data: Boolean(o.insufficient_data),
    }
  })
}

type ChartRow = {
  label: string
  zuzycie: number | null
  prognoza: number | null
  forecast_baseline?: number
  forecast_seasonal?: number
}

function ForecastTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: ChartRow }>
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  if (!row) return null
  const bits: string[] = [`Miesiąc: ${row.label}`]
  if (row.zuzycie != null && !Number.isNaN(row.zuzycie)) {
    bits.push(`Zużycie: ${row.zuzycie}`)
  }
  if (row.prognoza != null && !Number.isNaN(row.prognoza)) {
    const b = row.forecast_baseline
    const s = row.forecast_seasonal
    const approx =
      b != null && s != null
        ? ` (${b} × ${s.toFixed(2)} = wynik)`
        : ''
    bits.push(`Prognoza: ${row.prognoza}${approx}`)
  }
  return (
    <div
      style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 12px', fontSize: '0.875rem', boxShadow: '0 1px 4px rgba(0, 0, 0, 0.08)' }}
    >
      {bits.join(' | ')}
    </div>
  )
}

function mapForecastRunRow(row: Record<string, unknown>): ForecastRun {
  return {
    id: Number(row.id),
    component_id: Number(row.component_id),
    run_at: String(row.run_at ?? ''),
    forecast_json: parseForecastJson(row.forecast_json),
    baseline_qty: Number(row.baseline_qty ?? 0),
    historical_months_used: Number(row.historical_months_used ?? 0),
    current_stock_total: Number(row.current_stock_total ?? 0),
  }
}

export default function ForecastView({ components, isManager }: Props) {
  const [selectedComponentId, setSelectedComponentId] = useState<number | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'raw' | 'doors_internal'>('all')
  const [history, setHistory] = useState<ConsumptionHistoryPoint[]>([])
  const [forecast, setForecast] = useState<ForecastRun | null>(null)
  const [loading, setLoading] = useState(false)

  const selectedComponent = useMemo(
    () => components.find((c) => c.id === selectedComponentId) ?? null,
    [components, selectedComponentId],
  )

  const fetchComponentData = useCallback(async (componentId: number) => {
    setLoading(true)

    const { data: histData, error: histErr } = await supabase.rpc('get_component_consumption_history', {
      p_component_id: componentId,
      p_months: 12,
    })

    const { data: runData, error: runErr } = await supabase
      .from('forecast_runs')
      .select('*')
      .eq('component_id', componentId)
      .order('run_at', { ascending: false })
      .limit(1)

    setLoading(false)

    if (histErr || runErr) {
      console.error('Błąd:', histErr, runErr)
      return
    }

    const mapped = (histData ?? []).map((row: Record<string, unknown>) => ({
      year: Number(row.r_year),
      month: Number(row.r_month),
      consumed: Number(row.r_consumed ?? 0),
      returned: Number(row.r_returned ?? 0),
      received: Number(row.r_received ?? 0),
      net_consumption: Number(row.r_net_consumption ?? 0),
      outlier_removed: Boolean(row.r_outlier_removed),
      insufficient_data: Boolean(row.r_insufficient_data),
    })) as ConsumptionHistoryPoint[]

    setHistory(mapped)
    const first = runData?.[0] as Record<string, unknown> | undefined
    setForecast(first ? mapForecastRunRow(first) : null)
  }, [])

  useEffect(() => {
    const active = components.filter((c) => c.is_active)
    if (active.length === 0) {
      setSelectedComponentId(null)
      setHistory([])
      setForecast(null)
      return
    }
    if (selectedComponentId == null || !active.some((c) => c.id === selectedComponentId)) {
      setSelectedComponentId(active[0]!.id)
    }
  }, [components, selectedComponentId])

  useEffect(() => {
    if (selectedComponentId == null) return
    void fetchComponentData(selectedComponentId)
  }, [selectedComponentId, fetchComponentData])

  const chartData = useMemo(() => {
    const historyPoints = history.map((h) => ({
      label: `${h.year}-${String(h.month).padStart(2, '0')}`,
      zuzycie: h.net_consumption,
      prognoza: null as number | null,
    }))

    const forecastPoints = (forecast?.forecast_json ?? []).map((f) => ({
      label: `${f.year}-${String(f.month).padStart(2, '0')}`,
      zuzycie: null as number | null,
      prognoza: f.forecast_qty,
      forecast_baseline: f.baseline,
      forecast_seasonal: f.seasonal_factor,
    }))

    return [...historyPoints, ...forecastPoints].sort((a, b) => a.label.localeCompare(b.label))
  }, [history, forecast])

  const activeComponents = useMemo(() => components.filter((c) => c.is_active), [components])

  const categoryCounts = useMemo(
    () => ({
      all: activeComponents.length,
      raw: activeComponents.filter((c) => c.product_category === 'raw' || c.product_category == null).length,
      doors_internal: activeComponents.filter((c) =>
        ['door_wing', 'door_frame', 'door_handle', 'door_hinge_cover'].includes(
          c.product_category ?? '',
        ),
      ).length,
    }),
    [activeComponents],
  )

  const filteredComponents = useMemo(() => {
    let result = activeComponents
    if (categoryFilter !== 'all') {
      result = result.filter((c) =>
        categoryFilter === 'raw'
          ? c.product_category === 'raw' || c.product_category == null
          : ['door_wing', 'door_frame', 'door_handle', 'door_hinge_cover'].includes(
              c.product_category ?? '',
            ),
      )
    }
    const q = searchTerm.trim().toLowerCase()
    if (q) {
      result = result.filter(
        (c) =>
          (c.name ?? '').toLowerCase().includes(q) || (c.code ?? '').toLowerCase().includes(q),
      )
    }
    return result
  }, [activeComponents, searchTerm, categoryFilter])

  return (
    <div className={`forecast-view-container${isManager ? '' : ' forecast-view--readonly'}`}>
      <div className="forecast-toolbar">
        <SeasonalFactorsEditor
          isManager={isManager}
          onSaved={() => {
            // Pełny efekt po następnym run_all_forecasts (cron); forecast_runs jest z cache.
          }}
        />
      </div>
      <div className="forecast-view">
        <aside className="forecast-sidebar">
          <div className="alerts-filter-pills" style={{ marginBottom: 8 }}>
            <button
              type="button"
              className={`alerts-filter-pill ${categoryFilter === 'all' ? 'alerts-filter-pill--active' : ''}`}
              onClick={() => setCategoryFilter('all')}
            >
              Wszystkie
              <span className="alerts-filter-pill-count">{categoryCounts.all}</span>
            </button>
            <button
              type="button"
              className={`alerts-filter-pill ${categoryFilter === 'raw' ? 'alerts-filter-pill--active' : ''}`}
              onClick={() => setCategoryFilter('raw')}
            >
              Surowce
              <span className="alerts-filter-pill-count">{categoryCounts.raw}</span>
            </button>
            <button
              type="button"
              className={`alerts-filter-pill ${categoryFilter === 'doors_internal' ? 'alerts-filter-pill--active' : ''}`}
              onClick={() => setCategoryFilter('doors_internal')}
            >
              Drzwi wewn.
              <span className="alerts-filter-pill-count">{categoryCounts.doors_internal}</span>
            </button>
          </div>
          <div className="forecast-sidebar-search">
            <input
              type="text"
              className="search-input"
              placeholder="Szukaj komponentu..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={activeComponents.length === 0}
            />
          </div>
          <div className="forecast-sidebar-list">
            {activeComponents.length === 0 && (
              <div className="forecast-sidebar-empty">Brak aktywnych komponentów.</div>
            )}
            {activeComponents.length > 0 && filteredComponents.length === 0 && (
              <div className="forecast-sidebar-empty">Brak pasujących komponentów</div>
            )}
            {filteredComponents.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`forecast-sidebar-item ${
                  selectedComponentId === c.id ? 'forecast-sidebar-item--active' : ''
                }`}
                onClick={() => setSelectedComponentId(c.id)}
              >
                <div className="forecast-sidebar-item-name">{c.name}</div>
                {c.code && <div className="forecast-sidebar-item-code">{c.code}</div>}
              </button>
            ))}
          </div>
        </aside>
        <div className="forecast-main">
          {loading && <p className="no-results">Ładowanie danych…</p>}
          {!loading && selectedComponent && forecast && (
            <div className="forecast-header">
              <h3>{selectedComponent.name}</h3>
              <div className="forecast-meta">
                <span>Stan bieżący: {forecast.current_stock_total}</span>
                <span>Baseline: {forecast.baseline_qty}/mies.</span>
                <span>Miesięcy historii: {forecast.historical_months_used}</span>
                <span>
                  {forecast.forecast_json[0]?.insufficient_data
                    ? 'Status: Zbyt mało danych'
                    : 'Status: Wystarczających danych'}
                </span>
                {forecast.forecast_json[0]?.insufficient_data && (
                  <span className="forecast-warning">
                    ⚠ Zbyt mało danych historycznych — prognoza mało wiarygodna
                  </span>
                )}
              </div>
            </div>
          )}
          {!loading && selectedComponent && !forecast && (
            <div className="forecast-header">
              <h3>{selectedComponent.name}</h3>
              <p className="no-results" style={{ margin: 0 }}>
                Brak zapisanej prognozy dla tego komponentu.
              </p>
            </div>
          )}
          {!loading && chartData.length > 0 && (
            <div style={{ width: '100%', minHeight: 320 }}>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip
                    content={(tooltipProps) => (
                      <ForecastTooltip active={tooltipProps.active} payload={tooltipProps.payload} />
                    )}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="zuzycie"
                    stroke="#3b82f6"
                    name="Historia zużycia"
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="prognoza"
                    stroke="#f59e0b"
                    strokeDasharray="5 5"
                    name="Prognoza"
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          {!loading && selectedComponent && forecast && (
            <table className="forecast-table">
              <thead>
                <tr>
                  <th>Miesiąc</th>
                  <th>Prognoza (szt.)</th>
                  <th>Mnożnik sezonowy</th>
                </tr>
              </thead>
              <tbody>
                {(forecast.forecast_json ?? []).map((f, idx) => (
                  <tr key={idx}>
                    <td>
                      {f.year}-{String(f.month).padStart(2, '0')}
                    </td>
                    <td>{f.forecast_qty}</td>
                    <td>{f.seasonal_factor.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
