import { useCallback, useEffect, useMemo, useState } from 'react'
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
import DataTable, { type DataTableColumn } from '../DataTable'
import { fetchAllPages } from '../../lib/fetchPaged'
import { localDateStr, localDayEndExclusiveIso, localDayStartIso, localMonday } from '../../lib/localDates'

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

/** Wartości (inicjały) etapów, które w tym zapisie zmieniły się z pustych na wypełnione */
function newCompletions(
  oldStages: Record<string, string>,
  newStages: Record<string, string>,
): string[] {
  const out: string[] = []
  for (const key of Object.keys(newStages)) {
    // Mirrory par (dist_*/sta_*) to KOPIA pracy zrobionej u partnera — ich
    // zapis to osobny wpis audytu i każdy etap zlecenia łączonego liczył się 2×
    if (key.startsWith('dist_') || key.startsWith('sta_')) continue
    const wasEmpty = !oldStages[key] || String(oldStages[key]).trim() === ''
    const value = newStages[key] ? String(newStages[key]).trim() : ''
    if (wasEmpty && value !== '') out.push(value)
  }
  return out
}

const normInitials = (s: string) => s.trim().toUpperCase()

// ---------------------------------------------------------------------------
// Preset helpers
// ---------------------------------------------------------------------------

type Preset = 'week' | 'month' | 'lastMonth' | 'custom'

function presetDates(preset: Preset): { from: string; to: string } {
  const now = new Date()
  if (preset === 'week') {
    return { from: localDateStr(localMonday(now)), to: localDateStr(now) }
  }
  if (preset === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: localDateStr(from), to: localDateStr(now) }
  }
  if (preset === 'lastMonth') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const to = new Date(now.getFullYear(), now.getMonth(), 0)
    return { from: localDateStr(from), to: localDateStr(to) }
  }
  return { from: localDateStr(localMonday(now)), to: localDateStr(now) }
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
      // 1. Wpisy audit_log ze zmianą production_stages — tylko zapisy ludzi
      // (user_id NULL = triggery/mirrory/Edge Functions; 1000 najnowszych to
      // były niemal same systemowe i ranking wychodził pusty). Porcjami po 1000,
      // tylko potrzebne fragmenty JSON-a zamiast całych wierszy zamówień.
      // Granice dnia liczone lokalnie (Europe/Warsaw) → ISO UTC.
      type AuditEntry = {
        user_id: string | null
        user_email: string | null
        old_stages: unknown
        new_stages: unknown
        category: string | null
      }
      const { data: auditData, error: auditError } = await fetchAllPages<AuditEntry>((rFrom, rTo) =>
        supabase
          .from('audit_log')
          .select('id, user_id, user_email, old_stages:old_data->production_stages, new_stages:new_data->production_stages, category:new_data->>category')
          .eq('table_name', 'orders')
          .eq('operation', 'UPDATE')
          .not('user_id', 'is', null)
          .contains('changed_fields', ['production_stages'])
          .gte('created_at', localDayStartIso(from))
          .lt('created_at', localDayEndExclusiveIso(to))
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(rFrom, rTo)
          .overrideTypes<AuditEntry[], { merge: false }>(),
      )

      if (auditError) {
        console.error('[Productivity] audit_log error:', auditError)
        setRows([])
        return
      }

      // 2. Pobierz profile użytkowników (dla imion i inicjałów)
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, full_name, initials, role')

      type Profile = { id: string; name: string; initials: string }
      const profilesMap = new Map<string, Profile>()
      const byInitials = new Map<string, Profile | null>() // null = inicjały niejednoznaczne
      for (const p of (profilesData ?? []) as Array<{
        id: string; full_name?: string | null; initials?: string | null; role?: string | null
      }>) {
        const prof: Profile = { id: p.id, name: p.full_name ?? '', initials: p.initials ?? '' }
        profilesMap.set(p.id, prof)
        const ini = normInitials(prof.initials)
        if (ini) byInitials.set(ini, byInitials.has(ini) ? null : prof)
      }

      // 3. Agregacja — pracę przypisujemy po INICJAŁACH wpisanych w etap
      // (jeden wspólny komputer na stanowisku, kilka osób), a dopiero gdy
      // wartość nie pasuje do żadnego profilu — po koncie, które zapisało.
      const aggregated = new Map<string, Omit<WorkerRow, 'total'>>()
      const workerFor = (id: string, email: string): Omit<WorkerRow, 'total'> => {
        let row = aggregated.get(id)
        if (!row) {
          const profile = profilesMap.get(id)
          row = {
            userId: id,
            email,
            name: profile?.name || email || id,
            initials: profile?.initials || '??',
            byCategory: { STA: 0, Disting: 0, ST: 0, Techniczne: 0, Bastion: 0, DrzwiWewnetrzne: 0 },
          }
          aggregated.set(id, row)
        }
        return row
      }

      for (const entry of auditData) {
        if (!entry.user_id) continue

        const category = String(entry.category ?? '')
        if (!PROD_CATEGORIES.includes(category as ProdCategory)) continue

        const values = newCompletions(parseStages(entry.old_stages), parseStages(entry.new_stages))
        for (const value of values) {
          const byIni = byInitials.get(normInitials(value))
          const worker = byIni
            ? workerFor(byIni.id, '')
            : workerFor(entry.user_id, entry.user_email ?? '')
          worker.byCategory[category as ProdCategory] += 1
        }
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

  // Miejsce w rankingu = pozycja wg sumy (nie zmienia się przy sortowaniu kolumną)
  const columns = useMemo<DataTableColumn<WorkerRow>[]>(() => {
    const rank = new Map(rows.map((r, i) => [r.userId, i + 1]))
    return [
      {
        key: 'name',
        label: 'Pracownik',
        sortValue: (r) => r.name,
        render: (r) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="productivity-rank">{rank.get(r.userId)}</span>
            <span>{r.name}</span>
          </div>
        ),
      },
      {
        key: 'initials',
        label: 'Inicjały',
        align: 'center',
        sortValue: (r) => r.initials,
        render: (r) => <span className="productivity-initials">{r.initials}</span>,
      },
      ...PROD_CATEGORIES.map(
        (cat): DataTableColumn<WorkerRow> => ({
          key: cat,
          label: (
            <span className="productivity-cat-badge" style={{ background: CAT_COLORS[cat] }}>
              {cat === 'DrzwiWewnetrzne' ? 'Wewn.' : cat}
            </span>
          ),
          title: `Sortuj po: ${cat}`,
          align: 'center',
          sortValue: (r) => r.byCategory[cat],
          render: (r) =>
            r.byCategory[cat] > 0 ? (
              <span className="productivity-count">{r.byCategory[cat]}</span>
            ) : (
              <span style={{ color: '#cbd5e1' }}>—</span>
            ),
        }),
      ),
      {
        key: 'total',
        label: <strong>Razem</strong>,
        title: 'Sortuj po: Razem',
        align: 'center',
        sortValue: (r) => r.total,
        render: (r) => <strong className="productivity-total">{r.total}</strong>,
      },
    ]
  }, [rows])

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
        <div
          className="productivity-range-info"
          title="Etap liczony osobie, której inicjały wpisano w etap; gdy inicjały nie pasują do żadnego profilu — kontu, z którego zapisano. Zapisy systemowe i lustrzane etapy par pominięte."
        >
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
            <DataTable
              rows={rows}
              rowKey={(r) => r.userId}
              columns={columns}
              className="productivity-table"
              footer={
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
              }
            />
          </div>
        </>
      )}
    </div>
  )
}
