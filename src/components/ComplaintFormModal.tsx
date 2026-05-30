import { createPortal } from 'react-dom'
import { WHAT_COMPLAINED_OPTIONS } from '../constants'
import type { ArchivedOrder, ComplaintFormData, Order } from '../types'

type ComplaintFormModalProps = {
  open: boolean
  complaintFormData: ComplaintFormData
  complaintFormLoading: boolean
  orders: Order[]
  archivedOrdersForComplaints: ArchivedOrder[]
  ordersForComplaintSelect: Array<{ id?: number | null; order_number: string; company: string; isArchived: boolean }>
  onClose: () => void
  onFormChange: (patch: Partial<ComplaintFormData>) => void
  onSelectOrder: (order: Order) => void
  onSelectArchived: (orderNumber: string, company: string) => void
  onSave: () => void
  submitOnEnterInInput: (e: React.KeyboardEvent<HTMLElement>, action: () => void) => void
}

export default function ComplaintFormModal({
  open,
  complaintFormData,
  complaintFormLoading,
  orders,
  archivedOrdersForComplaints,
  ordersForComplaintSelect,
  onClose,
  onFormChange,
  onSelectOrder,
  onSelectArchived,
  onSave,
  submitOnEnterInInput,
}: ComplaintFormModalProps) {
  if (!open) return null

  return createPortal(
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="order-modal order-modal--sta" onClick={(e) => e.stopPropagation()}>
        <div className="order-modal-header">
          <h2>Nowa reklamacja</h2>
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            onClick={onClose}
          >
            X
          </button>
        </div>
        <div
          className="order-form-grid order-form-grid--sta"
          onKeyDown={(e) => submitOnEnterInInput(e, () => void onSave())}
        >
          <label className="order-field-full">
            <span className="order-field-label-text">Zamówienie</span>
            <select
              value={(() => {
                if (complaintFormData.order_id != null) return `id:${complaintFormData.order_id}`
                if (complaintFormData.order_number) {
                  const isArch = archivedOrdersForComplaints.some(
                    (a) => a.order_number === complaintFormData.order_number,
                  )
                  if (isArch) return `arch:${complaintFormData.order_number}`
                }
                return ''
              })()}
              onChange={(e) => {
                const v = e.target.value
                if (!v) {
                  onFormChange({ order_id: null, order_number: '', company: '' })
                  return
                }
                if (v.startsWith('id:')) {
                  const id = Number(v.slice(3))
                  const o = orders.find((x) => x.id === id)
                  if (o) onSelectOrder(o)
                } else if (v.startsWith('arch:')) {
                  const orderNum = v.slice(5)
                  const a = archivedOrdersForComplaints.find((x) => x.order_number === orderNum)
                  if (a) onSelectArchived(a.order_number ?? '', a.company ?? '')
                }
              }}
            >
              <option value="">— wybierz —</option>
              {ordersForComplaintSelect.map((o) => {
                const key = o.isArchived ? `arch:${o.order_number}` : `id:${o.id}`
                const value = key
                const prefix = o.isArchived ? '📁 ' : ''
                const styleProp = o.isArchived ? { color: '#9ca3af' } : undefined
                return (
                  <option key={key} value={value} style={styleProp}>
                    {prefix}
                    {o.order_number} — {o.company}
                  </option>
                )
              })}
            </select>
            <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>📁 = zamówienie archiwalne</span>
          </label>
          <label className="order-field-full">
            <span className="order-field-label-text">Co reklamowane</span>
            <select
              value={complaintFormData.what_complained}
              onChange={(e) => onFormChange({ what_complained: e.target.value })}
            >
              <option value="">— wybierz —</option>
              {WHAT_COMPLAINED_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
          <label className="order-field-full">
            <span className="order-field-label-text">Powód</span>
            <textarea
              rows={3}
              value={complaintFormData.reason}
              onChange={(e) => onFormChange({ reason: e.target.value })}
            />
          </label>
        </div>
        <div className="order-form-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void onSave()}
            disabled={complaintFormLoading}
          >
            {complaintFormLoading ? 'Zapisywanie...' : 'Zapisz reklamację'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
