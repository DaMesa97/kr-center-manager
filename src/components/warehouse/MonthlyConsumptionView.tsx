import { useMemo, useState } from 'react'
import type { MonthlyConsumptionPivot } from '../../types'
import Spinner from '../Spinner'
import DataTable, { type DataTableColumn } from '../DataTable'

type MonthlyConsumptionViewProps = {
  data: MonthlyConsumptionPivot[]
  months: string[]
  loading: boolean
  onRefresh: () => void
  onRangeChange: (months: number) => void
  currentMonths: number
}

function formatMonthHeader(ym: string): string {
  const d = new Date(`${ym}-01T12:00:00`)
  if (Number.isNaN(d.getTime())) return ym
  const s = new Intl.DateTimeFormat('pl-PL', { month: 'short', year: 'numeric' }).format(d)
  return s.length > 0 ? s.charAt(0).toLocaleUpperCase('pl-PL') + s.slice(1) : s
}

function formatQty(n: number): string {
  if (!Number.isFinite(n) || n === 0) return ''
  if (Number.isInteger(n)) return String(n)
  return n.toLocaleString('pl-PL', { maximumFractionDigits: 2 })
}

export default function MonthlyConsumptionView({
  data,
  months,
  loading,
  onRefresh,
  onRangeChange,
  currentMonths,
}: MonthlyConsumptionViewProps) {
  const [categoryFilter, setCategoryFilter] = useState('')
  const [search, setSearch] = useState('')

  const categoryOptions = useMemo(() => {
    const set = new Set<string>()
    for (const row of data) {
      const c = row.component_category?.trim()
      if (c) set.add(c)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pl'))
  }, [data])

  const rowsSortedFiltered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = data
    if (categoryFilter) {
      list = list.filter((r) => (r.component_category ?? '') === categoryFilter)
    }
    if (q) {
      list = list.filter(
        (r) =>
          r.component_code.toLowerCase().includes(q) || r.component_name.toLowerCase().includes(q),
      )
    }
    return [...list].sort((a, b) => {
      const ca = (a.component_category ?? '').localeCompare(b.component_category ?? '', 'pl')
      if (ca !== 0) return ca
      return a.component_code.localeCompare(b.component_code, 'pl')
    })
  }, [data, categoryFilter, search])

  // kolumny miesięcy budowane dynamicznie z zakresu
  const columns = useMemo<DataTableColumn<MonthlyConsumptionPivot>[]>(() => {
    const monthValue = (row: MonthlyConsumptionPivot, ym: string): number | null => {
      const v = row.byMonth[ym]
      const num = v != null ? Number(v) : NaN
      return !Number.isFinite(num) || num === 0 ? null : num
    }
    return [
      {
        key: 'component',
        label: 'Komponent',
        sortValue: (row) => row.component_code,
        render: (row) => (
          <>
            {row.component_code} — {row.component_name} ({row.component_unit})
            {row.component_category ? (
              <span className="monthly-consumption-category"> · {row.component_category}</span>
            ) : null}
          </>
        ),
      },
      ...months.map(
        (ym): DataTableColumn<MonthlyConsumptionPivot> => ({
          key: `m-${ym}`,
          label: formatMonthHeader(ym),
          sortValue: (row) => monthValue(row, ym),
          render: (row) => {
            const num = monthValue(row, ym)
            return (
              <span className={num == null ? 'monthly-consumption-value--empty' : ''}>
                {num == null ? '—' : <strong>{formatQty(num)}</strong>}
              </span>
            )
          },
        }),
      ),
      {
        key: 'total',
        label: 'SUMA',
        sortValue: (row) => row.total || null,
        render: (row) =>
          row.total !== 0 ? (
            <strong>{formatQty(row.total)}</strong>
          ) : (
            <span className="monthly-consumption-value--empty">—</span>
          ),
      },
      {
        key: 'average',
        label: 'ŚREDNIA',
        sortValue: (row) => row.average || null,
        render: (row) =>
          row.average !== 0 ? (
            <strong>{row.average.toLocaleString('pl-PL', { maximumFractionDigits: 2 })}</strong>
          ) : (
            <span className="monthly-consumption-value--empty">—</span>
          ),
      },
    ]
  }, [months])

  return (
    <div className="monthly-consumption-view">
      <div className="monthly-consumption-toolbar">
        <label className="monthly-consumption-toolbar-field">
          <span className="monthly-consumption-toolbar-label">Zakres</span>
          <select
            className="day-filter"
            value={String(currentMonths)}
            onChange={(e) => onRangeChange(Number(e.target.value))}
            disabled={loading}
          >
            <option value="3">3 mies.</option>
            <option value="6">6 mies.</option>
            <option value="12">12 mies.</option>
            <option value="24">24 mies.</option>
          </select>
        </label>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => onRefresh()} disabled={loading}>
          Odśwież
        </button>
        <label className="monthly-consumption-toolbar-field monthly-consumption-toolbar-field--grow">
          <span className="monthly-consumption-toolbar-label">Kategoria</span>
          <select
            className="day-filter"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            disabled={loading}
          >
            <option value="">Wszystkie</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="monthly-consumption-toolbar-field monthly-consumption-toolbar-field--grow">
          <span className="monthly-consumption-toolbar-label">Szukaj</span>
          <input
            type="search"
            className="search-input"
            placeholder="Kod lub nazwa…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={loading}
          />
        </label>
      </div>

      <div className="monthly-consumption-wrapper">
        <DataTable
          rows={rowsSortedFiltered}
          rowKey={(row) => row.component_id}
          columns={columns}
          className="monthly-consumption-table"
          wrapped={false}
          loading={loading}
          loadingText={<Spinner center label="Ładowanie…" />}
          emptyText="Brak danych"
        />
      </div>
    </div>
  )
}
