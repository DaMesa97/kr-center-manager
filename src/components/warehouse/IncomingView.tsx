import { useCallback, useMemo, useState } from 'react'
import type { IncomingStockRow, WarehouseComponent } from '../../types'
import Spinner from '../Spinner'
import SortableTh from '../SortableTh'
import { TopScrollTableWrapper } from '../TopScrollTableWrapper'
import { sortRows, toggleSort, type SortState } from '../../lib/tableSort'

function formatDatePl(d: string | null): string {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return y && m && day ? `${day}.${m}.${y}` : d
}

function isOverdue(eta: string | null): boolean {
  if (!eta) return false
  const today = new Date()
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return eta < iso
}

type Props = {
  incoming: IncomingStockRow[]
  components: WarehouseComponent[]
  loading: boolean
  onRefresh: () => void
}

/** Podzakładka Magazyn → W drodze: niedostarczone pozycje z otwartych ZD. */
function IncomingView({ incoming, components, loading, onRefresh }: Props) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortState>(null)
  const handleSort = useCallback((key: string) => setSort((prev) => toggleSort(prev, key)), [])

  const componentById = useMemo(() => {
    const m = new Map<number, WarehouseComponent>()
    components.forEach((c) => m.set(c.id, c))
    return m
  }, [components])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return incoming
      .filter((r) => r.incoming_qty > 0)
      .map((r) => {
        const comp = componentById.get(r.component_id)
        return {
          ...r,
          code: comp?.code ?? '',
          name: comp?.name ?? `#${r.component_id}`,
          unit: comp?.unit ?? '',
        }
      })
      .filter((r) => !q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
  }, [incoming, componentById, search])

  const display = useMemo(
    () =>
      sortRows(rows, sort, {
        code: (r) => r.code,
        name: (r) => r.name,
        qty: (r) => r.incoming_qty,
        earliest: (r) => r.earliest_eta ?? '9999',
        latest: (r) => r.latest_eta ?? '9999',
        pos: (r) => r.open_pos,
      }),
    [rows, sort],
  )

  const totalQty = useMemo(() => rows.reduce((s, r) => s + r.incoming_qty, 0), [rows])
  const overdueCount = useMemo(() => rows.filter((r) => isOverdue(r.earliest_eta)).length, [rows])

  return (
    <>
      <div className="orders-filters" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <input
          type="text"
          className="search-input"
          placeholder="Szukaj po kodzie lub nazwie komponentu…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 240, flex: '1 1 220px' }}
        />
        <span style={{ alignSelf: 'center', fontSize: 13, color: 'var(--color-text-muted, #64748b)' }}>
          Pozycji: <strong>{rows.length}</strong> · sztuk w drodze: <strong>{totalQty}</strong>
          {overdueCount > 0 && (
            <>
              {' '}· <span style={{ color: '#c62828', fontWeight: 700 }}>{overdueCount} po terminie</span>
            </>
          )}
        </span>
        <button type="button" className="btn btn-sm btn-secondary" onClick={onRefresh}>
          Odśwież
        </button>
      </div>

      {loading ? (
        <Spinner center label="Ładowanie dostaw w drodze…" />
      ) : (
        <TopScrollTableWrapper className="table-wrapper">
          <table className="orders-table">
            <thead>
              <tr>
                <SortableTh label="KOD" sortKey="code" state={sort} onToggle={handleSort} />
                <SortableTh label="NAZWA" sortKey="name" state={sort} onToggle={handleSort} />
                <SortableTh label="W DRODZE" sortKey="qty" state={sort} onToggle={handleSort} />
                <SortableTh label="NAJBLIŻSZA DOSTAWA" sortKey="earliest" state={sort} onToggle={handleSort} />
                <SortableTh label="OSTATNIA DOSTAWA" sortKey="latest" state={sort} onToggle={handleSort} />
                <SortableTh label="OTWARTE ZD" sortKey="pos" state={sort} onToggle={handleSort} />
              </tr>
            </thead>
            <tbody>
              {display.map((r) => {
                const overdue = isOverdue(r.earliest_eta)
                return (
                  <tr key={r.component_id}>
                    <td>{r.code || '—'}</td>
                    <td>
                      {r.name}
                      {r.unit ? (
                        <span style={{ color: 'var(--color-text-muted, #94a3b8)', fontSize: 12 }}> ({r.unit})</span>
                      ) : null}
                    </td>
                    <td><strong>{r.incoming_qty}</strong></td>
                    <td>
                      {formatDatePl(r.earliest_eta)}
                      {overdue && (
                        <span
                          style={{ color: '#c62828', fontWeight: 700, marginLeft: 6 }}
                          title="Data dostawy minęła, a pozycja nie została przyjęta — pogoń dostawcę albo przyjmij dostawę"
                        >
                          po terminie!
                        </span>
                      )}
                    </td>
                    <td>{formatDatePl(r.latest_eta)}</td>
                    <td>{r.open_pos}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {display.length === 0 && (
            <p className="no-results">
              Nic nie jest w drodze — brak niedostarczonych pozycji w wysłanych zamówieniach do dostawców.
            </p>
          )}
        </TopScrollTableWrapper>
      )}
    </>
  )
}

export default IncomingView
