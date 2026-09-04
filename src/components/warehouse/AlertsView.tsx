import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabaseClient'
import type { AlertThresholds, StockAlert } from '../../types'
import Spinner from '../Spinner'

type Props = {
  isManager: boolean
}

const LEVEL_LABELS: Record<StockAlert['alert_level'], string> = {
  critical: 'Krytyczny',
  warning: 'Ostrzeżenie',
  observation: 'Obserwacja',
  ok: 'OK',
  no_data: 'Brak danych',
}

const LEVEL_BADGES: Record<StockAlert['alert_level'], string> = {
  critical: 'alert-badge--critical',
  warning: 'alert-badge--warning',
  observation: 'alert-badge--observation',
  ok: 'alert-badge--ok',
  no_data: 'alert-badge--no-data',
}

function countClass(base: number, alarm: boolean): string {
  return `alerts-filter-pill-count${alarm && base > 0 ? ' alerts-filter-pill-count--alarm' : ''}`
}

function mapRpcRow(row: Record<string, unknown>): StockAlert {
  return {
    component_id: Number(row.r_component_id),
    component_name: String(row.r_component_name ?? ''),
    component_code: row.r_component_code != null ? String(row.r_component_code) : null,
    product_category: (row.r_product_category as string | null) ?? null,
    warehouse_id: Number(row.r_warehouse_id),
    warehouse_code: String(row.r_warehouse_code ?? ''),
    warehouse_name: String(row.r_warehouse_name ?? ''),
    current_stock: Number(row.r_current_stock ?? 0),
    baseline_monthly: Number(row.r_baseline_monthly ?? 0),
    seasonal_factor: Number(row.r_seasonal_factor ?? 1),
    daily_consumption: Number(row.r_daily_consumption ?? 0),
    days_until_empty: row.r_days_until_empty === null || row.r_days_until_empty === undefined
      ? null
      : Number(row.r_days_until_empty),
    alert_level: row.r_alert_level as StockAlert['alert_level'],
    suggested_order_qty: Number(row.r_suggested_order_qty ?? 0),
    reserved_quantity: Number(row.r_reserved_quantity ?? 0),
    available: Number(row.r_available ?? row.r_current_stock ?? 0),
    incoming_qty: Number(row.r_incoming_qty ?? 0),
    earliest_eta: (row.r_earliest_eta as string | null) ?? null,
  }
}

// 'YYYY-MM-DD' → 'DD.MM'
function formatEtaShort(eta: string | null): string {
  if (!eta) return ''
  const [, m, d] = eta.split('-')
  return m && d ? `${d}.${m}` : eta
}

/** krytyczny i żadna dostawa nie jedzie — najpilniejsze do zamówienia */
function isCriticalNoDelivery(a: StockAlert): boolean {
  return a.alert_level === 'critical' && a.incoming_qty <= 0
}

