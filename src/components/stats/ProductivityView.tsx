import { useCallback, useEffect, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { supabase } from '../../supabaseClient'
import Spinner from '../Spinner'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const PROD_CATEGORIES = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne'] as const
type ProdCategory = (typeof PROD_CATEGORIES)[number]

type WorkerRow = {
  userId: string
  email: string
  name: string      // z profiles (full_name) lub email jako fallback
  initials: string  // z profiles
  byCategory: Record<ProdCategory, number>
  total: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseStages(raw: unknown): Record<string, string> {
  if (!raw) return {}
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Record<string, string> } catch { return {} }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, string>
  return {}
}

function countNewCompletions(
  oldStages: Record<string, string>,
  newStages: Record<string, string>,
): number {
  let count = 0
  for (const key of Object.keys(newStages)) {
    const wasEmpty = !oldStages[key] || oldStages[key].trim() === ''
    const isNowFilled = newStages[key] && newStages[key].trim() !== ''
    if (wasEmpty && isNowFilled) count++
  }
  return count
}

function getMonday(d: Date): Date {
  const copy = new Date(d)
  const day = copy.getDay()
  const diff = day === 0 ? -6 : 1 - day
  copy.setDate(copy.getDate() + diff)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Preset helpers
// ---------------------------------------------------------------------------

type Preset = 'week' | 'month' | 'lastMonth' | 'custom'

function presetDates(preset: Preset): { from: string; to: string } {
  const now = new Date()
  if (preset === 'week') {
    return { from: toDateStr(getMonday(now)), to: toDateStr(now) }
  }
  if (preset === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: toDateStr(from), to: toDateStr(now) }
  }
  if (preset === 'lastMonth') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const to = new Date(now.getFullYear(), now.getMonth(), 0)
    return { from: toDateStr(from), to: toDateStr(to) }
  }
  return { from: toDateStr(getMonday(now)), to: toDateStr(now) }
}

// ---------------------------------------------------------------------------
// Chart colors per category
// ---------------------------------------------------------------------------

