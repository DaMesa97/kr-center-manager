import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Complaint, Order } from '../../types'
import { isReleaseDateEmpty } from '../../utils'
import {
  companyNames,
  computeCompanyStats,
  resolveCompanyQuery,
  type CompanyPeriodMonths,
} from '../../lib/companyStats'
import Spinner from '../Spinner'
import DataTable, { type DataTableColumn } from '../DataTable'

// Statystyki → Firmy (#118, Tymek 6.11): jedna firma pod lupą — ile zamawia,
// ile reklamuje, jak szybko dostaje, co zamawia. Liczone z danych w pamięci.

type Props = {
  orders: Order[]
  complaints: Complaint[]
  loading: boolean
}

const QUERY_KEY = 'stats.firma.query'
const PERIOD_KEY = 'stats.firma.okres'

function readStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function daysBetween(from: string, to: string): number | null {
  const a = new Date(from)
  const b = new Date(to)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null
  const d = Math.round((b.getTime() - a.getTime()) / 86_400_000)
  return d >= 0 ? d : null
}

const SOURCE_LABEL: Record<string, string> = {
  bot: 'konfigurator',
  excel: 'Excel',
  manual: 'ręcznie',
  api: 'API',
  migracja: 'migracja',
}

const recentColumns: DataTableColumn<Order>[] = [
  { key: 'nr', label: 'Nr', sortValue: (o) => Number(o.order_number) || o.order_number, render: (o) => <b>{o.order_number}</b> },
  { key: 'cat', label: 'Kategoria', sortValue: (o) => o.category, render: (o) => o.category },
  { key: 'model', label: 'Model', sortValue: (o) => o.model, render: (o) => o.model || '—' },
  { key: 'color', label: 'Kolor', sortValue: (o) => o.wing_color, render: (o) => o.wing_color || '—' },
  { key: 'qty', label: 'Szt.', align: 'right', sortValue: (o) => Number(o.quantity) || 1, render: (o) => Number(o.quantity) || 1 },
  { key: 'date', label: 'Zamówione', sortValue: (o) => o.order_date, render: (o) => o.order_date || '—' },
  {
    key: 'release',
    label: 'Wydane',
    sortValue: (o) => (isReleaseDateEmpty(o.release_date) ? '' : String(o.release_date)),
    render: (o) => (isReleaseDateEmpty(o.release_date) ? <span style={{ color: '#2563eb' }}>w realizacji</span> : String(o.release_date)),
  },
  {
    key: 'days',
    label: 'Dni',
    title: 'Dni od zamówienia do wydania',
    align: 'right',
    sortValue: (o) => (isReleaseDateEmpty(o.release_date) || !o.order_date ? -1 : daysBetween(o.order_date, String(o.release_date)) ?? -1),
    render: (o) => {
      if (isReleaseDateEmpty(o.release_date) || !o.order_date) return '—'
      const d = daysBetween(o.order_date, String(o.release_date))
      return d == null ? '—' : d
    },
  },
  { key: 'source', label: 'Źródło', sortValue: (o) => o.source ?? '', render: (o) => SOURCE_LABEL[String(o.source ?? '')] ?? '—' },
]

