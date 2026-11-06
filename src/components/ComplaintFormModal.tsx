import { createPortal } from 'react-dom'
import { useUnsavedGuard } from '../lib/useUnsavedGuard'
import SearchableSelect from './SearchableSelect'
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
  onSelectArchived: (archived: ArchivedOrder) => void
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
  const { requestClose } = useUnsavedGuard(complaintFormData, onClose, { enabled: !complaintFormLoading, escape: open, resetKey: open })
  if (!open) return null

  return createPortal(
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={() => void requestClose()}
    >
      <div className="order-modal order-modal--sta" onClick={(e) => e.stopPropagation()}>
        <div className="order-modal-header">
          <h2>Nowa reklamacja</h2>
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            onClick={() => void requestClose()}
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
            {/* #97/#107: lista zleceń z wyszukiwaniem po numerze i firmie zamiast
                zwykłego selecta z tysiącem pozycji */}
            {(() => {
              type Entry = (typeof ordersForComplaintSelect)[number]
              const labelFor = (o: Entry) => `${o.isArchived ? '📁 ' : ''}${o.order_number} — ${o.company}`
              const byLabel = new Map<string, Entry>()
              for (const o of ordersForComplaintSelect) byLabel.set(labelFor(o), o)
              const current = (() => {
                if (complaintFormData.order_id != null) {
                  return ordersForComplaintSelect.find((o) => !o.isArchived && o.id === complaintFormData.order_id)
                }
                if (complaintFormData.order_number) {
                  return ordersForComplaintSelect.find((o) => o.isArchived && o.order_number === complaintFormData.order_number)
                }
                return undefined
              })()
              return (
                <SearchableSelect
                  value={current ? labelFor(current) : ''}
                  options={[...byLabel.keys()]}
                  placeholder="— wpisz numer zlecenia lub firmę —"
                  onChange={(label) => {
                    const o = byLabel.get(label)
                    if (!o) {
                      onFormChange({ order_id: null, order_number: '', company: '' })
                      return
                    }
                    if (o.isArchived) {
                      const a = archivedOrdersForComplaints.find((x) => x.order_number === o.order_number)
                      if (a) onSelectArchived(a)
                    } else {
                      const full = orders.find((x) => x.id === o.id)
                      if (full) onSelectOrder(full)
                    }
                  }}
                />
              )
            })()}
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
