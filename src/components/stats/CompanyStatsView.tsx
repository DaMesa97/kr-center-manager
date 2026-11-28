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
  companyKey,
  companyNames,
  computeCompanyStats,
  dataWydaniaSzacunkowa,
  daysBetween,
  resolveCompanyGroups,
  suspectedCompanyClusters,
  type CompanyAliases,
  type CompanyPeriodMonths,
  type SuspectedCluster,
} from '../../lib/companyStats'
import type { CompanyAliasRow } from '../../hooks/useCompanyAliases'
import Spinner from '../Spinner'
import DataTable, { type DataTableColumn } from '../DataTable'

// Statystyki → Firmy (#118, Tymek 6.11): jedna firma pod lupą — ile zamawia,
// ile reklamuje, jak szybko dostaje, co zamawia. Liczone z danych w pamięci.
// 20.11: warianty pisowni liczone razem (companyKey + aliasy), panel „Porządek nazw firm”,
// rekordy łączone (Titan, Disting Plus) liczone raz.

type Props = {
  orders: Order[]
  complaints: Complaint[]
  loading: boolean
  aliases: CompanyAliases
  aliasRows: CompanyAliasRow[]
  isManager: boolean
  onMerge: (variants: string[], canonical: string) => Promise<string | null>
  onRemoveAlias: (id: number) => Promise<string | null>
}

const QUERY_KEY = 'stats.firma.query'
const PERIOD_KEY = 'stats.firma.okres'
const CLUSTER_PAGE = 25

function readStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

const SOURCE_LABEL: Record<string, string> = {
  bot: 'konfigurator',
  excel: 'Excel',
  manual: 'ręcznie',
  api: 'API',
  migracja: 'migracja',
}

const chipStyle = { display: 'inline-block', background: '#f3f4f6', borderRadius: 999, padding: '2px 10px', margin: '2px 4px 2px 0', fontSize: 13 } as const

const recentColumns: DataTableColumn<Order>[] = [
  { key: 'nr', label: 'Nr', sortValue: (o) => Number(o.order_number) || o.order_number, render: (o) => <b>{o.order_number}</b> },
  { key: 'cat', label: 'Kategoria', sortValue: (o) => o.category, render: (o) => o.category },
  { key: 'company', label: 'Firma (jak w zleceniu)', sortValue: (o) => o.company, render: (o) => o.company || '—' },
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
    sortValue: (o) => (isReleaseDateEmpty(o.release_date) || !o.order_date || dataWydaniaSzacunkowa(o) ? -1 : daysBetween(o.order_date, String(o.release_date)) ?? -1),
    render: (o) => {
      if (isReleaseDateEmpty(o.release_date) || !o.order_date) return '—'
      if (dataWydaniaSzacunkowa(o)) return <span title="Data wydania z dnia synchronizacji Excela (sam znacznik „X”) — nie liczona do czasu realizacji">?</span>
      const d = daysBetween(o.order_date, String(o.release_date))
      return d == null ? '—' : d
    },
  },
  { key: 'source', label: 'Źródło', sortValue: (o) => o.source ?? '', render: (o) => SOURCE_LABEL[String(o.source ?? '')] ?? '—' },
]