export default function CompanyStatsView({ orders, complaints, loading }: Props) {
  const [query, setQuery] = useState(() => readStored(QUERY_KEY, ''))
  const [months, setMonths] = useState<CompanyPeriodMonths>(() => {
    const v = Number(readStored(PERIOD_KEY, '12'))
    return ([0, 3, 6, 12, 24] as const).includes(v as CompanyPeriodMonths) ? (v as CompanyPeriodMonths) : 12
  })

  useEffect(() => {
    try {
      localStorage.setItem(QUERY_KEY, query)
      localStorage.setItem(PERIOD_KEY, String(months))
    } catch {
      /* prywatne okno / zablokowane dane strony — bez pamiętania */
    }
  }, [query, months])

  const names = useMemo(() => companyNames(orders), [orders])
  const matched = useMemo(() => resolveCompanyQuery(query, names.map((n) => n.name)), [query, names])
  const stats = useMemo(
    () => (matched.length ? computeCompanyStats(orders, complaints, matched, months) : null),
    [orders, complaints, matched, months],
  )

  if (loading) {
    return <div className="stats-dashboard"><Spinner center label="Ładowanie…" /></div>
  }

  const exact = matched.length === 1 && matched[0].trim().toUpperCase() === query.trim().toUpperCase()

  return (
    <div className="stats-dashboard">
      <div className="stats-grid-full">
        <div className="stats-card">
          <div className="stats-card-header">
            <h3>Firma pod lupą</h3>
            <select className="day-filter" value={months} onChange={(e) => setMonths(Number(e.target.value) as CompanyPeriodMonths)}>
              <option value={3}>3 miesiące</option>
              <option value={6}>6 miesięcy</option>
              <option value={12}>12 miesięcy</option>
              <option value={24}>24 miesiące</option>
              <option value={0}>cały okres</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="search-input"
              list="stats-firma-lista"
              placeholder="Wpisz lub wybierz firmę…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ minWidth: 320 }}
              aria-label="Firma"
            />
            <datalist id="stats-firma-lista">
              {names.map((n) => (
                <option key={n.name} value={n.name}>{`${n.count} zleceń`}</option>
              ))}
            </datalist>
            {query.trim() && matched.length === 0 && <span style={{ color: '#b45309' }}>Brak firmy o takiej nazwie w zleceniach.</span>}
            {matched.length > 1 && (
              <span style={{ color: '#6b7280' }} title={matched.join(', ')}>
                {matched.length} nazw pasuje — liczone razem: {matched.slice(0, 4).join(', ')}{matched.length > 4 ? '…' : ''}
              </span>
            )}
            {exact && stats?.lastOrderDate && <span style={{ color: '#6b7280' }}>ostatnie zamówienie {stats.lastOrderDate}</span>}
          </div>
          {!query.trim() && (
            <p style={{ color: '#6b7280', padding: '16px 0 0' }}>
              Wybierz firmę, żeby zobaczyć, ile zamawia, ile reklamuje, jak szybko realizujemy jej zlecenia i co zamawia. Lista podpowiada firmy od najczęściej zamawiających.
            </p>
          )}
          {stats && (
            <div className="stats-kpi-row" style={{ marginTop: 16 }}>
              <div className="stats-kpi">
                <div className="stats-kpi-value">{stats.orders}</div>
                <div className="stats-kpi-label">zleceń ({stats.pieces} szt.)</div>
              </div>
              <div className="stats-kpi">
                <div className="stats-kpi-value">{stats.open}</div>
                <div className="stats-kpi-label">w realizacji</div>
              </div>
              <div className="stats-kpi">
                <div className="stats-kpi-value">{stats.complaints}</div>
                <div className="stats-kpi-label">reklamacji{stats.complaintsPer100 != null ? ` (${stats.complaintsPer100} na 100 zleceń)` : ''}</div>
              </div>
              <div className="stats-kpi">
                <div className="stats-kpi-value">{stats.avgDays ?? '—'}</div>
                <div className="stats-kpi-label">dni średnio{stats.medianDays != null ? ` (mediana ${stats.medianDays})` : ''}</div>
              </div>
              <div className="stats-kpi">
                <div className="stats-kpi-value">{stats.orders ? Math.round((stats.fromConfigurator / stats.orders) * 100) : 0}%</div>
                <div className="stats-kpi-label">z konfiguratora</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {stats && (
        <>
          <div className="stats-grid">
            <div className="stats-card">
              <h3 title="Sztuki i zlecenia wg miesiąca zamówienia; reklamacje wg daty zgłoszenia">Zamówienia i reklamacje w czasie</h3>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={stats.byMonth}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="left" dataKey="qty" name="Sztuki" fill="#3b82f6" />
                  <Bar yAxisId="left" dataKey="orders" name="Zlecenia" fill="#93c5fd" />
                  <Line yAxisId="right" type="monotone" dataKey="complaints" name="Reklamacje" stroke="#ef4444" strokeWidth={2} dot />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="stats-card">
              <h3>Kategorie (sztuki)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={stats.byCategory}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" name="Sztuki" fill="#8b5cf6" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="stats-card">
              <h3>Top 10 modeli</h3>
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={stats.topModels} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" name="Sztuki" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="stats-card">
              <h3>Top 10 kolorów skrzydła</h3>
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={stats.topColors} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" name="Sztuki" fill="#ec4899" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="stats-grid-full">
            <div className="stats-card">
              <h3>Ostatnie 20 zleceń</h3>
              <DataTable rows={stats.recent} rowKey={(o) => `${o.category}-${o.id ?? o.order_number}`} columns={recentColumns} emptyText="Brak zleceń w tym okresie." />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
