// =====================================================================
// Statystyki → Konfigurator (zgłoszenie #145, Tymek 16.11.2026):
// ile % zleceń przychodzi z konfiguratora (orders.source = 'bot'), miesiąc po
// miesiącu, z linią celu 50% (koniec 2027). Dane z rpc konfigurator_udzial
// (migrate/statystyki_konfigurator_udzial.sql): miesiąc × kategoria × (razem, z konfiguratora).
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { supabase } from '../../supabaseClient'
import { fetchAllPages } from '../../lib/fetchPaged'
import { CATEGORY_LABELS } from '../../constants'
import { KONFIGURATOR_POZA } from '../../lib/companyStats'
import Spinner from '../Spinner'
import DataTable, { type DataTableColumn } from '../DataTable'

/** Cel firmy: połowa zleceń z konfiguratora do końca 2027 */
export const KONFIGURATOR_CEL_PROC = 50


type Row = { r_month: string; r_category: string; r_total: number; r_konfigurator: number }

type MonthPoint = { ym: string; label: string; total: number; bot: number; procent: number | null } & Record<string, unknown>

type CategoryRow = { category: string; total: number; bot: number; procent: number | null }

const CAT_COLORS: Record<string, string> = {
  STA: '#005faf', Disting: '#4f46e5', ST: '#1d6d45', Techniczne: '#854d0e', Bastion: '#b3261e', DrzwiWewnetrzne: '#0369a1', Aluminium: '#475569', // D51: ten sam odcień co w reszcie programu
}

const pct = (bot: number, total: number): number | null => (total > 0 ? Math.round((bot / total) * 1000) / 10 : null)
const fmtPct = (v: number | null): string => (v == null ? '—' : `${v.toLocaleString('pl-PL', { maximumFractionDigits: 1 })}%`)

function monthLabel(ym: string): string {
  const d = new Date(`${ym}-01T12:00:00`)
  if (Number.isNaN(d.getTime())) return ym
  const s = new Intl.DateTimeFormat('pl-PL', { month: 'short', year: '2-digit' }).format(d)
  return s.charAt(0).toLocaleUpperCase('pl-PL') + s.slice(1)
}

const catLabel = (c: string): string => (CATEGORY_LABELS as Record<string, string>)[c] ?? c

