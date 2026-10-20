import { useCallback, useMemo, useState } from 'react'
import type { IncomingStockRow, Supplier, ToastVariant, Warehouse, WarehouseComponent, WarehouseStockRow } from '../../types'
import DamageReportModal from '../DamageReportModal'
import Spinner from '../Spinner'
import DataTable, { type DataTableColumn } from '../DataTable'
import StockAtDateExport from './StockAtDateExport'
import type { SortState } from '../../lib/tableSort'

// ranga statusu do sortowania: minus (najgorszy) → niski → OK
const statusRank = (s: StockStatus): number => (s === 'minus' ? 0 : s === 'low' ? 1 : 2)

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
  reserved: number
}

// 'YYYY-MM-DD' → 'DD.MM.RRRR'
function formatDatePl(d: string | null | undefined): string {
  if (!d) return ''
  const [y, m, day] = d.split('-')
  return y && m && day ? `${day}.${m}.${y}` : d
}

const orDash = (v: string | null | undefined) => (v?.trim() ? v : '—')

// DOSTĘPNE = fizyczne − zarezerwowane (ujemne = nadrezerwacja, sygnał planistyczny)
const renderAvailableCell = (available: number) => (
  <strong style={available < 0 ? { color: '#c62828' } : undefined}>{available}</strong>
)

const renderIncomingCell = (inc: IncomingStockRow | undefined) => {
  if (!inc || inc.incoming_qty <= 0) return <span>—</span>
  const tooltip = [
    `Najbliższa dostawa: ${formatDatePl(inc.earliest_eta) || 'brak daty'}`,
    inc.latest_eta && inc.latest_eta !== inc.earliest_eta
      ? `Ostatnia: ${formatDatePl(inc.latest_eta)}`
      : '',
    `Otwarte ZD: ${inc.open_pos}`,
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <span title={tooltip} style={{ cursor: 'help', textDecoration: 'underline dotted' }}>
      {inc.incoming_qty}
    </span>
  )
}

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

type StockViewProps = {
  warehouses: Warehouse[]
  components: WarehouseComponent[]
  stock: WarehouseStockRow[]
  suppliers?: Supplier[]
  incoming?: IncomingStockRow[]
  loading: boolean
  isManager?: boolean
  onAddPz?: (warehouseId?: number) => void
  onShowHistory: (component: WarehouseComponent) => void
  pushToast?: (msg: string, variant: ToastVariant) => void
  onStockChanged?: () => void
}

