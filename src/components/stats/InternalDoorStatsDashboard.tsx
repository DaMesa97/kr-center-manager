import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { InternalDoorItem, Order } from '../../types'

type InternalDoorItemWithComponent = InternalDoorItem & {
  component_product_category?: string | null
  component_door_model?: string | null
  component_door_color?: string | null
}

type Props = {
  orders: Order[]
  internalDoorItems: InternalDoorItemWithComponent[]
  loading: boolean
  itemsLoading: boolean
}

const ITEM_FILTERS = [
  { key: 'all', label: 'Wszystko' },
  { key: 'door_wing', label: 'Skrzydła' },
  { key: 'door_frame', label: 'Ościeżnice' },
  { key: 'door_handle', label: 'Klamki' },
  { key: 'door_hinge_cover', label: 'Osłonki' },
] as const

function isCancelled(o: Order): boolean {
  const extra = o.extra_fields as Record<string, unknown> | null | undefined
  return extra?.cancelled === true
}

function isReleased(o: Order): boolean {
  return Boolean(o.release_date && String(o.release_date).trim())
}

function daysBetween(startRaw: string | null | undefined, endRaw: string | null | undefined): number | null {
  if (!startRaw || !endRaw) return null
  const a = new Date(startRaw)
  const b = new Date(endRaw)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null
  const d = (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)
  if (d < 0) return null
  return d
}

function formatPercent(v: number): string {
  return `${v.toFixed(1)}%`
}

function catLabel(cat: string): string {
  if (cat === 'door_wing') return 'Skrzydła'
  if (cat === 'door_frame') return 'Ościeżnice'
  if (cat === 'door_handle') return 'Klamki'
  if (cat === 'door_hinge_cover') return 'Osłonki'
  return 'Inne'
}

