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
import type { Complaint } from '../../types'

const COMPLAINT_COLORS = [
  '#ef4444',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#10b981',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#f43f5e',
]

const CATEGORY_COLORS: Record<string, string> = {
  STA: '#3b82f6',
  Disting: '#8b5cf6',
  ST: '#10b981',
  Techniczne: '#f59e0b',
  Bastion: '#ef4444',
  '(brak)': '#9ca3af',
}

type Props = {
  complaints: Complaint[]
  loading: boolean
}

export default function ComplaintsStatsDashboard({ complaints, loading }: Props) {
  const [rangeMonths, setRangeMonths] = useState(12)

  const complaintsByMonth = useMemo(() => {
    const now = new Date()
    const map = new Map<string, number>()

    for (let i = rangeMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      map.set(key, 0)
    }

    const cutoff = new Date(now.getFullYear(), now.getMonth() - rangeMonths + 1, 1)

    for (const c of complaints) {
      const dateStr = c.created_at ?? c.complaint_date
      if (!dateStr) continue
      const d = new Date(dateStr)
      if (d < cutoff) continue
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (map.has(key)) {
        map.set(key, (map.get(key) ?? 0) + 1)
      }
    }

    return Array.from(map.entries()).map(([month, count]) => ({ month, count }))
  }, [complaints, rangeMonths])

  const topCompaniesComplaints = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of complaints) {
      const company = c.company?.trim() || '(brak)'
      map.set(company, (map.get(company) ?? 0) + 1)
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [complaints])

  const byWhatComplained = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of complaints) {
      const what = c.what_complained?.trim() || '(brak)'
      map.set(what, (map.get(what) ?? 0) + 1)
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [complaints])

  const byCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of complaints) {
      const cat = c.category?.trim() || '(brak)'
      map.set(cat, (map.get(cat) ?? 0) + 1)
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [complaints])

  if (loading) {
    return <div className="stats-dashboard">Ładowanie…</div>
  }

  return (
    <div className="stats-dashboard">
      <div className="stats-grid-full">
        <div className="stats-card">
          <div className="stats-card-header">
            <h3>Liczba reklamacji w czasie</h3>
            <select
              className="day-filter"
              value={rangeMonths}
              onChange={(e) => setRangeMonths(Number(e.target.value))}
            >
              <option value={3}>3 miesiące</option>
              <option value={6}>6 miesięcy</option>
              <option value={12}>12 miesięcy</option>
              <option value={24}>24 miesięcy</option>
            </select>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={complaintsByMonth}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="count"
                name="Liczba reklamacji"
                stroke="#ef4444"
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stats-card">
          <h3>Top 10 firm z reklamacjami</h3>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={topCompaniesComplaints} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={150} />
              <Tooltip />
              <Bar dataKey="value" name="Liczba reklamacji" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="stats-card">
          <h3>Co reklamowane</h3>
          <ResponsiveContainer width="100%" height={400}>
            <PieChart>
              <Pie
                data={byWhatComplained}
                dataKey="value"
                nameKey="name"
                name="Liczba reklamacji"
                cx="50%"
                cy="50%"
                outerRadius={120}
                label={({ name, value }) => `${name}: ${value}`}
              >
                {byWhatComplained.map((entry, idx) => (
                  <Cell key={`${entry.name}-${idx}`} fill={COMPLAINT_COLORS[idx % COMPLAINT_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="stats-grid-full">
        <div className="stats-card">
          <h3>Reklamacje per kategoria</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={byCategory}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" name="Liczba reklamacji" fill="#9ca3af">
                {byCategory.map((entry, idx) => (
                  <Cell key={idx} fill={CATEGORY_COLORS[entry.name] ?? '#9ca3af'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