function StockView({ warehouses, components, stock, suppliers = [], incoming = [], loading, isManager, onAddPz, onShowHistory, pushToast, onStockChanged }: StockViewProps) {
  const [damageTarget, setDamageTarget] = useState<{ componentId: number; warehouseId: number | null } | null>(null)
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | ''>('')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [supplierFilter, setSupplierFilter] = useState<number | ''>('')
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

  const incomingByComponent = useMemo(() => {
    const m = new Map<number, IncomingStockRow>()
    incoming.forEach((r) => m.set(r.component_id, r))
    return m
  }, [incoming])

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
      if (supplierFilter !== '' && componentById.get(row.component_id)?.supplier_id !== supplierFilter) return false
      if (problemsOnly) {
        const s = stockStatus(row)
        if (s === 'ok') return false
      }
      if (!q) return true
      const code = (row.component_code ?? '').toLowerCase()
      const name = (row.component_name ?? '').toLowerCase()
      return code.includes(q) || name.includes(q)
    })
  }, [sortedRows, selectedWarehouseId, categoryFilter, search, problemsOnly, matchCategory, supplierFilter, componentById])

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
        reserved: number
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
          reserved: 0,
        } as {
          component_code: string
          component_name: string
          component_category: string | null
          component_unit: string
          component_min_stock_level: number | null
          quantities: Record<number, number>
          reserved: number
        })
      const prev = existing.quantities[row.warehouse_id] ?? 0
      existing.quantities[row.warehouse_id] = prev + row.quantity
      existing.reserved += row.reserved_quantity ?? 0
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
      if (supplierFilter !== '' && componentById.get(row.component_id)?.supplier_id !== supplierFilter) return false
      if (problemsOnly) {
        const s = stockStatusAggregated(row.total, row.component_min_stock_level)
        if (s === 'ok') return false
      }
      if (!q) return true
      const code = (row.component_code ?? '').toLowerCase()
      const name = (row.component_name ?? '').toLowerCase()
      return code.includes(q) || name.includes(q)
    })
  }, [aggregatedRows, search, problemsOnly, matchCategory, supplierFilter, componentById])

  // Sortowanie po kliknięciu nagłówka (wspólny stan dla obu wariantów tabeli)
  const [sort, setSort] = useState<SortState>(null)

  const incQtyOf = useCallback(
    (componentId: number) => incomingByComponent.get(componentId)?.incoming_qty ?? 0,
    [incomingByComponent],
  )

  const renderActions = useCallback(
    (componentId: number, warehouseId: number | null) => (
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => {
            const component = componentById.get(componentId)
            if (component) onShowHistory(component)
          }}
        >
          Historia
        </button>
        {isManager && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            title="Zgłoś zniszczenie (drugi gatunek) — zdejmie z magazynu"
            onClick={() => setDamageTarget({ componentId, warehouseId })}
          >
            ⚠️
          </button>
        )}
      </div>
    ),
    [componentById, onShowHistory, isManager],
  )

  const aggregatedColumns = useMemo((): DataTableColumn<AggregatedRow>[] => [
    { key: 'code', label: 'KOD', stackUnder: 'name', sortValue: (r) => r.component_code, render: (r) => orDash(r.component_code) },
    { key: 'name', label: 'NAZWA', sortValue: (r) => r.component_name, render: (r) => orDash(r.component_name) },
    { key: 'category', label: 'KATEGORIA', stackUnder: 'name', sortValue: (r) => r.component_category, render: (r) => orDash(r.component_category) },
    { key: 'unit', label: 'JEDNOSTKA', stackUnder: 'total', sortValue: (r) => r.component_unit, render: (r) => orDash(r.component_unit) },
    ...warehousesSorted.map(
      (w): DataTableColumn<AggregatedRow> => ({
        key: `wh_${w.id}`,
        label: w.code,
        sortValue: (r) => r.quantities[w.id] ?? 0,
        render: (r) => r.quantities[w.id] ?? 0,
      }),
    ),
    { key: 'total', label: 'FIZYCZNE', sortValue: (r) => r.total, render: (r) => r.total },
    { key: 'reserved', label: 'ZAREZERW.', stackUnder: 'total', sortValue: (r) => r.reserved, render: (r) => r.reserved || '—' },
    {
      key: 'available',
      label: 'DOSTĘPNE',
      sortValue: (r) => r.total - r.reserved,
      render: (r) => renderAvailableCell(r.total - r.reserved),
    },
    {
      key: 'incoming',
      label: 'W DRODZE',
      sortValue: (r) => incQtyOf(r.component_id),
      render: (r) => renderIncomingCell(incomingByComponent.get(r.component_id)),
    },
    {
      key: 'projected',
      label: 'PROGNOZA',
      stackUnder: 'incoming',
      sortValue: (r) => r.total - r.reserved + incQtyOf(r.component_id),
      render: (r) => r.total - r.reserved + incQtyOf(r.component_id),
    },
    {
      key: 'min',
      label: 'MIN. STAN',
      stackUnder: 'status',
      sortValue: (r) => r.component_min_stock_level,
      render: (r) => (r.component_min_stock_level != null ? r.component_min_stock_level : '—'),
    },
    {
      key: 'status',
      label: 'STATUS',
      sortValue: (r) => statusRank(stockStatusAggregated(r.total, r.component_min_stock_level)),
      render: (r) => renderStatusCell(stockStatusAggregated(r.total, r.component_min_stock_level)),
    },
    { key: 'actions', label: 'AKCJE', render: (r) => renderActions(r.component_id, null) },
  ], [warehousesSorted, incomingByComponent, incQtyOf, renderActions])

  const rowColumns = useMemo((): DataTableColumn<WarehouseStockRow>[] => [
    { key: 'code', label: 'KOD', stackUnder: 'name', sortValue: (r) => r.component_code, render: (r) => orDash(r.component_code) },
    { key: 'name', label: 'NAZWA', sortValue: (r) => r.component_name, render: (r) => orDash(r.component_name) },
    { key: 'category', label: 'KATEGORIA', stackUnder: 'name', sortValue: (r) => r.component_category, render: (r) => orDash(r.component_category) },
    { key: 'unit', label: 'JEDNOSTKA', stackUnder: 'qty', sortValue: (r) => r.component_unit, render: (r) => orDash(r.component_unit) },
    { key: 'warehouse', label: 'MAGAZYN', sortValue: (r) => r.warehouse_code, render: (r) => orDash(r.warehouse_code) },
    { key: 'qty', label: 'FIZYCZNE', sortValue: (r) => r.quantity, render: (r) => r.quantity },
    { key: 'reserved', label: 'ZAREZERW.', stackUnder: 'qty', sortValue: (r) => r.reserved_quantity ?? 0, render: (r) => r.reserved_quantity || '—' },
    {
      key: 'available',
      label: 'DOSTĘPNE',
      sortValue: (r) => r.available_quantity ?? r.quantity,
      render: (r) => renderAvailableCell(r.available_quantity ?? r.quantity),
    },
    {
      key: 'incoming',
      label: 'W DRODZE',
      sortValue: (r) => incQtyOf(r.component_id),
      render: (r) => renderIncomingCell(incomingByComponent.get(r.component_id)),
    },
    {
      key: 'projected',
      label: 'PROGNOZA',
      stackUnder: 'incoming',
      sortValue: (r) => (r.available_quantity ?? r.quantity) + incQtyOf(r.component_id),
      render: (r) => (r.available_quantity ?? r.quantity) + incQtyOf(r.component_id),
    },
    {
      key: 'min',
      label: 'MIN. STAN',
      stackUnder: 'status',
      sortValue: (r) => r.component_min_stock_level,
      render: (r) => (r.component_min_stock_level != null ? r.component_min_stock_level : '—'),
    },
    {
      key: 'status',
      label: 'STATUS',
      sortValue: (r) => statusRank(stockStatus(r)),
      render: (r) => renderStatusCell(stockStatus(r)),
    },
    { key: 'actions', label: 'AKCJE', render: (r) => renderActions(r.component_id, r.warehouse_id) },
  ], [incomingByComponent, incQtyOf, renderActions])

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
        <label className="day-filter" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span>Dostawca</span>
          <select
            className="day-filter"
            value={supplierFilter === '' ? '' : String(supplierFilter)}
            onChange={(e) => setSupplierFilter(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">Wszyscy</option>
            {[...suppliers].sort((a, b) => a.name.localeCompare(b.name, 'pl')).map((s) => (
              <option key={s.id} value={String(s.id)}>{s.name}</option>
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
        <StockAtDateExport warehouses={warehouses} warehouseId={selectedWarehouseId} pushToast={pushToast} />
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
        <DataTable
          rows={filteredAggregatedRows}
          rowKey={(r) => r.component_id}
          columns={aggregatedColumns}
          sort={sort}
          onSortChange={setSort}
          emptyText="Brak wierszy spełniających kryteria."
        />
      ) : (
        <DataTable
          rows={filteredRows}
          rowKey={(r) => r.id}
          columns={rowColumns}
          sort={sort}
          onSortChange={setSort}
          emptyText="Brak wierszy spełniających kryteria."
        />
      )}

      {pushToast && (
        <DamageReportModal
          open={damageTarget !== null}
          onClose={() => setDamageTarget(null)}
          pushToast={pushToast}
          onReported={onStockChanged}
          defaultComponentId={damageTarget?.componentId ?? null}
          defaultWarehouseId={damageTarget?.warehouseId ?? null}
        />
      )}
    </>
  )
}

export default StockView
