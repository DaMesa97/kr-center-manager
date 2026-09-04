import { useCallback, useMemo, useState } from 'react'
import type { StockReservationRow } from '../../types'
import Spinner from '../Spinner'
import SortableTh from '../SortableTh'
import DeleteConfirmDialog from '../DeleteConfirmDialog'
import { TopScrollTableWrapper } from '../TopScrollTableWrapper'
import { sortRows, toggleSort, type SortState } from '../../lib/tableSort'
import { getOrderStageDefinitions } from '../../utils'

const STATUS_LABELS: Record<StockReservationRow['status'], string> = {
  reserved: 'Zarezerwowane',
  partially_released: 'Częściowo wydane',
  released: 'Wydane',
  cancelled: 'Anulowane',
}

const STATUS_COLORS: Record<StockReservationRow['status'], string> = {
  reserved: '#0369a1',
  partially_released: '#a16207',
  released: '#15803d',
  cancelled: '#6b7280',
}

function stageLabel(row: StockReservationRow): string {
  if (!row.stage_key) return 'pierwszy ukończony'
  const def = getOrderStageDefinitions(row.order_category ?? '').find((d) => d.key === row.stage_key)
  return def ? def.header : row.stage_key
}

function formatDateTimePl(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
}

type Props = {
  reservations: StockReservationRow[]
  loading: boolean
  isManager: boolean
  onRelease: (reservationId: number) => Promise<void>
  onRefresh: () => void
}

