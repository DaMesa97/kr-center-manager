import type { Order } from '../types'

type Props = {
  order: Order
  counts?: { total: number; unread: number }
  onOpen: (order: Order) => void
}

/** 💬 przy numerze zlecenia: licznik komentarzy + kropka nieprzeczytanych. */
export default function OrderCommentsButton({ order, counts, onOpen }: Props) {
  const total = counts?.total ?? 0
  const unread = counts?.unread ?? 0
  return (
    <button
      type="button"
      className={`btn btn-sm btn-ghost order-comments-inline-btn ${unread > 0 ? 'order-comments-inline-btn--unread' : ''} ${
        total === 0 ? 'order-comments-inline-btn--empty' : ''
      }`}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(order)
      }}
      title={
        total === 0
          ? 'Dodaj komentarz'
          : unread > 0
            ? `${total} komentarzy · ${unread} nieprzeczytanych`
            : `${total} komentarzy`
      }
    >
      <span className="order-comments-inline-icon">
        💬
        {unread > 0 && <span className="order-comments-inline-dot" />}
      </span>
      {total > 0 && <span className="order-comments-inline-count">{total}</span>}
    </button>
  )
}
