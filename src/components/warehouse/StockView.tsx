import { useCallback, useMemo, useState } from 'react'
import type { IncomingStockRow, Supplier, ToastVariant, Warehouse, WarehouseComponent, WarehouseStockRow } from '../../types'
import DamageReportModal from '../DamageReportModal'
import Spinner from '../Spinner'
import SortableTh from '../SortableTh'
import { TopScrollTableWrapper } from '../TopScrollTableWrapper'
import { sortRows, toggleSort, type SortState } from '../../lib/tableSort'

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

  // DOSTĘPNE = fizyczne − zarezerwowane (ujemne = nadrezerwacja, sygnał planistyczny)
  const renderAvailableCell = (available: number) => (
    <strong style={available < 0 ? { color: '#c62828' } : undefined}>{available}</strong>
  )

  const renderIncomingCell = (componentId: number) => {
    const inc = incomingByComponent.get(componentId)
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
  const handleSort = useCallback((key: string) => setSort((prev) => toggleSort(prev, key)), [])

  const displayAggregated = useMemo(() => {
    if (!filteredAggregatedRows) return null
    const getters: Record<string, (r: AggregatedRow) => unknown> = {
      code: (r) => r.component_code,
      name: (r) => r.component_name,
      category: (r) => r.component_category,
      unit: (r) => r.component_unit,
      total: (r) => r.total,
      reserved: (r) => r.reserved,
      available: (r) => r.total - r.reserved,
      incoming: (r) => incomingByComponent.get(r.component_id)?.incoming_qty ?? 0,
      projected: (r) =>
        r.total - r.reserved + (incomingByComponent.get(r.component_id)?.incoming_qty ?? 0),
      min: (r) => r.component_min_stock_level,
      status: (r) => statusRank(stockStatusAggregated(r.total, r.component_min_stock_level)),
    }
    for (const w of warehousesSorted) {
      getters[`wh_${w.id}`] = (r) => r.quantities[w.id] ?? 0
    }
    return sortRows(filteredAggregatedRows, sort, getters)
  }, [filteredAggregatedRows, sort, warehousesSorted, incomingByComponent])

  const displayRows = useMemo(
    () =>
      sortRows(filteredRows, sort, {
        code: (r) => r.component_code,
        name: (r) => r.component_name,
        category: (r) => r.component_category,
        unit: (r) => r.component_unit,
        warehouse: (r) => r.warehouse_code,
        qty: (r) => r.quantity,
        reserved: (r) => r.reserved_quantity ?? 0,
        available: (r) => r.available_quantity ?? r.quantity,
        incoming: (r) => incomingByComponent.get(r.component_id)?.incoming_qty ?? 0,
        projected: (r) =>
          (r.available_quantity ?? r.quantity) +
          (incomingByComponent.get(r.component_id)?.incoming_qty ?? 0),
        min: (r) => r.component_min_stock_level,
        status: (r) => statusRank(stockStatus(r)),
      }),
    [filteredRows, sort, incomingByComponent],
  )

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
        <TopScrollTableWrapper className="table-wrapper">
          <table className="orders-table">
            <thead>
              <tr>
                <SortableTh label="KOD" sortKey="code" state={sort} onToggle={handleSort} />
                <SortableTh label="NAZWA" sortKey="name" state={sort} onToggle={handleSort} />
                <SortableTh label="KATEGORIA" sortKey="category" state={sort} onToggle={handleSort} />
                <SortableTh label="JEDNOSTKA" sortKey="unit" state={sort} onToggle={handleSort} />
                {warehousesSorted.map((w) => (
                  <SortableTh key={w.id} label={w.code} sortKey={`wh_${w.id}`} state={sort} onToggle={handleSort} />
                ))}
                <SortableTh label="FIZYCZNE" sortKey="total" state={sort} onToggle={handleSort} />
                <SortableTh label="ZAREZERW." sortKey="reserved" state={sort} onToggle={handleSort} />
                <SortableTh label="DOSTĘPNE" sortKey="available" state={sort} onToggle={handleSort} />
                <SortableTh label="W DRODZE" sortKey="incoming" state={sort} onToggle={handleSort} />
                <SortableTh label="PROGNOZA" sortKey="projected" state={sort} onToggle={handleSort} />
                <SortableTh label="MIN. STAN" sortKey="min" state={sort} onToggle={handleSort} />
                <SortableTh label="STATUS" sortKey="status" state={sort} onToggle={handleSort} />
                <th>AKCJE</th>
              </tr>
            </thead>
            <tbody>
              {(displayAggregated ?? filteredAggregatedRows).map((row) => {
                const s = stockStatusAggregated(row.total, row.component_min_stock_level)
                const available = row.total - row.reserved
                const incQty = incomingByComponent.get(row.component_id)?.incoming_qty ?? 0
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
                    <td>{row.reserved || '—'}</td>
                    <td>{renderAvailableCell(available)}</td>
                    <td>{renderIncomingCell(row.component_id)}</td>
                    <td>{available + incQty}</td>
                    <td>
                      {row.component_min_stock_level != null ? row.component_min_stock_level : '—'}
                    </td>
                    <td>{renderStatusCell(s)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
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
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          title="Zgłoś zniszczenie (drugi gatunek) — zdejmie z magazynu"
                          onClick={() => setDamageTarget({ componentId: row.component_id, warehouseId: null })}
                        >
                          ⚠️
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filteredAggregatedRows.length === 0 && (
            <p className="no-results">Brak wierszy spełniających kryteria.</p>
          )}
        </TopScrollTableWrapper>
      ) : (
        <TopScrollTableWrapper className="table-wrapper">
          <table className="orders-table">
            <thead>
              <tr>
                <SortableTh label="KOD" sortKey="code" state={sort} onToggle={handleSort} />
                <SortableTh label="NAZWA" sortKey="name" state={sort} onToggle={handleSort} />
                <SortableTh label="KATEGORIA" sortKey="category" state={sort} onToggle={handleSort} />
                <SortableTh label="JEDNOSTKA" sortKey="unit" state={sort} onToggle={handleSort} />
                <SortableTh label="MAGAZYN" sortKey="warehouse" state={sort} onToggle={handleSort} />
                <SortableTh label="FIZYCZNE" sortKey="qty" state={sort} onToggle={handleSort} />
                <SortableTh label="ZAREZERW." sortKey="reserved" state={sort} onToggle={handleSort} />
                <SortableTh label="DOSTĘPNE" sortKey="available" state={sort} onToggle={handleSort} />
                <SortableTh label="W DRODZE" sortKey="incoming" state={sort} onToggle={handleSort} />
                <SortableTh label="PROGNOZA" sortKey="projected" state={sort} onToggle={handleSort} />
                <SortableTh label="MIN. STAN" sortKey="min" state={sort} onToggle={handleSort} />
                <SortableTh label="STATUS" sortKey="status" state={sort} onToggle={handleSort} />
                <th>AKCJE</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => {
                const s = stockStatus(row)
                const available = row.available_quantity ?? row.quantity
                const incQty = incomingByComponent.get(row.component_id)?.incoming_qty ?? 0
                return (
                  <tr key={row.id}>
                    <td>{row.component_code?.trim() ? row.component_code : '—'}</td>
                    <td>{row.component_name?.trim() ? row.component_name : '—'}</td>
                    <td>{row.component_category?.trim() ? row.component_category : '—'}</td>
                    <td>{row.component_unit?.trim() ? row.component_unit : '—'}</td>
                    <td>{row.warehouse_code?.trim() ? row.warehouse_code : '—'}</td>
                    <td>{row.quantity}</td>
                    <td>{row.reserved_quantity || '—'}</td>
                    <td>{renderAvailableCell(available)}</td>
                    <td>{renderIncomingCell(row.component_id)}</td>
                    <td>{available + incQty}</td>
                    <td>
                      {row.component_min_stock_level != null ? row.component_min_stock_level : '—'}
                    </td>
                    <td>{renderStatusCell(s)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
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
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          title="Zgłoś zniszczenie (drugi gatunek) — zdejmie z magazynu"
                          onClick={() => setDamageTarget({ componentId: row.component_id, warehouseId: row.warehouse_id })}
                        >
                          ⚠️
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filteredRows.length === 0 && <p className="no-results">Brak wierszy spełniających kryteria.</p>}
        </TopScrollTableWrapper>
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
