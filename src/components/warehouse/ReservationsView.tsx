import { useMemo, useState } from 'react'
import type { StockReservationRow } from '../../types'
import Spinner from '../Spinner'
import DeleteConfirmDialog from '../DeleteConfirmDialog'
import DataTable, { type DataTableColumn } from '../DataTable'
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

type OrderGroup = {
  order_id: number
  order_number: string
  order_category: string
  order_company: string
  lines: StockReservationRow[]
  totalReserved: number
  totalReleased: number
  activeCount: number
  newestAt: string
}

type Props = {
  reservations: StockReservationRow[]
  loading: boolean
  isManager: boolean
  onRelease: (reservationId: number) => Promise<void>
  onReleaseOrder?: (orderId: number) => Promise<void>
  onRefresh: () => void
}

/** Podzakładka Magazyn → Rezerwacje: zgrupowane po zleceniach, klik rozwija komponenty. */
function ReservationsView({ reservations, loading, isManager, onRelease, onReleaseOrder, onRefresh }: Props) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'active' | 'all' | StockReservationRow['status']>('active')
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null)
  const [releaseConfirm, setReleaseConfirm] = useState<StockReservationRow | null>(null)
  const [releaseOrderConfirm, setReleaseOrderConfirm] = useState<OrderGroup | null>(null)

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

  // Grupowanie po zleceniach — jedno zamówienie = jeden wiersz z podsumowaniem
  const groups = useMemo((): OrderGroup[] => {
    const byOrder = new Map<number, OrderGroup>()
    const order: number[] = []
    for (const r of filtered) {
      let g = byOrder.get(r.order_id)
      if (!g) {
        g = {
          order_id: r.order_id,
          order_number: r.order_number ?? `#${r.order_id}`,
          order_category: r.order_category ?? '—',
          order_company: r.order_company ?? '—',
          lines: [],
          totalReserved: 0,
          totalReleased: 0,
          activeCount: 0,
          newestAt: r.created_at,
        }
        byOrder.set(r.order_id, g)
        order.push(r.order_id)
      }
      g.lines.push(r)
      g.totalReserved += r.quantity_reserved
      g.totalReleased += r.quantity_released
      if (r.status === 'reserved' || r.status === 'partially_released') g.activeCount++
      if (r.created_at > g.newestAt) g.newestAt = r.created_at
    }
    for (const g of byOrder.values()) {
      g.lines.sort((a, b) => (a.component_name ?? '').localeCompare(b.component_name ?? '', 'pl'))
    }
    return order.map((id) => byOrder.get(id)!)
  }, [filtered])

  const activeCount = useMemo(
    () => reservations.filter((r) => r.status === 'reserved' || r.status === 'partially_released').length,
    [reservations],
  )

  const groupColumns = useMemo((): DataTableColumn<OrderGroup>[] => {
    const cols: DataTableColumn<OrderGroup>[] = [
      {
        key: 'order',
        label: 'ZLECENIE',
        render: (g) => (
          <>
            <span style={{ marginRight: 6 }}>{expandedOrderId === g.order_id ? '▾' : '▸'}</span>
            <strong>{g.order_number}</strong>
          </>
        ),
      },
      { key: 'company', label: 'FIRMA', render: (g) => g.order_company },
      { key: 'category', label: 'KAT.', render: (g) => g.order_category },
      {
        key: 'lines',
        label: 'POZYCJI',
        title: 'Liczba pozycji komponentowych',
        render: (g) => (
          <>
            {g.lines.length}
            {g.activeCount > 0 && g.activeCount < g.lines.length && (
              <span style={{ color: '#0369a1', fontSize: 12 }}> ({g.activeCount} akt.)</span>
            )}
          </>
        ),
      },
      { key: 'reserved', label: 'ZAREZERW.', render: (g) => Math.round(g.totalReserved * 1000) / 1000 },
      {
        key: 'released',
        label: 'WYDANE',
        render: (g) => (
          <>
            {g.totalReleased > 0 ? Math.round(g.totalReleased * 1000) / 1000 : '—'}
            {g.activeCount === 0 && g.totalReleased > 0 && (
              <span style={{ color: '#15803d', fontSize: 12, marginLeft: 4 }}>✓ komplet</span>
            )}
          </>
        ),
      },
      { key: 'newest', label: 'OSTATNIA ZMIANA', render: (g) => formatDateTimePl(g.newestAt) },
    ]
    if (isManager) {
      cols.push({
        key: 'actions',
        label: 'AKCJE',
        // klik w akcje nie rozwija wiersza
        render: (g) => (
          <div onClick={(e) => e.stopPropagation()}>
            {g.activeCount > 0 && onReleaseOrder && (
              <button
                type="button"
                className="btn btn-sm btn-danger"
                title="Zwolnij WSZYSTKIE niewydane rezerwacje tego zlecenia"
                onClick={() => setReleaseOrderConfirm(g)}
              >
                Zwolnij wszystkie
              </button>
            )}
          </div>
        ),
      })
    }
    return cols
  }, [expandedOrderId, isManager, onReleaseOrder])

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
          Zleceń: <strong>{groups.length}</strong> · aktywnych rezerwacji: <strong>{activeCount}</strong>
        </span>
        <button type="button" className="btn btn-sm btn-secondary" onClick={onRefresh}>
          Odśwież
        </button>
      </div>

      {loading ? (
        <Spinner center label="Ładowanie rezerwacji…" />
      ) : (
        <DataTable
          rows={groups}
          rowKey={(g) => g.order_id}
          columns={groupColumns}
          emptyText="Brak rezerwacji spełniających kryteria."
          onRowClick={(g) => setExpandedOrderId(expandedOrderId === g.order_id ? null : g.order_id)}
          rowTitle={() => 'Kliknij, aby rozwinąć komponenty'}
          renderAfterRow={(g) =>
            expandedOrderId === g.order_id && (
              <tr>
                <td
                  colSpan={isManager ? 8 : 7}
                  style={{ background: 'var(--color-bg-muted, #f8fafc)', padding: '6px 14px' }}
                >
                  <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--color-text-muted, #64748b)' }}>
                        <th style={{ padding: '2px 8px', fontWeight: 600 }}>KOMPONENT</th>
                        <th style={{ padding: '2px 8px', fontWeight: 600, width: 110 }}>ETAP</th>
                        <th style={{ padding: '2px 8px', fontWeight: 600, width: 90 }}>ZAREZERW.</th>
                        <th style={{ padding: '2px 8px', fontWeight: 600, width: 80 }}>WYDANE</th>
                        <th style={{ padding: '2px 8px', fontWeight: 600, width: 90 }}>MAGAZYN</th>
                        <th style={{ padding: '2px 8px', fontWeight: 600, width: 140 }}>STATUS</th>
                        {isManager && <th style={{ width: 90 }} />}
                      </tr>
                    </thead>
                    <tbody>
                      {g.lines.map((r) => {
                        const rest = r.quantity_reserved - r.quantity_released
                        const isActive = r.status === 'reserved' || r.status === 'partially_released'
                        return (
                          <tr key={r.id} style={{ borderTop: '1px solid var(--color-border, #e2e8f0)' }}>
                            <td style={{ padding: '4px 8px' }}>
                              {r.component_name ?? '—'}
                              {r.component_unit ? (
                                <span style={{ color: 'var(--color-text-muted, #94a3b8)', fontSize: 12 }}>
                                  {' '}({r.component_unit})
                                </span>
                              ) : null}
                            </td>
                            <td style={{ padding: '4px 8px' }}>{stageLabel(r)}</td>
                            <td style={{ padding: '4px 8px' }}>{r.quantity_reserved}</td>
                            <td style={{ padding: '4px 8px' }}>{r.quantity_released || '—'}</td>
                            <td style={{ padding: '4px 8px' }}>{r.warehouse_code ?? '—'}</td>
                            <td style={{ padding: '4px 8px' }}>
                              <span style={{ color: STATUS_COLORS[r.status], fontWeight: 600 }}>
                                {STATUS_LABELS[r.status]}
                              </span>
                              {isActive && rest !== r.quantity_reserved && (
                                <span style={{ fontSize: 12, color: '#a16207' }}> (zostało {rest})</span>
                              )}
                            </td>
                            {isManager && (
                              <td style={{ padding: '4px 8px' }}>
                                {isActive && (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-danger"
                                    title="Zwolnij niewydaną resztę tej rezerwacji"
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
                </td>
              </tr>
            )
          }
        />
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

      {releaseOrderConfirm && (
        <DeleteConfirmDialog
          title="Zwolnić wszystkie rezerwacje zlecenia?"
          message={`Zlecenie ${releaseOrderConfirm.order_number} (${releaseOrderConfirm.order_company}) — zwolnisz ${releaseOrderConfirm.activeCount} aktywnych rezerwacji. Niewydane ilości wrócą do dostępnych; już wydane zostają. Operacja trafi do audytu.`}
          confirmLabel="Zwolnij wszystkie"
          cancelLabel="Anuluj"
          onConfirm={() => {
            const run = async () => {
              if (!releaseOrderConfirm || !onReleaseOrder) return
              await onReleaseOrder(releaseOrderConfirm.order_id)
              setReleaseOrderConfirm(null)
            }
            void run()
          }}
          onCancel={() => setReleaseOrderConfirm(null)}
        />
      )}
    </>
  )
}

export default ReservationsView