export default function CompanyStatsView({ orders, complaints, loading, aliases, aliasRows, isManager, onMerge, onRemoveAlias }: Props) {
  const [query, setQuery] = useState(() => readStored(QUERY_KEY, ''))
  const [months, setMonths] = useState<CompanyPeriodMonths>(() => {
    const v = Number(readStored(PERIOD_KEY, '12'))
    return ([0, 3, 6, 12, 24] as const).includes(v as CompanyPeriodMonths) ? (v as CompanyPeriodMonths) : 12
  })
  const [showNames, setShowNames] = useState(false)
  const [clusterLimit, setClusterLimit] = useState(CLUSTER_PAGE)
  const [pick, setPick] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(QUERY_KEY, query)
      localStorage.setItem(PERIOD_KEY, String(months))
    } catch {
      /* prywatne okno / zablokowane dane strony — bez pamiętania */
    }
  }, [query, months])

  const groups = useMemo(() => companyNames(orders, aliases), [orders, aliases])
  const matched = useMemo(() => resolveCompanyGroups(query, groups), [query, groups])
  const stats = useMemo(
    () => (matched.length ? computeCompanyStats(orders, complaints, matched.map((g) => g.name), months, new Date(), aliases) : null),
    [orders, complaints, matched, months, aliases],
  )
  const clusters = useMemo(() => suspectedCompanyClusters(groups), [groups])
  const aliasesByCanonical = useMemo(() => {
    const m = new Map<string, CompanyAliasRow[]>()
    for (const r of aliasRows) {
      const list = m.get(r.company_name)
      if (list) list.push(r)
      else m.set(r.company_name, [r])
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], 'pl'))
  }, [aliasRows])

  if (loading) {
    return <div className="stats-dashboard"><Spinner center label="Ładowanie…" /></div>
  }

  const qKey = companyKey(query)
  const exact = matched.length === 1 && (matched[0].key === qKey || matched[0].variants.some((v) => companyKey(v.name) === qKey))

  const mergeCluster = async (c: SuspectedCluster) => {
    const canonical = pick[c.stem] ?? c.groups[0].name
    const variants = c.groups.flatMap((g) => g.variants.map((v) => v.name))
    setBusy(c.stem)
    setMsg(null)
    const err = await onMerge(variants, canonical)
    setBusy(null)
    setMsg(err ? { text: `Nie udało się scalić: ${err}`, error: true } : { text: `Scalono pod „${canonical}”.`, error: false })
  }

  const removeAlias = async (r: CompanyAliasRow) => {
    setBusy(`alias-${r.id}`)
    setMsg(null)
    const err = await onRemoveAlias(r.id)
    setBusy(null)
    setMsg(err ? { text: `Nie udało się rozdzielić: ${err}`, error: true } : { text: `„${r.alias_name}” znów liczone osobno.`, error: false })
  }

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
              {groups.map((g) => (
                <option key={g.key} value={g.name}>{`${g.count} zleceń${g.variants.length > 1 ? ` · ${g.variants.length} pisownie` : ''}`}</option>
              ))}
            </datalist>
            {query.trim() && matched.length === 0 && <span style={{ color: '#b45309' }}>Brak firmy o takiej nazwie w zleceniach.</span>}
            {matched.length > 1 && (
              <span style={{ color: '#6b7280' }} title={matched.map((g) => g.name).join(', ')}>
                {matched.length} firm pasuje — liczone razem: {matched.slice(0, 4).map((g) => g.name).join(', ')}{matched.length > 4 ? '…' : ''}
              </span>
            )}
            {exact && matched[0].variants.length > 1 && (
              <span style={{ color: '#6b7280' }} title={matched[0].variants.map((v) => `${v.name} (${v.count})`).join(', ')}>
                {matched[0].variants.length} pisownie liczone razem
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
              <div className="stats-kpi" title="Titan (trójka STA+ST+Bastion) i Disting Plus (para Disting+STA) liczone raz">
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
                <div className="stats-kpi-value">{stats.configuratorEligible ? Math.round((stats.fromConfigurator / stats.configuratorEligible) * 100) : 0}%</div>
                <div className="stats-kpi-label" title="Bez Technicznych i Drzwi wewnętrznych — nie idą z konfiguratora">z konfiguratora</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="stats-grid-full">
        <div className="stats-card">
          <div className="stats-card-header">
            <h3>Porządek nazw firm</h3>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setShowNames((s) => !s)}>
              {showNames ? 'Zwiń' : `Pokaż (${clusters.length} podejrzanych, ${aliasRows.length} scaleń)`}
            </button>
          </div>
          {showNames && (
            <>
              <p style={{ color: '#6b7280', margin: '0 0 12px' }}>
                Różnice wielkości liter, ogonków, „#” i powtórzonego słowa sklejam sam. Niżej firmy o wspólnym początku nazwy — scal tylko te,
                które naprawdę są jedną firmą (BEL-POL Opole i BEL-POL Lubin to różne sklepy). Scalenie działa w statystykach i przy kolejnych
                zleceniach z konfiguratora (nazwa z aliasu zostaje podmieniona na docelową). Istniejących zleceń nie zmienia.
                {!isManager && ' Scalać może kierownik.'}
              </p>
              {msg && <p style={{ color: msg.error ? '#b91c1c' : '#047857', margin: '0 0 12px' }}>{msg.text}</p>}

              {aliasesByCanonical.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ margin: '0 0 6px' }}>Scalone</h4>
                  {aliasesByCanonical.map(([canonical, list]) => (
                    <div key={canonical} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '4px 0' }}>
                      <b style={{ minWidth: 180 }}>{canonical}</b>
                      <span>←</span>
                      {list.map((r) => (
                        <span key={r.id} style={chipStyle}>
                          {r.alias_name}
                          {isManager && (
                            <button
                              type="button"
                              className="btn-link"
                              style={{ marginLeft: 6 }}
                              disabled={busy === `alias-${r.id}`}
                              title="Rozdziel — licz tę pisownię osobno"
                              onClick={() => void removeAlias(r)}
                            >
                              ✕
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              <h4 style={{ margin: '0 0 6px' }}>Podejrzane warianty ({clusters.length})</h4>
              {clusters.length === 0 && <p style={{ color: '#6b7280' }}>Nic do scalenia.</p>}
              {clusters.slice(0, clusterLimit).map((c) => (
                <div key={c.stem} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderTop: '1px solid #eee' }}>
                  <span style={{ minWidth: 160, fontWeight: 600 }} title="wspólny początek nazwy">{c.stem}</span>
                  <span style={{ flex: 1, minWidth: 240 }}>
                    {c.groups.map((g) => (
                      <span key={g.key} style={chipStyle} title={g.variants.map((v) => `${v.name} (${v.count})`).join(', ')}>
                        {g.name} ({g.count})
                      </span>
                    ))}
                  </span>
                  {isManager && (
                    <>
                      <select
                        className="day-filter"
                        value={pick[c.stem] ?? c.groups[0].name}
                        onChange={(e) => setPick((p) => ({ ...p, [c.stem]: e.target.value }))}
                        aria-label={`Nazwa docelowa dla ${c.stem}`}
                      >
                        {c.groups.map((g) => (
                          <option key={g.key} value={g.name}>{g.name}</option>
                        ))}
                      </select>
                      <button type="button" className="btn btn-sm btn-primary" disabled={busy === c.stem} onClick={() => void mergeCluster(c)}>
                        Scal
                      </button>
                    </>
                  )}
                </div>
              ))}
              {clusters.length > clusterLimit && (
                <button type="button" className="btn btn-sm btn-secondary" style={{ marginTop: 8 }} onClick={() => setClusterLimit((n) => n + CLUSTER_PAGE)}>
                  Pokaż więcej ({clusters.length - clusterLimit})
                </button>
              )}
            </>
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
              <h3 title="Titan liczony pod Bastion, Disting Plus pod Disting">Kategorie (sztuki)</h3>
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