function AlertsView({ isManager }: Props) {
  const [alerts, setAlerts] = useState<StockAlert[]>([])
  const [thresholds, setThresholds] = useState<AlertThresholds | null>(null)
  const [loading, setLoading] = useState(false)
  const [filterLevel, setFilterLevel] = useState<string>('all_attention')
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'raw' | 'doors_internal'>('all')
  const [editingThresholds, setEditingThresholds] = useState(false)
  const [tCritical, setTCritical] = useState(14)
  const [tWarning, setTWarning] = useState(30)
  const [tObservation, setTObservation] = useState(60)

  const fetchAlerts = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('get_stock_alerts')
    setLoading(false)
    if (error) {
      console.error(error)
      return
    }
    const mapped = (data ?? []).map((row: Record<string, unknown>) => mapRpcRow(row))
    setAlerts(mapped)
  }, [])

  const fetchThresholds = useCallback(async () => {
    const { data, error } = await supabase.from('alert_thresholds').select('*').eq('id', 1).single()
    if (error) {
      console.error(error)
      return
    }
    if (!data) return
    const row = data as AlertThresholds & { id?: number }
    const next: AlertThresholds = {
      critical_days: Number(row.critical_days),
      warning_days: Number(row.warning_days),
      observation_days: Number(row.observation_days),
    }
    setThresholds(next)
    setTCritical(next.critical_days)
    setTWarning(next.warning_days)
    setTObservation(next.observation_days)
  }, [])

  useEffect(() => {
    void fetchAlerts()
    void fetchThresholds()
  }, [fetchAlerts, fetchThresholds])

  const alertsAfterLevelFilter = useMemo(() => {
    if (filterLevel === 'all') return alerts
    if (filterLevel === 'all_attention') {
      return alerts.filter((a) => ['critical', 'warning'].includes(a.alert_level))
    }
    if (filterLevel === 'critical_no_delivery') {
      return alerts.filter(isCriticalNoDelivery)
    }
    return alerts.filter((a) => a.alert_level === filterLevel)
  }, [alerts, filterLevel])

  const filtered = useMemo(() => {
    let result = alertsAfterLevelFilter
    if (categoryFilter !== 'all') {
      if (categoryFilter === 'raw') {
        result = result.filter((a) => a.product_category === 'raw' || a.product_category == null)
      } else if (categoryFilter === 'doors_internal') {
        result = result.filter((a) =>
          ['door_wing', 'door_frame', 'door_handle', 'door_hinge_cover'].includes(
            a.product_category ?? '',
          ),
        )
      }
    }
    return result
  }, [alertsAfterLevelFilter, categoryFilter])

  const counts = useMemo(
    () => ({
      critical: alerts.filter((a) => a.alert_level === 'critical').length,
      critical_no_delivery: alerts.filter(isCriticalNoDelivery).length,
      warning: alerts.filter((a) => a.alert_level === 'warning').length,
      observation: alerts.filter((a) => a.alert_level === 'observation').length,
      ok: alerts.filter((a) => a.alert_level === 'ok').length,
      no_data: alerts.filter((a) => a.alert_level === 'no_data').length,
    }),
    [alerts],
  )
  const categoryCounts = useMemo(
    () => ({
      all: alertsAfterLevelFilter.length,
      raw: alertsAfterLevelFilter.filter((a) => a.product_category === 'raw' || a.product_category == null).length,
      doors_internal: alertsAfterLevelFilter.filter((a) =>
        ['door_wing', 'door_frame', 'door_handle', 'door_hinge_cover'].includes(
          a.product_category ?? '',
        ),
      ).length,
    }),
    [alertsAfterLevelFilter],
  )

  const handleSaveThresholds = async () => {
    if (tCritical >= tWarning || tWarning >= tObservation) {
      alert('Progi muszą być w kolejności: krytyczny < ostrzeżenie < obserwacja')
      return
    }
    const { error } = await supabase
      .from('alert_thresholds')
      .update({
        critical_days: tCritical,
        warning_days: tWarning,
        observation_days: tObservation,
      })
      .eq('id', 1)
    if (error) {
      alert(`Błąd: ${error.message}`)
      return
    }
    setEditingThresholds(false)
    await fetchThresholds()
    await fetchAlerts()
  }

  return (
    <div className="alerts-view">
      {isManager && thresholds && (
        <div className="alerts-thresholds">
          {!editingThresholds ? (
            <>
              <span>
                Progi: <strong>{thresholds.critical_days}</strong> dni krytyczny ·
                <strong> {thresholds.warning_days}</strong> dni ostrzeżenie ·
                <strong> {thresholds.observation_days}</strong> dni obserwacja
              </span>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditingThresholds(true)}>
                Edytuj progi
              </button>
            </>
          ) : (
            <>
              <label>
                Krytyczny:{' '}
                <input
                  type="number"
                  min={1}
                  value={tCritical}
                  onChange={(e) => setTCritical(Number(e.target.value))}
                  style={{ width: 60 }}
                />{' '}
                dni
              </label>
              <label>
                Ostrzeżenie:{' '}
                <input
                  type="number"
                  min={1}
                  value={tWarning}
                  onChange={(e) => setTWarning(Number(e.target.value))}
                  style={{ width: 60 }}
                />{' '}
                dni
              </label>
              <label>
                Obserwacja:{' '}
                <input
                  type="number"
                  min={1}
                  value={tObservation}
                  onChange={(e) => setTObservation(Number(e.target.value))}
                  style={{ width: 60 }}
                />{' '}
                dni
              </label>
              <button type="button" className="btn btn-primary" onClick={handleSaveThresholds}>
                Zapisz
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setEditingThresholds(false)
                  setTCritical(thresholds.critical_days)
                  setTWarning(thresholds.warning_days)
                  setTObservation(thresholds.observation_days)
                }}
              >
                Anuluj
              </button>
            </>
          )}
        </div>
      )}

      <div className="alerts-filter-pills">
        <button
          type="button"
          className={`alerts-filter-pill ${filterLevel === 'all_attention' ? 'alerts-filter-pill--active' : ''}`}
          onClick={() => setFilterLevel('all_attention')}
        >
          Wymagające uwagi
          <span className={countClass(counts.critical + counts.warning, true)}>{counts.critical + counts.warning}</span>
        </button>
        <button
          type="button"
          className={`alerts-filter-pill alerts-filter-pill--critical ${filterLevel === 'critical' ? 'alerts-filter-pill--active' : ''}`}
          onClick={() => setFilterLevel('critical')}
        >
          Krytyczne
          <span className={countClass(counts.critical, true)}>{counts.critical}</span>
        </button>
        <button
          type="button"
          className={`alerts-filter-pill alerts-filter-pill--critical ${filterLevel === 'critical_no_delivery' ? 'alerts-filter-pill--active' : ''}`}
          onClick={() => setFilterLevel('critical_no_delivery')}
          title="Krytyczne, dla których NIC nie jedzie z otwartych ZD — zamów w pierwszej kolejności"
        >
          Krytyczne bez dostawy
          <span className={countClass(counts.critical_no_delivery, true)}>{counts.critical_no_delivery}</span>
        </button>
        <button
          type="button"
          className={`alerts-filter-pill alerts-filter-pill--warning ${filterLevel === 'warning' ? 'alerts-filter-pill--active' : ''}`}
          onClick={() => setFilterLevel('warning')}
        >
          Ostrzeżenia
          <span className={countClass(counts.warning, true)}>{counts.warning}</span>
        </button>
        <button
          type="button"
          className={`alerts-filter-pill alerts-filter-pill--observation ${filterLevel === 'observation' ? 'alerts-filter-pill--active' : ''}`}
          onClick={() => setFilterLevel('observation')}
        >
          Obserwacja
          <span className={countClass(counts.observation, false)}>{counts.observation}</span>
        </button>
        <button
          type="button"
          className={`alerts-filter-pill ${filterLevel === 'no_data' ? 'alerts-filter-pill--active' : ''}`}
          onClick={() => setFilterLevel('no_data')}
        >
          Brak danych
          <span className={countClass(counts.no_data, false)}>{counts.no_data}</span>
        </button>
        <button
          type="button"
          className={`alerts-filter-pill ${filterLevel === 'all' ? 'alerts-filter-pill--active' : ''}`}
          onClick={() => setFilterLevel('all')}
        >
          Wszystkie
          <span className={countClass(alerts.length, false)}>{alerts.length}</span>
        </button>
      </div>
      <div className="alerts-filter-pills" style={{ marginTop: 8 }}>
        <button
          type="button"
          className={`alerts-filter-pill ${categoryFilter === 'all' ? 'alerts-filter-pill--active' : ''}`}
          onClick={() => setCategoryFilter('all')}
        >
          Wszystkie
          <span className={countClass(categoryCounts.all, false)}>{categoryCounts.all}</span>
        </button>
        <button
          type="button"
          className={`alerts-filter-pill ${categoryFilter === 'raw' ? 'alerts-filter-pill--active' : ''}`}
          onClick={() => setCategoryFilter('raw')}
        >
          Surowce
          <span className={countClass(categoryCounts.raw, false)}>{categoryCounts.raw}</span>
        </button>
        <button
          type="button"
          className={`alerts-filter-pill ${categoryFilter === 'doors_internal' ? 'alerts-filter-pill--active' : ''}`}
          onClick={() => setCategoryFilter('doors_internal')}
        >
          Drzwi wewn.
          <span className={countClass(categoryCounts.doors_internal, false)}>{categoryCounts.doors_internal}</span>
        </button>
      </div>

      {loading ? (
        <Spinner center label="Ładowanie…" />
      ) : filtered.length === 0 ? (
        <p className="no-results">Brak alertów w wybranej kategorii 🎉</p>
      ) : (
        <div className="table-wrapper">
          <table className="orders-table">
            <thead>
              <tr>
                <th>Poziom</th>
                <th>Komponent</th>
                <th>Magazyn</th>
                <th title="Stan fizyczny na półce">Fizyczne</th>
                <th title="Fizyczne − zarezerwowane pod zamówienia">Dostępne</th>
                <th title="Niedostarczone pozycje z wysłanych ZD">W drodze</th>
                <th>Zużycie dzienne</th>
                <th title="Symulacja: dostępne minus dzienne zużycie, dostawy wpadają w swoich terminach">
                  Dni do wyczerpania
                </th>
                <th>Sugerowane zam.</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={`${a.component_id}-${a.warehouse_id}`}>
                  <td>
                    <span className={`alert-badge ${LEVEL_BADGES[a.alert_level]}`}>
                      {LEVEL_LABELS[a.alert_level]}
                    </span>
                  </td>
                  <td>
                    <strong>{a.component_name}</strong>
                    {a.component_code && (
                      <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{a.component_code}</div>
                    )}
                  </td>
                  <td>{a.warehouse_code}</td>
                  <td>{a.current_stock}</td>
                  <td>
                    <strong style={a.available < 0 ? { color: '#c62828' } : undefined}>{a.available}</strong>
                    {a.reserved_quantity > 0 && (
                      <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>rez. {a.reserved_quantity}</div>
                    )}
                  </td>
                  <td>
                    {a.incoming_qty > 0 ? (
                      <>
                        {a.incoming_qty}
                        {a.earliest_eta && (
                          <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>
                            {formatEtaShort(a.earliest_eta)}
                          </div>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{a.daily_consumption}</td>
                  <td>{a.days_until_empty === null ? '—' : `${a.days_until_empty} dni`}</td>
                  <td>
                    {a.suggested_order_qty > 0 ? <strong>{a.suggested_order_qty}</strong> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default AlertsView
