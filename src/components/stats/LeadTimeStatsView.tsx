import { useCallback, useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { supabase } from '../../supabaseClient'
import Spinner from '../Spinner'

const PROD_CATEGORIES = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne'] as const

const CAT_COLORS: Record<string, string> = {
  STA: '#005faf', Disting: '#4f46e5', ST: '#1d6d45',
  Techniczne: '#854d0e', Bastion: '#b3261e', DrzwiWewnetrzne: '#0369a1',
}

type Preset = 'month' | 'quarter' | 'halfyear' | 'year'

type CategoryStat = {
  category: string
  count: number
  avgDays: number
  medianDays: number
  minDays: number
  maxDays: number
}

type Bucket = { label: string; count: number }

function daysBetween(from: string, to: string): number | null {
  const a = new Date(from)
  const b = new Date(to)
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null
  const d = Math.round((b.getTime() - a.getTime()) / 86_400_000)
  return d >= 0 ? d : null
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function presetFromDate(preset: Preset): string {
  const now = new Date()
  const d = new Date(now)
  if (preset === 'month') d.setMonth(d.getMonth() - 1)
  else if (preset === 'quarter') d.setMonth(d.getMonth() - 3)
  else if (preset === 'halfyear') d.setMonth(d.getMonth() - 6)
  else d.setFullYear(d.getFullYear() - 1)
  return d.toISOString().slice(0, 10)
}

export default function LeadTimeStatsView() {
  const [preset, setPreset] = useState<Preset>('quarter')
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<CategoryStat[]>([])
  const [buckets, setBuckets] = useState<Bucket[]>([])
  const [totalCount, setTotalCount] = useState(0)

  const load = useCallback(async (p: Preset) => {
    setLoading(true)
    try {
      const fromDate = presetFromDate(p)
      // Pobierz wydane zamówienia (release_date ustawiona) z zakresu
      const { data, error } = await supabase
        .from('orders')
        .select('category, order_date, release_date, extra_fields')
        .not('release_date', 'is', null)
        .gte('release_date', fromDate)
        .order('release_date', { ascending: false })
        .limit(10000)

      if (error) {
        console.error('[LeadTime]', error)
        setStats([]); setBuckets([]); setTotalCount(0)
        return
      }

      const byCategory = new Map<string, number[]>()
      const allDays: number[] = []

      for (const row of (data ?? []) as Array<{
        category: string
        order_date: string | null
        release_date: string | null
        extra_fields: Record<string, unknown> | null
      }>) {
        if (row.extra_fields?.cancelled === true) continue
        if (!row.order_date || !row.release_date) continue
        const d = daysBetween(row.order_date, row.release_date)
        if (d == null) continue
        const cat = String(row.category)
        if (!PROD_CATEGORIES.includes(cat as typeof PROD_CATEGORIES[number])) continue
        const arr = byCategory.get(cat) ?? []
        arr.push(d)
        byCategory.set(cat, arr)
        allDays.push(d)
      }

      const result: CategoryStat[] = []
      for (const cat of PROD_CATEGORIES) {
        const arr = byCategory.get(cat) ?? []
        if (arr.length === 0) continue
        result.push({
          category: cat,
          count: arr.length,
          avgDays: arr.reduce((s, v) => s + v, 0) / arr.length,
          medianDays: median(arr),
          minDays: Math.min(...arr),
          maxDays: Math.max(...arr),
        })
      }
      setStats(result)
      setTotalCount(allDays.length)

      // Rozkład w przedziałach
      const b: Bucket[] = [
        { label: '0–7 dni', count: allDays.filter((d) => d <= 7).length },
        { label: '8–14 dni', count: allDays.filter((d) => d > 7 && d <= 14).length },
        { label: '15–21 dni', count: allDays.filter((d) => d > 14 && d <= 21).length },
        { label: '22–42 dni', count: allDays.filter((d) => d > 21 && d <= 42).length },
        { label: '43+ dni', count: allDays.filter((d) => d > 42).length },
      ]
      setBuckets(b)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(preset) }, [preset, load])

  const chartData = stats.map((s) => ({
    name: s.category === 'DrzwiWewnetrzne' ? 'Wewn.' : s.category,
    category: s.category,
    avg: Number(s.avgDays.toFixed(1)),
  }))

  return (
    <div className="leadtime-view">
      <div className="leadtime-presets">
        {(['month', 'quarter', 'halfyear', 'year'] as Preset[]).map((p) => (
          <button
            key={p}
            type="button"
            className={`btn btn-sm ${preset === p ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setPreset(p)}
          >
            {{ month: 'Miesiąc', quarter: 'Kwartał', halfyear: 'Pół roku', year: 'Rok' }[p]}
          </button>
        ))}
        {!loading && (
          <span className="leadtime-total">
            Przeanalizowano <strong>{totalCount}</strong> wydanych zamówień
          </span>
        )}
      </div>

      {loading ? (
        <Spinner center label="Ładowanie danych…" />
      ) : stats.length === 0 ? (
        <p className="no-results">Brak wydanych zamówień w wybranym okresie.</p>
      ) : (
        <>
          <div className="leadtime-section">
            <h3 className="leadtime-section-title">Średni czas realizacji wg kategorii (dni)</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} tickLine={false} />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(value) => [`${value} dni`, 'Średnio']}
                  contentStyle={{ fontSize: '0.8rem' }}
                />
                <Bar dataKey="avg" radius={[4, 4, 0, 0]}>
                  {chartData.map((d) => (
                    <Cell key={d.category} fill={CAT_COLORS[d.category] ?? '#64748b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="leadtime-section">
            <h3 className="leadtime-section-title">Szczegóły wg kategorii</h3>
            <div className="table-wrapper">
              <table className="orders-table">
                <thead>
                  <tr>
                    <th>Kategoria</th>
                    <th style={{ textAlign: 'center' }}>Liczba</th>
                    <th style={{ textAlign: 'center' }}>Średnia</th>
                    <th style={{ textAlign: 'center' }}>Mediana</th>
                    <th style={{ textAlign: 'center' }}>Min</th>
                    <th style={{ textAlign: 'center' }}>Max</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s) => (
                    <tr key={s.category}>
                      <td>
                        <span className="leadtime-cat-badge" style={{ background: CAT_COLORS[s.category] }}>
                          {s.category === 'DrzwiWewnetrzne' ? 'Wewn.' : s.category}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>{s.count}</td>
                      <td style={{ textAlign: 'center' }}><strong>{s.avgDays.toFixed(1)} dni</strong></td>
                      <td style={{ textAlign: 'center' }}>{s.medianDays.toFixed(0)} dni</td>
                      <td style={{ textAlign: 'center', color: '#16a34a' }}>{s.minDays}</td>
                      <td style={{ textAlign: 'center', color: '#dc2626' }}>{s.maxDays}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="leadtime-section">
            <h3 className="leadtime-section-title">Rozkład czasu realizacji</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={buckets} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => [`${value} zam.`, 'Liczba']} contentStyle={{ fontSize: '0.8rem' }} />
                <Bar dataKey="count" fill="#005faf" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  )
}
