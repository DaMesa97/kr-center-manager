import { useMemo, type MutableRefObject } from 'react'
import DataTable, { type DataTableColumn } from './DataTable'
import type { Order, InternalDoorItem } from '../types'

type Props = {
  orders: Order[]
  items: InternalDoorItem[]
  onShowDetails: (o: Order) => void
  tableWrapperRef: MutableRefObject<HTMLDivElement | null>
}

type Status = 'cancelled' | 'released' | 'in_progress'

const STATUS_LABEL: Record<Status, string> = {
  cancelled: 'Anulowane',
  released: 'Wydane',
  in_progress: 'W realizacji',
}

const STATUS_BADGE: Record<Status, string> = {
  cancelled: 'order-status-badge--cancelled',
  released: 'order-status-badge--released',
  in_progress: 'order-status-badge--in-progress',
}

function orderStatus(o: Order): Status {
  const isCancelled =
    typeof o.extra_fields === 'object' &&
    o.extra_fields !== null &&
    (o.extra_fields as Record<string, unknown>).cancelled === true
  if (isCancelled) return 'cancelled'
  return o.release_date && String(o.release_date).trim() ? 'released' : 'in_progress'
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

  const columns = useMemo<DataTableColumn<Order>[]>(() => {
    const itemsOf = (o: Order) => (o.id !== undefined ? (itemsByOrder.get(o.id) ?? []) : [])
    return [
      { key: 'nr', label: 'NR', className: 'col-order-text', sortValue: (o) => o.order_number, render: (o) => o.order_number },
      { key: 'company', label: 'FIRMA', className: 'col-order-text', sortValue: (o) => o.company, render: (o) => o.company || '—' },
      {
        key: 'items',
        label: 'POZYCJE',
        className: 'col-order-text',
        sortValue: (o) => itemsOf(o).length,
        render: (o) => {
          const orderItems = itemsOf(o)
          const totalQty = orderItems.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0)
          return (
            <span className="order-items-count">
              {orderItems.length} poz.
              {orderItems.length > 0 && <span className="order-items-total">({totalQty} szt)</span>}
            </span>
          )
        },
      },
      { key: 'notes', label: 'UWAGI', className: 'col-order-text', sortValue: (o) => o.notes, render: (o) => o.notes || '—' },
      {
        key: 'release',
        label: 'WYDANIE',
        className: 'col-order-text',
        sortValue: (o) => o.release_date,
        render: (o) => o.release_date || '—',
      },
      {
        key: 'status',
        label: 'STATUS',
        className: 'col-order-text',
        sortValue: (o) => STATUS_LABEL[orderStatus(o)],
        render: (o) => {
          const status = orderStatus(o)
          return <span className={`order-status-badge ${STATUS_BADGE[status]}`}>{STATUS_LABEL[status]}</span>
        },
      },
    ]
  }, [itemsByOrder])

  return (
    <DataTable
      rows={orders}
      rowKey={(o) => o.id ?? o.order_number}
      columns={columns}
      wrapperClassName="orders-table-wrapper"
      tableWrapperRef={tableWrapperRef}
      emptyText="Brak zamówień drzwi wewnętrznych"
      rowClassName={() => 'orders-table-row orders-table-row--clickable'}
      onRowClick={(o) => onShowDetails(o)}
    />
  )
}

export default InternalDoorOrdersTable
