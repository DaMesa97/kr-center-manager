import { useCallback, useMemo, useState } from 'react'
import type { Warehouse, WarehouseComponent, WarehouseStockRow } from '../../types'
import Spinner from '../Spinner'

type StockStatus = 'ok' | 'low' | 'minus'

function stockStatus(row: WarehouseStockRow): StockStatus {
  if (row.quantity < 0) return 'minus'
  const min = row.component_min_stock_level
  if (min == null) return 'ok'
  if (row.quantity >= min) return 'ok'
  return 'low'
}

function stockStatusAggregated(quantityTotal: number, min: number | null | undefined): StockStatus {
  if (quantityTotal < 0) return 'minus'
  if (min == null) return 'ok'
  if (quantityTotal >= min) return 'ok'
  return 'low'
}

function statusLabel(s: StockStatus): string {
  if (s === 'ok') return 'OK'
  if (s === 'low') return 'Niski'
  return 'Minus'
}

type AggregatedRow = {
  component_id: number
  component_code: string
  component_name: string
  component_category: string | null
  component_unit: string
  component_min_stock_level: number | null
  quantities: Record<number, number>
  total: number
}

type StockViewProps = {
  warehouses: Warehouse[]
  components: WarehouseComponent[]
  stock: WarehouseStockRow[]
  loading: boolean
  isManager?: boolean
  onAddPz?: (warehouseId?: number) => void
  onShowHistory: (component: WarehouseComponent) => void
}

