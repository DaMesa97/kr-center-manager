import { useMemo, type MutableRefObject } from 'react'
import { TopScrollTableWrapper } from './TopScrollTableWrapper'
import type { Order, InternalDoorItem } from '../types'

type Props = {
  orders: Order[]
  items: InternalDoorItem[]
  onShowDetails: (o: Order) => void
  tableWrapperRef: MutableRefObject<HTMLDivElement | null>
}

function InternalDoorOrdersTable({ orders, items, onShowDetails, tableWrapperRef }: Props) {
  const itemsByOrder = useMemo(() => {
    const map = new Map<number, InternalDoorItem[]>()
    items.forEach((it) => {
      const arr = map.get(it.order_id) ?? []
      arr.push(it)
      map.set(it.order_id, arr)
    })
    return map
  }, [items])

  return (
    <TopScrollTableWrapper className="table-wrapper orders-table-wrapper" tableWrapperRef={tableWrapperRef}>
      <table className="orders-table">
        <thead>
          <tr>
            <th className="col-order-text">NR</th>
            <th className="col-order-text">FIRMA</th>
            <th className="col-order-text">POZYCJE</th>
            <th className="col-order-text">UWAGI</th>
            <th className="col-order-text">WYDANIE</th>
            <th className="col-order-text">STATUS</th>
          </tr>
        </thead>
        <tbody>
          {orders.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>
                Brak zamówień drzwi wewnętrznych
              </td>
            </tr>
          ) : (
            orders.map((o) => {
              const orderItems = o.id !== undefined ? (itemsByOrder.get(o.id) ?? []) : []
              const isCancelled =
                typeof o.extra_fields === 'object' &&
                o.extra_fields !== null &&
                (o.extra_fields as Record<string, unknown>).cancelled === true
              const isReleased = Boolean(o.release_date && String(o.release_date).trim())
              const status = isCancelled ? 'cancelled' : isReleased ? 'released' : 'in_progress'
              const statusLabel = isCancelled ? 'Anulowane' : isReleased ? 'Wydane' : 'W realizacji'
              const totalQty = orderItems.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0)
              return (
                <tr
                  key={o.id ?? o.order_number}
                  onClick={() => onShowDetails(o)}
                  className="orders-table-row orders-table-row--clickable"
                >
                  <td className="col-order-text">{o.order_number}</td>
                  <td className="col-order-text">{o.company || '—'}</td>
                  <td className="col-order-text">
                    <span className="order-items-count">
                      {orderItems.length} poz.
                      {orderItems.length > 0 && (
                        <span className="order-items-total">({totalQty} szt)</span>
                      )}
                    </span>
                  </td>
                  <td className="col-order-text">{o.notes || '—'}</td>
                  <td className="col-order-text">{o.release_date || '—'}</td>
                  <td className="col-order-text">
                    <span
                      className={`order-status-badge ${
                        status === 'cancelled'
                          ? 'order-status-badge--cancelled'
                          : status === 'released'
                            ? 'order-status-badge--released'
                            : 'order-status-badge--in-progress'
                      }`}
                    >
                      {statusLabel}
                    </span>
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </TopScrollTableWrapper>
  )
}

export default InternalDoorOrdersTable