/** Podzakładka Magazyn → Rezerwacje: co jest odłożone pod które zamówienia. */
function ReservationsView({ reservations, loading, isManager, onRelease, onRefresh }: Props) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'active' | 'all' | StockReservationRow['status']>('active')
  const [sort, setSort] = useState<SortState>(null)
  const [releaseConfirm, setReleaseConfirm] = useState<StockReservationRow | null>(null)
  const handleSort = useCallback((key: string) => setSort((prev) => toggleSort(prev, key)), [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return reservations.filter((r) => {
      if (statusFilter === 'active') {
        if (r.status !== 'reserved' && r.status !== 'partially_released') return false
      } else if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (!q) return true
      return (
        (r.order_number ?? '').toLowerCase().includes(q) ||
        (r.order_company ?? '').toLowerCase().includes(q) ||
        (r.component_name ?? '').toLowerCase().includes(q) ||
        (r.component_code ?? '').toLowerCase().includes(q)
      )
    })
  }, [reservations, search, statusFilter])

  const display = useMemo(
    () =>
      sortRows(filtered, sort, {
        order: (r) => r.order_number,
        company: (r) => r.order_company,
        category: (r) => r.order_category,
        component: (r) => r.component_name,
        stage: (r) => stageLabel(r),
        reserved: (r) => r.quantity_reserved,
        released: (r) => r.quantity_released,
        rest: (r) => r.quantity_reserved - r.quantity_released,
        warehouse: (r) => r.warehouse_code,
        status: (r) => r.status,
        created: (r) => r.created_at,
      }),
    [filtered, sort],
  )

  const activeCount = useMemo(
    () => reservations.filter((r) => r.status === 'reserved' || r.status === 'partially_released').length,
    [reservations],
  )

  return (
    <>
      <div className="orders-filters" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <label className="day-filter" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span>Status</span>
          <select
            className="day-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="active">Aktywne (zarezerw. + częściowe)</option>
            <option value="all">Wszystkie</option>
            <option value="reserved">Zarezerwowane</option>
            <option value="partially_released">Częściowo wydane</option>
            <option value="released">Wydane</option>
            <option value="cancelled">Anulowane</option>
          </select>
        </label>
        <input
          type="text"
          className="search-input"
          placeholder="Szukaj po nr zlecenia, firmie lub komponencie…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 240, flex: '1 1 220px' }}
        />
        <span style={{ alignSelf: 'center', fontSize: 13, color: 'var(--color-text-muted, #64748b)' }}>
          Aktywnych rezerwacji: <strong>{activeCount}</strong>
        </span>
        <button type="button" className="btn btn-sm btn-secondary" onClick={onRefresh}>
          Odśwież
        </button>
      </div>

      {loading ? (
        <Spinner center label="Ładowanie rezerwacji…" />
      ) : (
        <TopScrollTableWrapper className="table-wrapper">
          <table className="orders-table">
            <thead>
              <tr>
                <SortableTh label="ZLECENIE" sortKey="order" state={sort} onToggle={handleSort} />
                <SortableTh label="FIRMA" sortKey="company" state={sort} onToggle={handleSort} />
                <SortableTh label="KAT." sortKey="category" state={sort} onToggle={handleSort} />
                <SortableTh label="KOMPONENT" sortKey="component" state={sort} onToggle={handleSort} />
                <SortableTh label="ETAP WYDANIA" sortKey="stage" state={sort} onToggle={handleSort} />
                <SortableTh label="ZAREZERW." sortKey="reserved" state={sort} onToggle={handleSort} />
                <SortableTh label="WYDANE" sortKey="released" state={sort} onToggle={handleSort} />
                <SortableTh label="POZOSTAŁO" sortKey="rest" state={sort} onToggle={handleSort} />
                <SortableTh label="MAGAZYN" sortKey="warehouse" state={sort} onToggle={handleSort} />
                <SortableTh label="STATUS" sortKey="status" state={sort} onToggle={handleSort} />
                <SortableTh label="UTWORZONO" sortKey="created" state={sort} onToggle={handleSort} />
                {isManager && <th>AKCJE</th>}
              </tr>
            </thead>
            <tbody>
              {display.map((r) => {
                const rest = r.quantity_reserved - r.quantity_released
                const isActive = r.status === 'reserved' || r.status === 'partially_released'
                return (
                  <tr key={r.id}>
                    <td>{r.order_number ?? `#${r.order_id}`}</td>
                    <td>{r.order_company ?? '—'}</td>
                    <td>{r.order_category ?? '—'}</td>
                    <td>
                      {r.component_name ?? '—'}
                      {r.component_unit ? (
                        <span style={{ color: 'var(--color-text-muted, #94a3b8)', fontSize: 12 }}>
                          {' '}({r.component_unit})
                        </span>
                      ) : null}
                    </td>
                    <td>{stageLabel(r)}</td>
                    <td>{r.quantity_reserved}</td>
                    <td>{r.quantity_released || '—'}</td>
                    <td>{isActive ? <strong>{rest}</strong> : '—'}</td>
                    <td>{r.warehouse_code ?? '—'}</td>
                    <td>
                      <span style={{ color: STATUS_COLORS[r.status], fontWeight: 600 }}>
                        {STATUS_LABELS[r.status]}
                      </span>
                    </td>
                    <td>{formatDateTimePl(r.created_at)}</td>
                    {isManager && (
                      <td>
                        {isActive && (
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            title="Zwolnij niewydaną resztę rezerwacji (wraca do dostępnych)"
                            onClick={() => setReleaseConfirm(r)}
                          >
                            Zwolnij
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {display.length === 0 && <p className="no-results">Brak rezerwacji spełniających kryteria.</p>}
        </TopScrollTableWrapper>
      )}

      {releaseConfirm && (
        <DeleteConfirmDialog
          title="Zwolnić rezerwację?"
          message={`${releaseConfirm.component_name ?? 'Komponent'} — zwolnisz ${
            releaseConfirm.quantity_reserved - releaseConfirm.quantity_released
          } szt. zarezerwowanych pod zlecenie ${releaseConfirm.order_number ?? `#${releaseConfirm.order_id}`}. Ilość wróci do dostępnych, a operacja trafi do audytu.`}
          confirmLabel="Zwolnij"
          cancelLabel="Anuluj"
          onConfirm={() => {
            const run = async () => {
              if (!releaseConfirm) return
              await onRelease(releaseConfirm.id)
              setReleaseConfirm(null)
            }
            void run()
          }}
          onCancel={() => setReleaseConfirm(null)}
        />
      )}
    </>
  )
}

export default ReservationsView
