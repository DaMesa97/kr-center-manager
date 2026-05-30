import { useMemo, useState } from 'react'
import type { Warehouse, WarehouseComponent, WarehouseMovementRow } from '../../types'

type MovementsViewProps = {
  movements: WarehouseMovementRow[]
  loading: boolean
  warehouses: Warehouse[]
  components: WarehouseComponent[]
}

function formatMovementDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`
}

const MOVEMENT_TYPE_DESCRIPTIONS: Record<string, string> = {
  PZ: 'PZ — Przyjęcie zewnętrzne (dostawa do magazynu)',
  WZ: 'WZ — Wydanie zewnętrzne (pobranie na zamówienie)',
  MM: 'MM — Przesunięcie międzymagazynowe',
  ZWR: 'ZWR — Zwrot (np. z anulowanego zamówienia)',
}

function formatQuantityDisplay(m: WarehouseMovementRow): string {
  const abs = Math.abs(Number(m.quantity))
  switch (m.movement_type) {
    case 'PZ':
    case 'ZWR':
      return `+${abs}`
    case 'WZ':
      return `-${abs}`
    case 'MM':
      return String(abs)
    default:
      return String(m.quantity)
  }
}

function MovementsView({ movements, loading, warehouses, components }: MovementsViewProps) {
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [warehouseIdFilter, setWarehouseIdFilter] = useState<number | ''>('')
  const [componentIdFilter, setComponentIdFilter] = useState<number | ''>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')

  const warehousesSorted = useMemo(
    () => [...warehouses].sort((a, b) => a.code.localeCompare(b.code)),
    [warehouses],
  )

  const componentsSorted = useMemo(
    () => [...components].sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '')),
    [components],
  )

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null

    return movements.filter((row) => {
      if (typeFilter !== '' && row.movement_type !== typeFilter) return false
      if (warehouseIdFilter !== '') {
        const wid = warehouseIdFilter as number
        if (row.warehouse_from_id !== wid && row.warehouse_to_id !== wid) return false
      }
      if (componentIdFilter !== '' && row.component_id !== componentIdFilter) return false

      const rowMs = new Date(row.created_at).getTime()
      if (fromMs !== null && rowMs < fromMs) return false
      if (toMs !== null && rowMs > toMs) return false

      if (!q) return true
      const code = (row.component_code ?? '').toLowerCase()
      const name = (row.component_name ?? '').toLowerCase()
      const ord = (row.order_number ?? '').toLowerCase()
      const ref = (row.reference_doc ?? '').toLowerCase()
      return code.includes(q) || name.includes(q) || ord.includes(q) || ref.includes(q)
    })
  }, [movements, typeFilter, warehouseIdFilter, componentIdFilter, dateFrom, dateTo, search])

  const sortedFiltered = useMemo(
    () =>
      [...filteredRows].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [filteredRows],
  )

  return (
    <div className="movements-view">
      <div className="movements-view-filters">
        <label className="movements-view-filter">
          <span className="movements-view-filter-label">Typ ruchu</span>
          <select
            className="day-filter"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">Wszystkie</option>
            <option value="PZ">PZ</option>
            <option value="WZ">WZ</option>
            <option value="MM">MM</option>
            <option value="ZWR">ZWR</option>
          </select>
        </label>
        <label className="movements-view-filter">
          <span className="movements-view-filter-label">Magazyn</span>
          <select
            className="day-filter"
            value={warehouseIdFilter === '' ? '' : String(warehouseIdFilter)}
            onChange={(e) => {
              const v = e.target.value
              setWarehouseIdFilter(v === '' ? '' : Number(v))
            }}
          >
            <option value="">Wszystkie</option>
            {warehousesSorted.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code}
              </option>
            ))}
          </select>
        </label>
        <label className="movements-view-filter">
          <span className="movements-view-filter-label">Komponent</span>
          <select
            className="day-filter"
            value={componentIdFilter === '' ? '' : String(componentIdFilter)}
            onChange={(e) => {
              const v = e.target.value
              setComponentIdFilter(v === '' ? '' : Number(v))
            }}
          >
            <option value="">Wszystkie</option>
            {componentsSorted.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="movements-view-filter">
          <span className="movements-view-filter-label">Od</span>
          <input
            type="date"
            className="search-input"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        <label className="movements-view-filter">
          <span className="movements-view-filter-label">Do</span>
          <input
            type="date"
            className="search-input"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>
        <label className="movements-view-filter movements-view-filter--grow">
          <span className="movements-view-filter-label">Szukaj</span>
          <input
            type="text"
            className="search-input"
            placeholder="Kod/nazwa komponentu, zamówienie, dokument…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      {loading ? (
        <p className="no-results">Ładowanie…</p>
      ) : (
        <div className="table-wrapper">
          <table className="orders-table movements-view-table">
            <thead>
              <tr>
                <th>DATA</th>
                <th>TYP</th>
                <th>KOMPONENT</th>
                <th>ILOŚĆ</th>
                <th>MAGAZYN Z</th>
                <th>MAGAZYN DO</th>
                <th>ZAMÓWIENIE</th>
                <th>DOKUMENT</th>
                <th>UWAGI</th>
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="movements-view-empty">
                    Brak ruchów do wyświetlenia.
                  </td>
                </tr>
              ) : (
                sortedFiltered.map((row) => {
                  const compLabel = [row.component_code, row.component_name, row.component_unit]
                    .filter(Boolean)
                    .length
                    ? `${row.component_code ?? '—'} — ${row.component_name ?? ''} (${row.component_unit ?? ''})`
                    : '—'
                  return (
                    <tr key={row.id}>
                      <td>{formatMovementDate(row.created_at)}</td>
                      <td>
                        <span
                          className={`movement-type-badge movement-type-badge--${String(row.movement_type).toLowerCase()}`}
                          title={MOVEMENT_TYPE_DESCRIPTIONS[row.movement_type] ?? row.movement_type}
                        >
                          {row.movement_type}
                        </span>
                      </td>
                      <td title={compLabel}>{compLabel}</td>
                      <td>{formatQuantityDisplay(row)}</td>
                      <td>{row.warehouse_from_code ?? ''}</td>
                      <td>{row.warehouse_to_code ?? ''}</td>
                      <td>{row.order_number ?? ''}</td>
                      <td>{row.reference_doc ?? ''}</td>
                      <td>{row.notes ?? ''}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default MovementsView
