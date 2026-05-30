import { useMemo, useState } from 'react'
import type { PzGroupRow, Warehouse } from '../../types'

type PzViewProps = {
  pzGroups: PzGroupRow[]
  loading: boolean
  isManager: boolean
  warehouses: Warehouse[]
  onCreate: () => void
  onPreview: (reference_doc: string) => void
}

function formatPzDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`
}

function PzView({ pzGroups, loading, isManager, warehouses, onCreate, onPreview }: PzViewProps) {
  const [warehouseFilter, setWarehouseFilter] = useState<number | ''>('')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const warehousesSorted = useMemo(
    () => [...warehouses].sort((a, b) => a.code.localeCompare(b.code)),
    [warehouses],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null

    return pzGroups.filter((row) => {
      if (warehouseFilter !== '' && row.warehouse_id !== warehouseFilter) return false
      if (q && !row.reference_doc.toLowerCase().includes(q)) return false
      const rowMs = new Date(row.created_at).getTime()
      if (fromMs !== null && rowMs < fromMs) return false
      if (toMs !== null && rowMs > toMs) return false
      return true
    })
  }, [pzGroups, warehouseFilter, search, dateFrom, dateTo])

  const sorted = useMemo(
    () =>
      [...filtered].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [filtered],
  )

  return (
    <div className="pz-view">
      <div className="movements-view-filters" style={{ alignItems: 'center' }}>
        {isManager ? (
          <button type="button" className="btn btn-success" onClick={onCreate}>
            Nowe przyjęcie
          </button>
        ) : null}
        <label className="movements-view-filter">
          <span className="movements-view-filter-label">Magazyn</span>
          <select
            className="day-filter"
            value={warehouseFilter === '' ? '' : String(warehouseFilter)}
            onChange={(e) => {
              const v = e.target.value
              setWarehouseFilter(v === '' ? '' : Number(v))
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
        <label className="movements-view-filter movements-view-filter--grow">
          <span className="movements-view-filter-label">Szukaj</span>
          <input
            type="text"
            className="search-input"
            placeholder="Numer dokumentu…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="movements-view-filter">
          <span className="movements-view-filter-label">Od</span>
          <input type="date" className="search-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className="movements-view-filter">
          <span className="movements-view-filter-label">Do</span>
          <input type="date" className="search-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
      </div>

      {loading ? (
        <p className="no-results">Ładowanie…</p>
      ) : (
        <div className="table-wrapper">
          <table className="orders-table">
            <thead>
              <tr>
                <th>DATA</th>
                <th>DOKUMENT</th>
                <th>MAGAZYN</th>
                <th>POZYCJI</th>
                <th>SUMA</th>
                <th>AKCJA</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={6} className="movements-view-empty">
                    Brak przyjęć do wyświetlenia.
                  </td>
                </tr>
              ) : (
                sorted.map((row) => (
                  <tr key={`${row.reference_doc}-${row.warehouse_id}`}>
                    <td>{formatPzDate(row.created_at)}</td>
                    <td>{row.reference_doc}</td>
                    <td>{row.warehouse_code || '—'}</td>
                    <td>{row.items_count}</td>
                    <td>{row.total_quantity}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => onPreview(row.reference_doc)}
                      >
                        Podgląd
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default PzView