export default function InternalDoorStatsDashboard({ orders, internalDoorItems, loading, itemsLoading }: Props) {
  const [itemFilter, setItemFilter] = useState<(typeof ITEM_FILTERS)[number]['key']>('all')
  const [rangeMonths, setRangeMonths] = useState(12)
  const [visibleSkuRows, setVisibleSkuRows] = useState(50)

  const doorOrders = useMemo(
    () => orders.filter((o) => o.category === 'DrzwiWewnetrzne'),
    [orders],
  )
  const ordersById = useMemo(() => {
    const m = new Map<number, Order>()
    doorOrders.forEach((o) => {
      if (o.id !== undefined) m.set(o.id, o)
    })
    return m
  }, [doorOrders])
  const itemRows = useMemo(
    () => internalDoorItems.filter((it) => ordersById.has(it.order_id)),
    [internalDoorItems, ordersById],
  )
  const filteredItems = useMemo(() => {
    if (itemFilter === 'all') return itemRows
    return itemRows.filter((it) => (it.component_category ?? it.component_product_category) === itemFilter)
  }, [itemRows, itemFilter])
  const releasedFilteredItems = useMemo(
    () =>
      filteredItems.filter((it) => {
        const order = ordersById.get(it.order_id)
        return order ? isReleased(order) && !isCancelled(order) : false
      }),
    [filteredItems, ordersById],
  )
  const releasedAllItems = useMemo(
    () =>
      itemRows.filter((it) => {
        const order = ordersById.get(it.order_id)
        return order ? isReleased(order) && !isCancelled(order) : false
      }),
    [itemRows, ordersById],
  )

  const totalOrders = doorOrders.length
  const soldItems = useMemo(
    () => releasedFilteredItems.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0),
    [releasedFilteredItems],
  )
  const allNonCancelledItems = useMemo(
    () =>
      filteredItems.reduce((sum, it) => {
        const order = ordersById.get(it.order_id)
        if (!order || isCancelled(order)) return sum
        return sum + (Number(it.quantity) || 0)
      }, 0),
    [filteredItems, ordersById],
  )

  const avgRealization = useMemo(() => {
    const values = doorOrders
      .filter((o) => !isCancelled(o) && isReleased(o))
      .map((o) => daysBetween((o as { created_at?: string }).created_at ?? o.order_date, o.release_date ?? null))
      .filter((v): v is number => v !== null)
    if (values.length === 0) return null
    return values.reduce((s, v) => s + v, 0) / values.length
  }, [doorOrders])

  const cancelRate = useMemo(() => {
    if (doorOrders.length === 0) return 0
    const cancelled = doorOrders.filter(isCancelled).length
    return (cancelled / doorOrders.length) * 100
  }, [doorOrders])

  const salesByMonth = useMemo(() => {
    const now = new Date()
    const map = new Map<string, number>()
    for (let i = rangeMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      map.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, 0)
    }
    for (const it of releasedFilteredItems) {
      const order = ordersById.get(it.order_id)
      if (!order?.release_date) continue
      const d = new Date(order.release_date)
      if (Number.isNaN(d.getTime())) continue
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!map.has(key)) continue
      map.set(key, (map.get(key) ?? 0) + (Number(it.quantity) || 0))
    }
    return Array.from(map.entries()).map(([month, qty]) => ({ month, qty }))
  }, [releasedFilteredItems, ordersById, rangeMonths])

  const topSku = useMemo(() => {
    const map = new Map<number, { name: string; qty: number; cat: string }>()
    for (const it of releasedFilteredItems) {
      const key = it.component_id
      const prev = map.get(key)
      const qty = Number(it.quantity) || 0
      if (prev) {
        prev.qty += qty
      } else {
        map.set(key, {
          name: String(it.component_name ?? `#${key}`),
          qty,
          cat: String(it.component_category ?? it.component_product_category ?? ''),
        })
      }
    }
    return Array.from(map.entries())
      .map(([id, x]) => ({ id, ...x }))
      .sort((a, b) => b.qty - a.qty)
  }, [releasedFilteredItems])

  const top10Sku = useMemo(() => topSku.slice(0, 10).map((r) => ({
    ...r,
    shortName: r.name.length > 30 ? `${r.name.slice(0, 30)}...` : r.name,
  })), [topSku])

  const typeDistribution = useMemo(() => {
    const source = itemFilter === 'all' ? releasedAllItems : releasedFilteredItems
    const map = new Map<string, number>()
    for (const it of source) {
      const cat = String(it.component_category ?? it.component_product_category ?? '')
      map.set(cat, (map.get(cat) ?? 0) + (Number(it.quantity) || 0))
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value, label: catLabel(name) }))
  }, [itemFilter, releasedAllItems, releasedFilteredItems])

  const topCompanies = useMemo(() => {
    const map = new Map<string, number>()
    for (const o of doorOrders) {
      if (isCancelled(o)) continue
      const company = String(o.company ?? '').trim() || '(brak)'
      map.set(company, (map.get(company) ?? 0) + 1)
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [doorOrders])

  const statusData = useMemo(() => {
    let inProgress = 0
    let released = 0
    let cancelled = 0
    for (const o of doorOrders) {
      if (isCancelled(o)) cancelled += 1
      else if (isReleased(o)) released += 1
      else inProgress += 1
    }
    return [
      { name: 'W realizacji', value: inProgress, color: '#9ca3af' },
      { name: 'Wydane', value: released, color: '#16a34a' },
      { name: 'Anulowane', value: cancelled, color: '#dc2626' },
    ]
  }, [doorOrders])

  const modelData = useMemo(() => {
    if (!(itemFilter === 'all' || itemFilter === 'door_wing')) return []
    const map = new Map<string, number>()
    for (const it of releasedAllItems) {
      const cat = String(it.component_category ?? it.component_product_category ?? '')
      if (cat !== 'door_wing') continue
      const model = String(it.component_door_model ?? '').trim() || '(brak)'
      map.set(model, (map.get(model) ?? 0) + (Number(it.quantity) || 0))
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [itemFilter, releasedAllItems])

  const colorData = useMemo(() => {
    const map = new Map<string, number>()
    for (const it of releasedFilteredItems) {
      const color = String(it.component_door_color ?? '').trim() || '(brak)'
      map.set(color, (map.get(color) ?? 0) + (Number(it.quantity) || 0))
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [releasedFilteredItems])

  const byWeekday = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0]
    for (const o of doorOrders) {
      if (isCancelled(o)) continue
      const raw = (o as { created_at?: string }).created_at ?? o.order_date
      if (!raw) continue
      const d = new Date(raw)
      if (Number.isNaN(d.getTime())) continue
      counts[d.getDay()] += 1
    }
    return [
      { name: 'Pn', value: counts[1] },
      { name: 'Wt', value: counts[2] },
      { name: 'Śr', value: counts[3] },
      { name: 'Czw', value: counts[4] },
      { name: 'Pt', value: counts[5] },
      { name: 'Sob', value: counts[6] },
      { name: 'Nd', value: counts[0] },
    ]
  }, [doorOrders])

  const totalSoldForShare = useMemo(
    () => topSku.reduce((sum, r) => sum + r.qty, 0),
    [topSku],
  )
  const visibleSku = useMemo(() => topSku.slice(0, visibleSkuRows), [topSku, visibleSkuRows])

  if (loading || itemsLoading) {
    return <div className="stats-dashboard">Ładowanie…</div>
  }

  if (doorOrders.length === 0) {
    return (
      <div className="stats-dashboard">
        <div className="stats-grid-full">
          <div className="stats-card">
            Brak danych dla tej kategorii. Pierwsze zamówienia drzwi wewnętrznych pojawią się tutaj po ich wprowadzeniu.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="stats-dashboard">
      <div className="alerts-filter-pills" style={{ marginBottom: 12 }}>
        {ITEM_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`alerts-filter-pill ${itemFilter === f.key ? 'alerts-filter-pill--active' : ''}`}
            onClick={() => setItemFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="stats-grid-full">
        <div className="stats-card">
          <div className="stats-kpi-row">
            <div className="stats-kpi">
              <div className="stats-kpi-value">{totalOrders}</div>
              <div className="stats-kpi-label">Zamówienia</div>
            </div>
            <div className="stats-kpi">
              <div className="stats-kpi-value">{soldItems}</div>
              <div className="stats-kpi-label">Pozycje sprzedane</div>
              <div className="stats-kpi-label">(wszystkie statusy: {allNonCancelledItems})</div>
            </div>
            <div className="stats-kpi">
              <div className="stats-kpi-value">{avgRealization != null ? `${avgRealization.toFixed(1)} dnia` : '—'}</div>
              <div className="stats-kpi-label">Średni czas realizacji</div>
            </div>
            <div className="stats-kpi">
              <div className="stats-kpi-value">{formatPercent(cancelRate)}</div>
              <div className="stats-kpi-label">Współczynnik anulowań</div>
            </div>
          </div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stats-card">
          <div className="stats-card-header">
            <h3>Sprzedaż w czasie</h3>
            <select className="day-filter" value={rangeMonths} onChange={(e) => setRangeMonths(Number(e.target.value))}>
              <option value={3}>3 miesiące</option>
              <option value={6}>6 miesięcy</option>
              <option value={12}>12 miesięcy</option>
              <option value={24}>24 miesiące</option>
            </select>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={salesByMonth}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="qty" name="Sztuki" stroke="#3b82f6" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="stats-card">
          <h3>Top 10 SKU</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={top10Sku} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="shortName" width={180} />
              <Tooltip />
              <Bar dataKey="qty" name="Sztuki" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="stats-card">
          <h3>Rozkład per typ pozycji</h3>
          {itemFilter !== 'all' && (
            <div style={{ color: '#6b7280', marginBottom: 8 }}>
              Filtr aktywny: pokazuje tylko {ITEM_FILTERS.find((f) => f.key === itemFilter)?.label}
            </div>
          )}
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={typeDistribution} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={100} label>
                {typeDistribution.map((entry, idx) => (
                  <Cell key={`${entry.name}-${idx}`} fill={['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b'][idx % 4]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="stats-card">
          <h3>Top 10 firm</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={topCompanies} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={160} />
              <Tooltip />
              <Bar dataKey="value" name="Zamówienia" fill="#06b6d4" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="stats-card">
          <h3>Status zamówień</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                {statusData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="stats-card">
          <h3>{itemFilter === 'all' || itemFilter === 'door_wing' ? 'Rozkład per model skrzydła' : 'Rozkład per model'}</h3>
          {itemFilter !== 'all' && itemFilter !== 'door_wing' ? (
            <div style={{ color: '#6b7280' }}>Wykres dostępny dla filtra „Wszystko” lub „Skrzydła”.</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={modelData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="name" width={160} />
                <Tooltip />
                <Bar dataKey="value" name="Sztuki" fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="stats-card">
          <h3>Rozkład per kolor</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={colorData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={160} />
              <Tooltip />
              <Bar dataKey="value" name="Sztuki" fill="#ec4899" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="stats-card">
          <h3>Zamówienia per dzień tygodnia</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byWeekday}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" name="Zamówienia" fill="#0ea5e9" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="stats-grid-full">
        <div className="stats-card">
          <h3>Najpopularniejsze SKU</h3>
          {topSku.length === 0 ? (
            <p style={{ color: '#6b7280' }}>Brak sprzedanych pozycji dla wybranego filtra.</p>
          ) : (
            <>
              <div className="table-wrapper">
                <table className="orders-table">
                  <thead>
                    <tr>
                      <th>Pozycja</th>
                      <th>Kategoria</th>
                      <th>Sprzedane sztuki</th>
                      <th>% udziału</th>
                      <th>Aktywny stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSku.map((row) => (
                      <tr key={row.id}>
                        <td>{row.name}</td>
                        <td>
                          <span className="component-category-badge">{catLabel(row.cat)}</span>
                        </td>
                        <td>{row.qty}</td>
                        <td>{totalSoldForShare > 0 ? `${((row.qty / totalSoldForShare) * 100).toFixed(1)}%` : '0%'}</td>
                        <td>—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {visibleSkuRows < topSku.length && (
                <button type="button" className="btn btn-sm btn-primary" style={{ marginTop: 10 }} onClick={() => setVisibleSkuRows((v) => v + 50)}>
                  Pokaż więcej
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