export default function ConfiguratorShareView() {
  const [months, setMonths] = useState(12)
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [showCategories, setShowCategories] = useState(false)

  const load = useCallback(async (m: number) => {
    setLoading(true)
    const { data, error } = await fetchAllPages<Record<string, unknown>>((from, to) =>
      supabase.rpc('konfigurator_udzial', { p_months: m }).order('r_month').order('r_category').range(from, to),
    )
    setLoading(false)
    if (error) {
      console.error('[Konfigurator]', error)
      setRows([])
      return
    }
    setRows(
      (data ?? [])
        .filter((r) => !(KONFIGURATOR_POZA as readonly string[]).includes(String(r.r_category ?? '')))
        .map((r) => ({
        r_month: String(r.r_month ?? '').slice(0, 7),
        r_category: String(r.r_category ?? ''),
        r_total: Number(r.r_total) || 0,
        r_konfigurator: Number(r.r_konfigurator) || 0,
        })),
    )
  }, [])

  useEffect(() => {
    void load(months)
  }, [months, load])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.r_category) set.add(r.r_category)
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pl'))
  }, [rows])

  // oś czasu = pełny zakres miesięcy (także puste), żeby wykres nie skakał
  const points = useMemo<MonthPoint[]>(() => {
    const now = new Date()
    const list: MonthPoint[] = []
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const p: MonthPoint = { ym, label: monthLabel(ym), total: 0, bot: 0, procent: null }
      for (const c of categories) {
        p[`t_${c}`] = 0
        p[`b_${c}`] = 0
      }
      list.push(p)
    }
    const byYm = new Map(list.map((p) => [p.ym, p]))
    for (const r of rows) {
      const p = byYm.get(r.r_month)
      if (!p) continue
      p.total += r.r_total
      p.bot += r.r_konfigurator
      p[`t_${r.r_category}`] = Number(p[`t_${r.r_category}`] ?? 0) + r.r_total
      p[`b_${r.r_category}`] = Number(p[`b_${r.r_category}`] ?? 0) + r.r_konfigurator
    }
    for (const p of list) {
      p.procent = pct(p.bot, p.total)
      for (const c of categories) p[`p_${c}`] = pct(Number(p[`b_${c}`]), Number(p[`t_${c}`]))
    }
    return list
  }, [rows, months, categories])

  const byCategory = useMemo<CategoryRow[]>(() => {
    const map = new Map<string, CategoryRow>()
    for (const r of rows) {
      const cur = map.get(r.r_category) ?? { category: r.r_category, total: 0, bot: 0, procent: null }
      cur.total += r.r_total
      cur.bot += r.r_konfigurator
      map.set(r.r_category, cur)
    }
    return Array.from(map.values())
      .map((c) => ({ ...c, procent: pct(c.bot, c.total) }))
      .sort((a, b) => b.total - a.total)
  }, [rows])

  const totals = useMemo(() => {
    const total = byCategory.reduce((s, c) => s + c.total, 0)
    const bot = byCategory.reduce((s, c) => s + c.bot, 0)
    return { total, bot, procent: pct(bot, total) }
  }, [byCategory])

  const current = points[points.length - 1]
  const previous = points.length >= 2 ? points[points.length - 2] : undefined

  const columns = useMemo<DataTableColumn<CategoryRow>[]>(
    () => [
      { key: 'category', label: 'Kategoria', sortValue: (r) => catLabel(r.category), render: (r) => catLabel(r.category) },
      { key: 'total', label: 'Zleceń razem', align: 'right', sortValue: (r) => r.total, render: (r) => r.total.toLocaleString('pl-PL') },
      { key: 'bot', label: 'Z konfiguratora', align: 'right', sortValue: (r) => r.bot, render: (r) => r.bot.toLocaleString('pl-PL') },
      {
        key: 'procent',
        label: 'Udział',
        align: 'right',
        sortValue: (r) => r.procent,
        render: (r) => <strong style={{ color: (r.procent ?? 0) >= KONFIGURATOR_CEL_PROC ? '#1d6d45' : undefined }}>{fmtPct(r.procent)}</strong>,
      },
    ],
    [],
  )

  const kpiClass = (v: number | null): string => (v == null ? '' : v >= KONFIGURATOR_CEL_PROC ? ' konf-kpi--ok' : '')

  return (
    <div className="leadtime-view">
      <div className="leadtime-presets">
        {[6, 12, 24].map((m) => (
          <button key={m} type="button" className={`btn btn-sm ${months === m ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMonths(m)}>
            {m} mies.
          </button>
        ))}
        <label className="day-filter" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
          <input type="checkbox" checked={showCategories} onChange={(e) => setShowCategories(e.target.checked)} />
          <span>Linie per kategoria</span>
        </label>
        {!loading && (
          <span className="leadtime-total">
            Zleceń w okresie: <strong>{totals.total.toLocaleString('pl-PL')}</strong>, z konfiguratora <strong>{totals.bot.toLocaleString('pl-PL')}</strong> ({fmtPct(totals.procent)}). Bez anulowanych, po dacie zamówienia; bez Technicznych i Drzwi wewnętrznych (nie idą z konfiguratora).
          </span>
        )}
      </div>

      {loading ? (
        <Spinner center label="Ładowanie danych…" />
      ) : rows.length === 0 ? (
        <p className="no-results">Brak zleceń w wybranym okresie.</p>
      ) : (
        <>
          <div className="konf-kpis">
            <div className={`konf-kpi${kpiClass(current?.procent ?? null)}`}>
              <div className="konf-kpi__label">Bieżący miesiąc ({current?.label})</div>
              <div className="konf-kpi__value">{fmtPct(current?.procent ?? null)}</div>
              <div className="konf-kpi__sub">{current?.bot ?? 0} z {current?.total ?? 0} zleceń</div>
            </div>
            <div className={`konf-kpi${kpiClass(previous?.procent ?? null)}`}>
              <div className="konf-kpi__label">Poprzedni miesiąc ({previous?.label ?? '—'})</div>
              <div className="konf-kpi__value">{fmtPct(previous?.procent ?? null)}</div>
              <div className="konf-kpi__sub">{previous?.bot ?? 0} z {previous?.total ?? 0} zleceń</div>
            </div>
            <div className={`konf-kpi${kpiClass(totals.procent)}`}>
              <div className="konf-kpi__label">Cały okres ({months} mies.)</div>
              <div className="konf-kpi__value">{fmtPct(totals.procent)}</div>
              <div className="konf-kpi__sub">{totals.bot} z {totals.total} zleceń</div>
            </div>
            <div className="konf-kpi konf-kpi--target">
              <div className="konf-kpi__label">Cel na koniec 2027</div>
              <div className="konf-kpi__value">{KONFIGURATOR_CEL_PROC}%</div>
              <div className="konf-kpi__sub">
                {current?.procent == null ? '—' : current.procent >= KONFIGURATOR_CEL_PROC ? 'osiągnięty w tym miesiącu' : `brakuje ${(KONFIGURATOR_CEL_PROC - current.procent).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} pkt proc.`}
              </div>
            </div>
          </div>

          <div className="leadtime-section">
            <h3 className="leadtime-section-title">Udział zleceń z konfiguratora miesiąc po miesiącu (%)</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={points} margin={{ top: 8, right: 24, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" width={44} />
                <Tooltip
                  formatter={(value: unknown, name: unknown) => [fmtPct(value == null || value === '' || Array.isArray(value) ? null : Number(value)), String(name)]}
                  labelFormatter={(label) => {
                    const p = points.find((x) => x.label === label)
                    return p ? `${label} · ${p.bot} z ${p.total} zleceń` : String(label)
                  }}
                />
                <Legend />
                <ReferenceLine y={KONFIGURATOR_CEL_PROC} stroke="#b3261e" strokeDasharray="6 4" label={{ value: `cel ${KONFIGURATOR_CEL_PROC}%`, position: 'insideTopRight', fill: '#b3261e', fontSize: 12 }} />
                <Line type="monotone" dataKey="procent" name="Wszystkie kategorie" stroke="#005faf" strokeWidth={3} dot={{ r: 3 }} connectNulls />
                {showCategories &&
                  categories.map((c) => (
                    <Line key={c} type="monotone" dataKey={`p_${c}`} name={catLabel(c)} stroke={CAT_COLORS[c] ?? '#94a3b8'} strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />
                  ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="leadtime-section">
            <h3 className="leadtime-section-title">Wg kategorii, cały okres</h3>
            <DataTable rows={byCategory} rowKey={(r) => r.category} columns={columns} wrapped={false} emptyText="Brak danych" />
          </div>
        </>
      )}
    </div>
  )
}
