import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../supabaseClient'
import DeleteConfirmDialog from './DeleteConfirmDialog'
import { mergeOrderExtraFields } from '../utils'
import type { InternalDoorItem, Order, ToastVariant } from '../types'

type DetailsUser = {
  role: 'manager' | 'worker' | 'sprzedawca'
  department: 'all' | 'bastion' | 'stalowe' | 'magazyn'
  id: string
  initials: string
}

type Props = {
  open: boolean
  order: Order
  items: InternalDoorItem[]
  currentUser: DetailsUser
  onClose: () => void
  onEdit: (order: Order) => void
  onAfterAction: () => void | Promise<void>
  pushToast: (message: string, variant: ToastVariant) => void
}

function InternalDoorOrderDetailsModal({
  open,
  order,
  items,
  currentUser,
  onClose,
  onEdit,
  onAfterAction,
  pushToast,
}: Props) {
  const [confirmState, setConfirmState] = useState<{
    message: string
    title: string
    confirmLabel: string
    run: () => Promise<void>
  } | null>(null)

  const isCancelled = Boolean(
    order?.extra_fields &&
      typeof order.extra_fields === 'object' &&
      (order.extra_fields as Record<string, unknown>).cancelled === true,
  )
  const isReleased = Boolean(order.release_date && String(order.release_date).trim())
  const isInProgress = !isCancelled && !isReleased

  const cancelledInfo = useMemo(() => {
    const extra =
      order.extra_fields && typeof order.extra_fields === 'object'
        ? (order.extra_fields as Record<string, unknown>)
        : null
    return {
      at: String(extra?.cancelled_at ?? '').trim(),
      by: String(extra?.cancelled_by ?? '').trim(),
    }
  }, [order.extra_fields])

  const statusLabel = isCancelled ? 'Anulowane' : isReleased ? 'Wydane' : 'W realizacji'
  const statusClass = isCancelled
    ? 'order-status-badge--cancelled'
    : isReleased
      ? 'order-status-badge--released'
      : 'order-status-badge--in-progress'

  const formatItemMeta = (item: InternalDoorItem) => {
    const itemData = item as InternalDoorItem & {
      component_product_category?: string | null
      component_door_model?: string | null
      component_door_size?: string | null
      component_door_direction?: string | null
      component_door_color?: string | null
      component_door_frame_type?: string | null
      component_door_frame_code?: string | null
      component_door_handle_shield?: string | null
    }
    const category = String(item.component_category ?? itemData.component_product_category ?? '')
    const model = String(itemData.component_door_model ?? '').trim()
    const size = String(itemData.component_door_size ?? '').trim()
    const direction = String(itemData.component_door_direction ?? '').trim()
    const color = String(itemData.component_door_color ?? '').trim()
    const frameType = String(itemData.component_door_frame_type ?? '').trim()
    const frameCode = String(itemData.component_door_frame_code ?? '').trim()
    const shield = String(itemData.component_door_handle_shield ?? '').trim()

    if (category === 'door_wing') {
      return ['Skrzydło', model || '—', size || '—', direction || '—', color || '—'].join(' · ')
    }
    if (category === 'door_frame') {
      if (frameType === 'adjustable') {
        return ['Ościeżnica regulowana', frameCode || '—', color || '—', size || '—', direction || '—'].join(' · ')
      }
      return ['Ościeżnica prosta', color || '—', size || '—', direction || '—'].join(' · ')
    }
    if (category === 'door_handle') {
      return ['Klamka', model || '—', color || '—', shield || '—'].join(' · ')
    }
    if (category === 'door_hinge_cover') {
      return ['Osłonka', color || '—'].join(' · ')
    }
    return String(item.component_name ?? '').trim()
  }

  const requestRelease = () => {
    setConfirmState({
      title: 'Wydaj zamówienie',
      confirmLabel: 'Wydaj',
      message: `Czy na pewno wydać zamówienie #${order.order_number} dla firmy ${order.company}?`,
      run: async () => {
        const today = new Date().toISOString().slice(0, 10)
        const { error } = await supabase.from('orders').update({ release_date: today }).eq('id', order.id!)
        if (error) {
          pushToast(`Błąd wydania zamówienia: ${error.message}`, 'error')
          return
        }
        pushToast('Zamówienie wydane', 'success')
        await onAfterAction()
        onClose()
      },
    })
  }

  const requestCancel = () => {
    setConfirmState({
      title: 'Anuluj zamówienie',
      confirmLabel: 'Anuluj zamówienie',
      message: `Czy na pewno anulować zamówienie #${order.order_number}? Stock zostanie zwrócony do magazynu.`,
      run: async () => {
        const { error: retErr } = await supabase.rpc('return_stock_for_order', { p_order_id: order.id! })
        if (retErr) {
          pushToast(`Błąd zwrotu stocku: ${retErr.message}`, 'error')
          return
        }
        const cancelledAt = new Date().toISOString()
        const cancelledBy = currentUser.initials
        const newExtra = mergeOrderExtraFields(order.extra_fields, {
          cancelled: true,
          cancelled_at: cancelledAt,
          cancelled_by: cancelledBy,
        })
        const { error: updErr } = await supabase
          .from('orders')
          .update({ extra_fields: newExtra })
          .eq('id', order.id!)
        if (updErr) {
          pushToast(`Błąd anulowania zamówienia: ${updErr.message}`, 'error')
          return
        }
        pushToast('Zamówienie anulowane, stock zwrócony', 'success')
        await onAfterAction()
        onClose()
      },
    })
  }

  if (!open) return null

  return createPortal(
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="order-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 860 }}>
          <div className="order-modal-header">
            <h2>
              Zamówienie #{order.order_number} — {order.company || '—'}
            </h2>
            <button className="btn btn-icon btn-ghost" onClick={onClose}>
              ×
            </button>
          </div>
                    <div className="internal-door-details-section">
            <span className={`order-status-badge ${statusClass}`}>{statusLabel}</span>
          </div>

          {isCancelled && (
            <div className="internal-door-details-meta-info">
              Anulowano {cancelledInfo.at || '—'} przez {cancelledInfo.by || '—'}
            </div>
          )}
          {isReleased && <div className="internal-door-details-meta-info">Wydano {order.release_date}</div>}

          {String((order as unknown as Record<string, unknown>).wentylacja ?? '').trim() && (
            <div className="internal-door-details-section">
              <h4>Wentylacja</h4>
              <div>{String((order as unknown as Record<string, unknown>).wentylacja)}</div>
            </div>
          )}

          {String(order.notes ?? '').trim() && (
            <div className="internal-door-details-section">
              <h4>Uwagi</h4>
              <div>{order.notes}</div>
            </div>
          )}

          <div className="internal-door-details-section">
            <h4>Pozycje</h4>
            {items.length === 0 ? (
              <p className="no-results">Brak pozycji dla zamówienia.</p>
            ) : (
              items.map((item) => (
                <div key={item.id} className="internal-door-details-item">
                  <div className="internal-door-details-item-main">
                    <div className="internal-door-details-item-name">{item.component_name ?? 'Komponent'}</div>
                    <div className="internal-door-details-item-meta">{formatItemMeta(item)}</div>
                    {item.shorten_enabled && item.shorten_target_height && (
                      <div className="internal-door-details-item-shorten">
                        Skrócenie do {item.shorten_target_height} mm
                      </div>
                    )}
                    {item.notes && (
                      <div className="internal-door-details-item-meta">Uwagi: {item.notes}</div>
                    )}
                  </div>
                  <div className="internal-door-details-item-qty">{item.quantity} szt.</div>
                </div>
              ))
            )}
          </div>

          <div className="order-form-actions">
            {isInProgress && currentUser.role === 'manager' && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => {
                  onEdit(order)
                  onClose()
                }}
              >
                Edytuj
              </button>
            )}
            {isInProgress &&
              (currentUser.role === 'manager' ||
                (currentUser.role === 'worker' && currentUser.department === 'magazyn')) && (
                <button type="button" className="btn btn-primary" onClick={requestRelease}>
                  ✓ Wydane
                </button>
              )}
            {isInProgress && currentUser.role === 'manager' && (
              <button type="button" className="btn btn-danger" onClick={requestCancel}>
                Anuluj zamówienie
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Zamknij
            </button>
          </div>
        </div>
      </div>

      {confirmState && (
        <DeleteConfirmDialog
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          cancelLabel="Wróć"
          onCancel={() => setConfirmState(null)}
          onConfirm={() => {
            const run = confirmState.run
            setConfirmState(null)
            void run()
          }}
        />
      )}
    </>,
    document.body,
  )
}

export default InternalDoorOrderDetailsModal