function StockView({ warehouses, components, stock, loading, isManager, onAddPz, onShowHistory }: StockViewProps) {
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | ''>('')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [problemsOnly, setProblemsOnly] = useState(false)

  const matchCategory = useCallback((rowCategory: string | null | undefined) => {
    if (categoryFilter === '' || categoryFilter === 'all') return true
    const a = (rowCategory ?? '').trim().toLowerCase()
    const b = categoryFilter.trim().toLowerCase()
    return a === b
  }, [categoryFilter])

  const uniqueCategories = useMemo(() => {
    const set = new Set<string>()
    stock.forEach((r) => {
      if (r.component_category?.trim()) set.add(r.component_category.trim())
    })
    return Array.from(set).sort()
  }, [stock])

  const componentById = useMemo(() => {
    const m = new Map<number, WarehouseComponent>()
    components.forEach((c) => m.set(c.id, c))
    return m
  }, [components])

  const warehousesSorted = useMemo(
    () => [...warehouses].sort((a, b) => a.code.localeCompare(b.code)),
    [warehouses],
  )

  const rowsWithFallbacks = useMemo(() => {
    return stock.map((row) => {
      const comp = componentById.get(row.component_id)
      return {
        ...row,
        warehouse_code: row.warehouse_code ?? warehouses.find((w) => w.id === row.warehouse_id)?.code,
        component_code: row.component_code ?? comp?.code,
        component_name: row.component_name ?? comp?.name,
        component_unit: row.component_unit ?? comp?.unit,
        component_category:
          row.component_category !== undefined && row.component_category !== null
            ? row.component_category
            : (comp?.category ?? null),
        component_min_stock_level:
          row.component_min_stock_level !== undefined && row.component_min_stock_level !== null
            ? row.component_min_stock_level
            : (comp?.min_stock_level ?? null),
      } as WarehouseStockRow
    })
  }, [stock, componentById, warehouses])

  const sortedRows = useMemo(() => {
    return [...rowsWithFallbacks].sort((a, b) => {
      const wa = (a.warehouse_code ?? '').localeCompare(b.warehouse_code ?? '')
      if (wa !== 0) return wa
      return (a.component_code ?? '').localeCompare(b.component_code ?? '')
    })
  }, [rowsWithFallbacks])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return sortedRows.filter((row) => {
      if (selectedWarehouseId !== '' && row.warehouse_id !== selectedWarehouseId) return false
      if (!matchCategory(row.component_category)) return false
      if (problemsOnly) {
        const s = stockStatus(row)
        if (s === 'ok') return false
      }
      if (!q) return true
      const code = (row.component_code ?? '').toLowerCase()
      const name = (row.component_name ?? '').toLowerCase()
      return code.includes(q) || name.includes(q)
    })
  }, [sortedRows, selectedWarehouseId, categoryFilter, search, problemsOnly, matchCategory])

  const aggregatedRows = useMemo((): AggregatedRow[] | null => {
    if (selectedWarehouseId !== '') return null

    const byComponent = new Map<
      number,
      {
        component_code: string
        component_name: string
        component_category: string | null
        component_unit: string
        component_min_stock_level: number | null
        quantities: Record<number, number>
      }
    >()

    for (const row of rowsWithFallbacks) {
      const existing =
        byComponent.get(row.component_id) ??
        ({
          component_code: row.component_code ?? '',
          component_name: row.component_name ?? '',
          component_category: row.component_category?.trim() ? row.component_category.trim() : null,
          component_unit: row.component_unit ?? '',
          component_min_stock_level: row.component_min_stock_level ?? null,
          quantities: {},
        } as {
          component_code: string
          component_name: string
          component_category: string | null
          component_unit: string
          component_min_stock_level: number | null
          quantities: Record<number, number>
        })
      const prev = existing.quantities[row.warehouse_id] ?? 0
      existing.quantities[row.warehouse_id] = prev + row.quantity
      byComponent.set(row.component_id, existing)
    }

    return Array.from(byComponent.entries())
      .map(([component_id, data]) => {
        const total = warehousesSorted.reduce((sum, w) => sum + (data.quantities[w.id] ?? 0), 0)
        return {
          component_id,
          ...data,
          total,
        }
      })
      .sort((a, b) => (a.component_code ?? '').localeCompare(b.component_code ?? ''))
  }, [rowsWithFallbacks, selectedWarehouseId, warehousesSorted])

  const filteredAggregatedRows = useMemo(() => {
    if (aggregatedRows === null) return null
    const q = search.trim().toLowerCase()
    return aggregatedRows.filter((row) => {
      if (!matchCategory(row.component_category)) return false
      if (problemsOnly) {
        const s = stockStatusAggregated(row.total, row.component_min_stock_level)
        if (s === 'ok') return false
      }
      if (!q) return true
      const code = (row.component_code ?? '').toLowerCase()
      const name = (row.component_name ?? '').toLowerCase()
      return code.includes(q) || name.includes(q)
    })
  }, [aggregatedRows, search, problemsOnly, matchCategory])

  const renderStatusCell = (s: StockStatus) => {
    const dotColor = s === 'ok' ? '#2e7d32' : s === 'low' ? '#f9a825' : '#c62828'
    return (
      <span className="stock-status-cell" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span
          className="stock-status-dot"
          style={{ width: 10, height: 10, borderRadius: '50%', background: dotColor, flexShrink: 0 }}
          aria-hidden
        />
        {statusLabel(s)}
      </span>
    )
  }

  const isAllWarehouses = selectedWarehouseId === ''

  return (
    <>
      <div
        className="subtab-bar stock-view-warehouse-pills"
        role="tablist"
        aria-label="Magazyn — filtr"
        style={{ marginBottom: 10 }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={selectedWarehouseId === ''}
          className={`btn btn-sm ${selectedWarehouseId === '' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setSelectedWarehouseId('')}
        >
          Wszystkie
        </button>
        {warehouses.map((w) => (
          <button
            key={w.id}
            type="button"
            role="tab"
            aria-selected={selectedWarehouseId === w.id}
            className={`btn btn-sm ${selectedWarehouseId === w.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSelectedWarehouseId(w.id)}
          >
            {w.code}
          </button>
        ))}
      </div>

      <div className="orders-filters" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <label className="day-filter" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span>Magazyn</span>
          <select
            className="day-filter"
            value={selectedWarehouseId === '' ? '' : String(selectedWarehouseId)}
            onChange={(e) => {
              const v = e.target.value
              setSelectedWarehouseId(v === '' ? '' : Number(v))
            }}
          >
            <option value="">Wszystkie</option>
            {warehouses.map((w) => (
              <option key={w.id} value={String(w.id)}>
                {w.code}
              </option>
            ))}
          </select>
        </label>
        <label className="day-filter" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span>Kategoria</span>
          <select
            className="day-filter"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">Wszystkie</option>
            {uniqueCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <input
          type="text"
          className="search-input"
          placeholder="Szukaj po kodzie lub nazwie komponentu…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 220, flex: '1 1 200px' }}
        />
        <label className="day-filter" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={problemsOnly}
            onChange={(e) => setProblemsOnly(e.target.checked)}
          />
          <span>Tylko problemowe</span>
        </label>
        {isManager && onAddPz ? (
          <button
            type="button"
            className="btn btn-success"
            onClick={() => onAddPz(selectedWarehouseId === '' ? undefined : selectedWarehouseId)}
          >
            + Przyjmij dostawę
          </button>
        ) : null}
      </div>

      {loading ? (
        <Spinner center label="Ładowanie stanów…" />
      ) : isAllWarehouses && filteredAggregatedRows ? (
        <div className="table-wrapper">
          <table className="orders-table">
            <thead>
              <tr>
                <th>KOD</th>
                <th>NAZWA</th>
                <th>KATEGORIA</th>
                <th>JEDNOSTKA</th>
                {warehousesSorted.map((w) => (
                  <th key={w.id}>{w.code}</th>
                ))}
                <th>RAZEM</th>
                <th>MIN. STAN</th>
                <th>STATUS</th>
                <th>AKCJE</th>
              </tr>
            </thead>
            <tbody>
              {filteredAggregatedRows.map((row) => {
                const s = stockStatusAggregated(row.total, row.component_min_stock_level)
                return (
                  <tr key={row.component_id}>
                    <td>{row.component_code?.trim() ? row.component_code : '—'}</td>
                    <td>{row.component_name?.trim() ? row.component_name : '—'}</td>
                    <td>{row.component_category?.trim() ? row.component_category : '—'}</td>
                    <td>{row.component_unit?.trim() ? row.component_unit : '—'}</td>
                    {warehousesSorted.map((w) => (
                      <td key={w.id}>{row.quantities[w.id] ?? 0}</td>
                    ))}
                    <td>{row.total}</td>
                    <td>
                      {row.component_min_stock_level != null ? row.component_min_stock_level : '—'}
                    </td>
                    <td>{renderStatusCell(s)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => {
                          const component = componentById.get(row.component_id)
                          if (component) onShowHistory(component)
                        }}
                      >
                        Historia
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filteredAggregatedRows.length === 0 && (
            <p className="no-results">Brak wierszy spełniających kryteria.</p>
          )}
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="orders-table">
            <thead>
              <tr>
                <th>KOD</th>
                <th>NAZWA</th>
                <th>KATEGORIA</th>
                <th>JEDNOSTKA</th>
                <th>MAGAZYN</th>
                <th>ILOŚĆ</th>
                <th>MIN. STAN</th>
                <th>STATUS</th>
                <th>AKCJE</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const s = stockStatus(row)
                return (
                  <tr key={row.id}>
                    <td>{row.component_code?.trim() ? row.component_code : '—'}</td>
                    <td>{row.component_name?.trim() ? row.component_name : '—'}</td>
                    <td>{row.component_category?.trim() ? row.component_category : '—'}</td>
                    <td>{row.component_unit?.trim() ? row.component_unit : '—'}</td>
                    <td>{row.warehouse_code?.trim() ? row.warehouse_code : '—'}</td>
                    <td>{row.quantity}</td>
                    <td>
                      {row.component_min_stock_level != null ? row.component_min_stock_level : '—'}
                    </td>
                    <td>{renderStatusCell(s)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => {
                          const component = componentById.get(row.component_id)
                          if (component) onShowHistory(component)
                        }}
                      >
                        Historia
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filteredRows.length === 0 && <p className="no-results">Brak wierszy spełniających kryteria.</p>}
        </div>
      )}
    </>
  )
}

export default StockView