const CAT_COLORS: Record<string, string> = {
  STA:             '#005faf',
  Disting:         '#4f46e5',
  ST:              '#1d6d45',
  Techniczne:      '#854d0e',
  Bastion:         '#b3261e',
  DrzwiWewnetrzne: '#0369a1',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProductivityView() {
  const [preset, setPreset] = useState<Preset>('month')
  const [dateFrom, setDateFrom] = useState(() => presetDates('month').from)
  const [dateTo, setDateTo] = useState(() => presetDates('month').to)
  const [rows, setRows] = useState<WorkerRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadedRange, setLoadedRange] = useState<{ from: string; to: string } | null>(null)

  const applyPreset = (p: Preset) => {
    setPreset(p)
    if (p !== 'custom') {
      const { from, to } = presetDates(p)
      setDateFrom(from)
      setDateTo(to)
    }
  }

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true)
    try {
      // 1. Pobierz wpisy audit_log dotyczące zmian production_stages
      const { data: auditData, error: auditError } = await supabase
        .from('audit_log')
        .select('user_id, user_email, created_at, old_data, new_data')
        .eq('table_name', 'orders')
        .eq('operation', 'UPDATE')
        .contains('changed_fields', ['production_stages'])
        .gte('created_at', `${from}T00:00:00`)
        .lte('created_at', `${to}T23:59:59`)
        .order('created_at', { ascending: false })
        .limit(10000)

      if (auditError) {
        console.error('[Productivity] audit_log error:', auditError)
        setRows([])
        return
      }

      // 2. Pobierz profile użytkowników (dla imion i inicjałów)
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, full_name, initials, role')

      const profilesMap = new Map<string, { name: string; initials: string; role: string }>()
      for (const p of (profilesData ?? []) as Array<{
        id: string; full_name?: string; initials?: string; role?: string
      }>) {
        profilesMap.set(p.id, {
          name: p.full_name ?? '',
          initials: p.initials ?? '',
          role: p.role ?? '',
        })
      }

      // 3. Agregacja
      const aggregated = new Map<string, Omit<WorkerRow, 'total'>>()

      for (const entry of (auditData ?? []) as Array<{
        user_id: string | null
        user_email: string | null
        old_data: Record<string, unknown> | null
        new_data: Record<string, unknown> | null
      }>) {
        if (!entry.user_id) continue

        const oldStages = parseStages(entry.old_data?.production_stages)
        const newStages = parseStages(entry.new_data?.production_stages)
        const completions = countNewCompletions(oldStages, newStages)
        if (completions === 0) continue

        const category = String(entry.new_data?.category ?? '')
        if (!PROD_CATEGORIES.includes(category as ProdCategory)) continue

        let workerRow = aggregated.get(entry.user_id)
        if (!workerRow) {
          const profile = profilesMap.get(entry.user_id)
          workerRow = {
            userId: entry.user_id,
            email: entry.user_email ?? '',
            name: profile?.name || entry.user_email || entry.user_id,
            initials: profile?.initials ?? '??',
            byCategory: { STA: 0, Disting: 0, ST: 0, Techniczne: 0, Bastion: 0, DrzwiWewnetrzne: 0 },
          }
          aggregated.set(entry.user_id, workerRow)
        }

        workerRow.byCategory[category as ProdCategory] = (workerRow.byCategory[category as ProdCategory] ?? 0) + completions
      }

      const result: WorkerRow[] = Array.from(aggregated.values())
        .map((r) => ({
          ...r,
          total: Object.values(r.byCategory).reduce((s, v) => s + v, 0),
        }))
        .sort((a, b) => b.total - a.total)

      setRows(result)
      setLoadedRange({ from, to })
    } finally {
      setLoading(false)
    }
  }, [])

  // Auto-ładuj przy pierwszym renderze
  useEffect(() => {
    void load(dateFrom, dateTo)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Dane dla wykresu (top 10 pracowników)
  const chartData = rows.slice(0, 10).map((r) => ({
    name: r.initials || r.name.split(' ')[0],
    fullName: r.name,
    ...r.byCategory,
  }))

  const totalCompletions = rows.reduce((s, r) => s + r.total, 0)

  return (
    <div className="productivity-view">
      {/* Filtry */}
      <div className="productivity-filters">
        <div className="productivity-presets">
          {(['week', 'month', 'lastMonth'] as Preset[]).map((p) => (
            <button
              key={p}
              type="button"
              className={`btn btn-sm ${preset === p ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => applyPreset(p)}
            >
              {({ week: 'Ten tydzień', month: 'Ten miesiąc', lastMonth: 'Poprzedni miesiąc' } as Record<string, string>)[p]}
            </button>
          ))}
          <button
            type="button"
            className={`btn btn-sm ${preset === 'custom' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => applyPreset('custom')}
          >
            Niestandardowy
          </button>
        </div>

        {preset === 'custom' && (
          <div className="productivity-date-range">
            <label>
              Od:
              <input
                type="date"
                className="search-input"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </label>
            <label>
              Do:
              <input
                type="date"
                className="search-input"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </label>
          </div>
        )}

        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => void load(dateFrom, dateTo)}
          disabled={loading}
        >
          {loading ? 'Ładowanie…' : '↻ Załaduj raport'}
        </button>
      </div>

      {/* Info o zakresie */}
      {loadedRange && !loading && (
        <div className="productivity-range-info">
          Dane za okres: <strong>{loadedRange.from}</strong> — <strong>{loadedRange.to}</strong>
          {rows.length > 0 && (
            <> · <strong>{totalCompletions}</strong> ukończonych etapów · <strong>{rows.length}</strong> pracowników</>
          )}
        </div>
      )}

      {loading && (
        <div className="productivity-loading"><Spinner center label="Ładowanie danych z audit log…" /></div>
      )}

      {!loading && rows.length === 0 && loadedRange && (
        <div className="productivity-empty">
          Brak danych o ukończonych etapach w wybranym okresie.<br />
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
            Upewnij się że audit log jest włączony dla tabeli orders i że pracownicy oznaczali etapy w tym czasie.
          </span>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <>
          {/* Wykres */}
          <div className="productivity-chart-section">
            <h3 className="productivity-section-title">Etapy ukończone — top {Math.min(chartData.length, 10)} pracowników</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(value) => [value, '']}
                  labelFormatter={(_label, payload) => {
                    const full = (payload?.[0]?.payload as { fullName?: string })?.fullName
                    return full ?? String(_label ?? '')
                  }}
                  contentStyle={{ fontSize: '0.8rem' }}
                />
                <Legend wrapperStyle={{ fontSize: '0.8rem' }} />
                {PROD_CATEGORIES.map((cat) => (
                  <Bar key={cat} dataKey={cat} stackId="a" fill={CAT_COLORS[cat]} radius={cat === 'DrzwiWewnetrzne' ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Tabela */}
          <div className="productivity-table-section">
            <h3 className="productivity-section-title">Szczegółowe zestawienie</h3>
            <div className="table-wrapper">
              <table className="orders-table productivity-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Pracownik</th>
                    <th style={{ textAlign: 'center' }}>Inicjały</th>
                    {PROD_CATEGORIES.map((cat) => (
                      <th key={cat} style={{ textAlign: 'center' }}>
                        <span
                          className="productivity-cat-badge"
                          style={{ background: CAT_COLORS[cat] }}
                        >
                          {cat === 'DrzwiWewnetrzne' ? 'Wewn.' : cat}
                        </span>
                      </th>
                    ))}
                    <th style={{ textAlign: 'center' }}>
                      <strong>Razem</strong>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.userId}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span className="productivity-rank">{i + 1}</span>
                          <span>{r.name}</span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className="productivity-initials">{r.initials}</span>
                      </td>
                      {PROD_CATEGORIES.map((cat) => (
                        <td key={cat} style={{ textAlign: 'center' }}>
                          {r.byCategory[cat] > 0 ? (
                            <span className="productivity-count">{r.byCategory[cat]}</span>
                          ) : (
                            <span style={{ color: '#cbd5e1' }}>—</span>
                          )}
                        </td>
                      ))}
                      <td style={{ textAlign: 'center' }}>
                        <strong className="productivity-total">{r.total}</strong>
                      </td>
                    </tr>
                  ))}
                  {/* Wiersz sumy */}
                  <tr className="productivity-summary-row">
                    <td colSpan={2}><strong>Suma</strong></td>
                    {PROD_CATEGORIES.map((cat) => (
                      <td key={cat} style={{ textAlign: 'center' }}>
                        <strong>
                          {rows.reduce((s, r) => s + r.byCategory[cat], 0) || '—'}
                        </strong>
                      </td>
                    ))}
                    <td style={{ textAlign: 'center' }}>
                      <strong className="productivity-total">{totalCompletions}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
