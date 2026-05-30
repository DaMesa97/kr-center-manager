import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Order } from '../../types'
import { isReleaseDateEmpty } from '../../utils'

type Props = {
  category: string
  orders: Order[]
  loading: boolean
}

function isCancelled(o: Order): boolean {
  const extra = o.extra_fields as Record<string, unknown> | null | undefined
  return extra?.cancelled === true
}

export default function CategoryStatsDashboard({ category, orders, loading }: Props) {
  const filteredOrdersNonCancelled = useMemo(() => {
    return orders.filter((o) => {
      if (o.category !== category) return false
      if (isCancelled(o)) return false
      return true
    })
  }, [orders, category])

  const completedCategoryOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.category === category && !isCancelled(o) && !isReleaseDateEmpty(o.release_date),
      ),
    [orders, category],
  )

  const [rangeMonths, setRangeMonths] = useState(12)

  const productionData = useMemo(() => {
    const now = new Date()
    const map = new Map<string, number>()

    for (let i = rangeMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      map.set(key, 0)
    }

    const cutoff = new Date(now.getFullYear(), now.getMonth() - rangeMonths + 1, 1)

    for (const o of completedCategoryOrders) {
      const createdAt = (o as { created_at?: string }).created_at
      const created = createdAt
        ? new Date(createdAt)
        : o.order_date
          ? new Date(o.order_date)
          : null
      if (!created || created < cutoff) continue
      const key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`
      if (map.has(key)) {
        map.set(key, (map.get(key) ?? 0) + (Number(o.quantity) || 0))
      }
    }

    return Array.from(map.entries()).map(([month, qty]) => ({ month, qty }))
  }, [completedCategoryOrders, rangeMonths])

  const systemData = useMemo(() => {
    const map = new Map<string, number>()
    for (const o of completedCategoryOrders) {
      const sys = (o.system || '').trim() || '(brak)'
      map.set(sys, (map.get(sys) ?? 0) + (Number(o.quantity) || 0))
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [completedCategoryOrders])

  const statusData = useMemo(() => {
    const allInCategory = orders.filter((o) => o.category === category)
    let done = 0
    let cancelled = 0
    let inProgress = 0
    for (const o of allInCategory) {
      const extra = o.extra_fields as Record<string, unknown> | null | undefined
      const q = Number(o.quantity) || 0
      if (extra?.cancelled === true) {
        cancelled += q
      } else if (!isReleaseDateEmpty(o.release_date)) {
        done += q
      } else {
        inProgress += q
      }
    }
    return [
      { name: 'Zrealizowane', value: done, color: '#10b981' },
      { name: 'W produkcji', value: inProgress, color: '#3b82f6' },
      { name: 'Anulowane', value: cancelled, color: '#ef4444' },
    ]
  }, [orders, category])

  const topCompaniesData = useMemo(() => {
    const map = new Map<string, number>()
    for (const o of filteredOrdersNonCancelled) {
      const company = (o.company || '').trim() || '(brak)'
      map.set(company, (map.get(company) ?? 0) + (Number(o.quantity) || 0))
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [filteredOrdersNonCancelled])

  const realizationTimes = useMemo(() => {
    const times: Array<{ order: Order; days: number; releaseMonth: string }> = []

    for (const o of filteredOrdersNonCancelled) {
      if (!o.release_date || isReleaseDateEmpty(o.release_date)) continue

      const createdStr = (o as { created_at?: string }).created_at ?? o.order_date
      if (!createdStr) continue

      const created = new Date(createdStr)
      const released = new Date(o.release_date)
      const diffMs = released.getTime() - created.getTime()
      const days = Math.round(diffMs / (1000 * 60 * 60 * 24))

      if (days < 0) continue

      const releaseMonth = `${released.getFullYear()}-${String(released.getMonth() + 1).padStart(2, '0')}`
      times.push({ order: o, days, releaseMonth })
    }

    return times
  }, [filteredOrdersNonCancelled])

  const avgRealizationDays = useMemo(() => {
    if (realizationTimes.length === 0) return null
    const sum = realizationTimes.reduce((s, t) => s + t.days, 0)
    return Math.round(sum / realizationTimes.length)
  }, [realizationTimes])

  const minRealizationDays = useMemo(() => {
    if (realizationTimes.length === 0) return null
    return Math.min(...realizationTimes.map((t) => t.days))
  }, [realizationTimes])

  const maxRealizationDays = useMemo(() => {
    if (realizationTimes.length === 0) return null
    return Math.max(...realizationTimes.map((t) => t.days))
  }, [realizationTimes])

  const avgRealizationByMonth = useMemo(() => {
    const now = new Date()
    const map = new Map<string, { sum: number; count: number }>()

    for (let i = rangeMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      map.set(key, { sum: 0, count: 0 })
    }

    for (const t of realizationTimes) {
      const existing = map.get(t.releaseMonth)
      if (existing) {
        existing.sum += t.days
        existing.count += 1
      }
    }

    return Array.from(map.entries()).map(([month, { sum, count }]) => ({
      month,
      avg: count > 0 ? Math.round(sum / count) : 0,
    }))
  }, [realizationTimes, rangeMonths])

  const byWeekday = useMemo(() => {
    const POLISH_WEEKDAYS = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota']
    const counts = [0, 0, 0, 0, 0, 0, 0]

    for (const o of filteredOrdersNonCancelled) {
      const createdStr = (o as { created_at?: string }).created_at ?? o.order_date
      if (!createdStr) continue
      const d = new Date(createdStr)
      const dayOfWeek = d.getDay()
      counts[dayOfWeek] += Number(o.quantity) || 1
    }

    const reordered = [
      { name: 'Pon', value: counts[1] },
      { name: 'Wt', value: counts[2] },
      { name: 'Śr', value: counts[3] },
      { name: 'Czw', value: counts[4] },
      { name: 'Pt', value: counts[5] },
      { name: 'Sob', value: counts[6] },
      { name: 'Ndz', value: counts[0] },
    ]

    // POLISH_WEEKDAYS: indeks zgodny z Date#getDay() (0 = Niedziela … 6 = Sobota)
    void POLISH_WEEKDAYS

    return reordered
  }, [filteredOrdersNonCancelled])

  const byModel = useMemo(() => {
    const map = new Map<string, number>()
    for (const o of filteredOrdersNonCancelled) {
      const model = o.model?.trim() || '(brak)'
      map.set(model, (map.get(model) ?? 0) + (Number(o.quantity) || 1))
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 15)
  }, [filteredOrdersNonCancelled])

  const byWingColor = useMemo(() => {
    const map = new Map<string, number>()
    for (const o of filteredOrdersNonCancelled) {
      const color = o.wing_color?.trim() || '(brak)'
      map.set(color, (map.get(color) ?? 0) + (Number(o.quantity) || 1))
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 15)
  }, [filteredOrdersNonCancelled])

  if (loading) {
    return <div className="stats-dashboard">Ładowanie…</div>
  }

  return (
    <div className="stats-dashboard">
      <div className="stats-grid-full">
        <div className="stats-card">
          <h3>Średni czas realizacji — {category}</h3>

          {avgRealizationDays === null ? (
            <p style={{ color: '#6b7280', padding: '20px 0' }}>Brak zrealizowanych zamówień w tej kategorii</p>
          ) : (
            <>
              <div className="stats-kpi-row">
                <div className="stats-kpi">
                  <div className="stats-kpi-value">{avgRealizationDays}</div>
                  <div className="stats-kpi-label">dni średnio</div>
                </div>
                <div className="stats-kpi">
                  <div className="stats-kpi-value">{minRealizationDays}</div>
                  <div className="stats-kpi-label">minimum</div>
                </div>
                <div className="stats-kpi">
                  <div className="stats-kpi-value">{maxRealizationDays}</div>
                  <div className="stats-kpi-label">maksimum</div>
                </div>
                <div className="stats-kpi">
                  <div className="stats-kpi-value">{realizationTimes.length}</div>
                  <div className="stats-kpi-label">zamówień</div>
                </div>
              </div>

              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={avgRealizationByMonth}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis label={{ value: 'Dni', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="avg"
                    name="Średni czas (dni)"
                    stroke="#10b981"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
        </div>
      </div>

      <div className="stats-grid">
        <div className="stats-card">
          <div className="stats-card-header">
            <h3>Produkcja w czasie {category}</h3>
            <select
              className="day-filter"
              value={rangeMonths}
              onChange={(e) => setRangeMonths(Number(e.target.value))}
            >
              <option value={3}>3 miesiące</option>
              <option value={6}>6 miesięcy</option>
              <option value={12}>12 miesięcy</option>
              <option value={24}>24 miesiące</option>
            </select>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={productionData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="qty" name="Ilość drzwi" stroke="#3b82f6" strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="stats-card">
          <h3>Rozkład per system (zrealizowane) {category}</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={systemData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="value" name="Ilość drzwi" fill="#8b5cf6" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="stats-card">
          <h3>Status zamówień {category}</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={statusData}
                dataKey="value"
                nameKey="name"
                name="Ilość drzwi"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={({ name, value }) => `${name}: ${value}`}
              >
                {statusData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="stats-card">
          <h3>Top 10 firm {category}</h3>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={topCompaniesData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="value" name="Ilość drzwi" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="stats-grid-full">
        <div className="stats-card">
          <h3>Zamówienia per dzień tygodnia — {category}</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byWeekday}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" name="Ilość drzwi" fill="#06b6d4" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="stats-grid-full">
        <div className="stats-card">
          <h3>Rozkład per model — {category}</h3>
          <ResponsiveContainer width="100%" height={450}>
            <BarChart data={byModel} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={180} />
              <Tooltip />
              <Bar dataKey="value" name="Ilość drzwi" fill="#8b5cf6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="stats-grid-full">
        <div className="stats-card">
          <h3>Rozkład per kolor skrzydła — {category}</h3>
          <ResponsiveContainer width="100%" height={450}>
            <BarChart data={byWingColor} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={180} />
              <Tooltip />
              <Bar dataKey="value" name="Ilość drzwi" fill="#ec4899" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
