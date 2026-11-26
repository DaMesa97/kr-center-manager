import { useMemo, type MutableRefObject } from 'react'
import DataTable, { type DataTableColumn } from './DataTable'
import {
  OPTIMA_BAZA_LABEL,
  cancelledReason,
  formatOptimaDateTime,
  isOptimaOrder,
  isOrderCancelled,
  optimaBaza,
  summarizeItems,
  wingCount,
} from '../lib/optimaRo'
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
  if (isOrderCancelled(o)) return 'cancelled'
  return o.release_date && String(o.release_date).trim() ? 'released' : 'in_progress'
}

/** Plakietka źródła: z której bazy Optimy przyszło RO albo „Ręczne". */
export function OptimaSourceBadge({ order }: { order: Order }) {
  if (!isOptimaOrder(order)) return <span className="optima-badge optima-badge--manual">Ręczne</span>
  const baza = optimaBaza(order)
  return (
    <span
      className={`optima-badge optima-badge--${baza === 'MR' ? 'mr' : 'kr'}`}
      title={`Zlecenie z Optimy — rezerwacja odbiorcy w bazie ${baza ? OPTIMA_BAZA_LABEL[baza] : '?'}`}
    >
      {baza ? OPTIMA_BAZA_LABEL[baza] : 'Optima'}
    </span>
  )
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
    const unmappedOf = (o: Order) => itemsOf(o).filter((it) => it.component_id == null).length
    const wingsOf = (o: Order) => wingCount(o, summarizeItems(itemsOf(o)))
    return [
      {
        key: 'nr',
        label: 'NR / RO',
        className: 'col-order-text',
        sortValue: (o) => o.order_number,
        render: (o) => <strong>{o.order_number}</strong>,
      },
      {
        key: 'baza',
        label: 'ŹRÓDŁO',
        className: 'col-order-text',
        sortValue: (o) => (isOptimaOrder(o) ? optimaBaza(o) ?? 'Optima' : 'Ręczne'),
        render: (o) => <OptimaSourceBadge order={o} />,
      },
      { key: 'company', label: 'FIRMA', className: 'col-order-text', sortValue: (o) => o.company, render: (o) => o.company || '—' },
      {
        key: 'client',
        label: 'NR ZAM. KLIENTA',
        className: 'col-order-text',
        sortValue: (o) => o.client_order_number,
        render: (o) => o.client_order_number || '—',
      },
      {
        key: 'date',
        label: 'DATA',
        className: 'col-order-text',
        title: 'Data zamówienia — przy zleceniach z Optimy data wystawienia RO',
        sortValue: (o) => o.order_date ?? '',
        render: (o) => (o.order_date ? formatOptimaDateTime(o.order_date) : '—'),
      },
      {
        key: 'wings',
        label: 'SKRZYDŁA',
        className: 'col-order-text',
        align: 'right',
        title: 'Liczba skrzydeł (przy RO z Optimy liczy import); 0 = same ościeżnice / akcesoria',
        sortValue: (o) => wingsOf(o),
        tdTitle: (o) => {
          const n = itemsOf(o).length
          return n > 0 ? `${n} poz. w zleceniu` : undefined
        },
        render: (o) => {
          const n = wingsOf(o)
          if (n > 0) return <strong>{n}</strong>
          const s = summarizeItems(itemsOf(o))
          return <span className="muted">{s.frames > 0 ? 'ościeżnice' : '—'}</span>
        },
      },
      {
        key: 'unmapped',
        label: 'BEZ KOMPONENTU',
        className: 'col-order-text',
        title: 'Pozycje z Optimy, których kodu nie powiązano z komponentem magazynu — przy wydaniu zostaną pominięte',
        sortValue: (o) => unmappedOf(o),
        render: (o) => {
          const n = unmappedOf(o)
          return n > 0 ? (
            <span className="optima-unmapped-badge" title="Otwórz zlecenie i kliknij „Powiąż z komponentem” przy pozycji">
              ⚠ {n}
            </span>
          ) : (
            <span className="muted">—</span>
          )
        },
      },
      {
        key: 'status',
        label: 'STATUS',
        className: 'col-order-text',
        sortValue: (o) => STATUS_LABEL[orderStatus(o)],
        tdTitle: (o) => (orderStatus(o) === 'cancelled' ? cancelledReason(o) || 'Anulowane' : undefined),
        render: (o) => {
          const status = orderStatus(o)
          return (
            <span className={`order-status-badge ${STATUS_BADGE[status]}`}>
              {status === 'cancelled' && isOptimaOrder(o) ? 'Anulowane w Optimie' : STATUS_LABEL[status]}
              {status === 'released' && o.release_date ? ` ${formatOptimaDateTime(String(o.release_date))}` : ''}
            </span>
          )
        },
      },
      { key: 'notes', label: 'UWAGI', className: 'col-order-text col-notes', sortValue: (o) => o.notes, render: (o) => o.notes || '—' },
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
      rowClassName={(o) => `orders-table-row orders-table-row--clickable${isOrderCancelled(o) ? ' int-door-row--cancelled' : ''}`}
      rowTitle={(o) => (isOrderCancelled(o) ? cancelledReason(o) || 'Anulowane' : undefined)}
      onRowClick={(o) => onShowDetails(o)}
    />
  )
}

export default InternalDoorOrdersTable
