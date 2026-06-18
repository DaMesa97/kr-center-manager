import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../supabaseClient'
import type { PurchaseOrder, PurchaseOrderItem, ToastVariant, Warehouse, WarehouseComponent } from '../../types'

type Props = {
  open: boolean
  purchaseOrder: PurchaseOrder | null
  items: PurchaseOrderItem[]
  components: WarehouseComponent[]
  warehouses: Warehouse[]
  onClose: () => void
  onSaved: () => void
  pushToast: (msg: string, type: ToastVariant) => void
}

export default function PurchaseOrderReceiveModal({
  open,
  purchaseOrder,
  items,
  components,
  warehouses,
  onClose,
  onSaved,
  pushToast,
}: Props) {
  const [warehouseId, setWarehouseId] = useState<number | null>(null)
  const [referenceDoc, setReferenceDoc] = useState('')
  const [notes, setNotes] = useState('')
  const [receivedQty, setReceivedQty] = useState<Record<number, number>>({})
  const [saving, setSaving] = useState(false)

  // Reset stanu przy otwarciu — zapobiega kontaminacji danych między różnymi ZD
  useEffect(() => {
    if (open) {
      setWarehouseId(null)
      setReferenceDoc('')
      setNotes('')
      setReceivedQty({})
      setSaving(false)
    }
  }, [open, purchaseOrder?.id])

  const componentById = useMemo(() => new Map(components.map((c) => [c.id, c])), [components])

  const pendingItems = items.filter((i) => i.status_per_item === 'pending' || i.status_per_item === 'partial')

  const handleSave = async () => {
    if (!purchaseOrder || saving) return
    if (!warehouseId) {
      pushToast('Wybierz magazyn docelowy', 'error')
      return
    }
    const itemsPayload = pendingItems
      .filter((item) => receivedQty[item.id] !== undefined)
      .map((item) => ({
        po_item_id: item.id,
        quantity_received: Math.max(0, Number(receivedQty[item.id]) || 0),
      }))
    if (itemsPayload.every((ip) => ip.quantity_received === 0)) {
      pushToast('Wpisz co najmniej jedną ilość większą od 0', 'error')
      return
    }
    setSaving(true)
    const { error } = await supabase.rpc('receive_purchase_order', {
      p_po_id: purchaseOrder.id,
      p_warehouse_id: warehouseId,
      p_received_items: itemsPayload,
      p_reference_doc: referenceDoc.trim() || null,
      p_notes: notes.trim() || null,
    })
    setSaving(false)
    if (error) {
      pushToast(`Błąd przyjęcia dostawy: ${error.message}`, 'error')
      return
    }
    pushToast('Dostawa przyjęta', 'success')
    onSaved()
    onClose()
  }

  if (!open || !purchaseOrder) return null

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="order-modal" onClick={(e) => e.stopPropagation()} style={{ width: '90vw', maxWidth: 1180, minWidth: 1100 }}>
        <div className="order-modal-header">
          <h2>Przyjmij dostawę: {purchaseOrder.zd_number}</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose}>
            X
          </button>
        </div>

        <div className="order-form-grid order-form-grid--sta">
          <label>
            <span className="order-field-label-text">Magazyn docelowy *</span>
            <select
              value={warehouseId ?? ''}
              onChange={(e) => setWarehouseId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— wybierz —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="order-field-label-text">Numer dokumentu dostawy</span>
            <input value={referenceDoc} onChange={(e) => setReferenceDoc(e.target.value)} />
          </label>
          <label className="order-field-full">
            <span className="order-field-label-text">Notatki</span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>

        <div className="table-wrapper">
          <table className="orders-table">
            <thead>
              <tr>
                <th style={{ width: 'auto' }}>SKU</th>
                <th style={{ width: 80 }}>Zamów.</th>
                <th style={{ width: 80 }}>Otrzym.</th>
                <th style={{ width: 80 }}>Zostało</th>
                <th style={{ width: 100 }}>Dostawa</th>
                <th style={{ width: 230 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {pendingItems.map((item) => {
                const component = componentById.get(item.component_id)
                const left = Math.max(item.quantity_ordered - item.quantity_received, 0)
                const entered = Number(receivedQty[item.id] ?? 0)
                return (
                  <tr key={item.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{component?.name ?? `SKU #${item.component_id}`}</div>
                      <div style={{ fontSize: 11, color: '#666' }}>{component?.code ?? '—'}</div>
                    </td>
                    <td>{item.quantity_ordered}</td>
                    <td>{item.quantity_received}</td>
                    <td>{left}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        className="extension-qty-input"
                        value={receivedQty[item.id] ?? 0}
                        onChange={(e) =>
                          setReceivedQty((prev) => ({ ...prev, [item.id]: Math.max(0, Number(e.target.value) || 0) }))
                        }
                      />
                    </td>
                    <td>
                      {entered === 0
                        ? 'Brak — pozycja zostanie wisząca'
                        : entered === left
                          ? '🟢 Komplet'
                          : entered < left
                            ? `🟡 Częściowa, ${left - entered} szt zostanie wisząca`
                            : `⚠️ Nadwyżka ${entered - left} szt — sprawdź`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="order-form-actions">
          <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Zapisywanie...' : 'Zatwierdź przyjęcie'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Anuluj
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
