import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../supabaseClient'
import type {
  CompanySettings,
  CurrentUser,
  DbProfileRow,
  PurchaseOrder,
  PurchaseOrderItem,
  Supplier,
  ToastVariant,
  Warehouse,
  WarehouseComponent,
} from '../../types'
import { generateZdPdf } from '../../utils/zdPdfGenerator'
import { PURCHASE_ORDER_ITEM_STATUS_LABELS, PURCHASE_ORDER_STATUS_LABELS } from '../../constants'

type Props = {
  open: boolean
  purchaseOrder: PurchaseOrder | null
  items: PurchaseOrderItem[]
  suppliers: Supplier[]
  components: WarehouseComponent[]
  companySettings: CompanySettings | null
  warehouses: Warehouse[]
  isManager: boolean
  currentUser: CurrentUser | null
  profiles: DbProfileRow[]
  onClose: () => void
  onAfterAction: () => void
  onOpenReceive: (po: PurchaseOrder) => void
  pushToast: (msg: string, type: ToastVariant) => void
}

export default function PurchaseOrderDetailsModal({
  open,
  purchaseOrder,
  items,
  suppliers,
  components,
  companySettings,
  isManager,
  currentUser,
  profiles,
  onClose,
  onAfterAction,
  onOpenReceive,
  pushToast,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draftQtyByItem, setDraftQtyByItem] = useState<Record<number, number>>({})
  const [saving, setSaving] = useState(false)
  const canOperate = isManager || (currentUser?.role === 'worker' && currentUser.department === 'magazyn')

  useEffect(() => {
    setEditing(false)
    setDraftQtyByItem(
      items.reduce(
        (acc, item) => {
          acc[item.id] = item.quantity_ordered
          return acc
        },
        {} as Record<number, number>,
      ),
    )
  }, [purchaseOrder?.id, items])

  const supplier = useMemo(
    () => suppliers.find((s) => s.id === purchaseOrder?.supplier_id) ?? null,
    [suppliers, purchaseOrder?.supplier_id],
  )
  const componentById = useMemo(() => new Map(components.map((c) => [c.id, c])), [components])
  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles])

  const profileDisplayName = (profile: DbProfileRow): string => {
    const firstLast = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim()
    return firstLast || profile.full_name || profile.initials || profile.email || profile.user_email || '—'
  }

  const resolveUserLabel = (value: string | null) => {
    if (!value) return '—'
    const profile = profileById.get(value)
    if (profile) return profileDisplayName(profile)
    if (currentUser?.id === value) {
      return currentUser.full_name || currentUser.initials || currentUser.email || '—'
    }
    // If DB already stores readable value (e.g. initials/full_name), keep it.
    if (!value.includes('-')) return value
    return '—'
  }

  const totalPallets = useMemo(
    () =>
      items.reduce((sum, item) => {
        const c = componentById.get(item.component_id)
        if (!c?.units_per_pallet || c.units_per_pallet <= 0) return sum
        return sum + Math.ceil(item.quantity_ordered / c.units_per_pallet)
      }, 0),
    [items, componentById],
  )
  const tirFillness = useMemo(() => {
    if (!supplier?.requires_full_tir) return null
    const fill = items.reduce((sum, item) => {
      const c = componentById.get(item.component_id)
      if (!c?.units_per_pallet || !c?.pallets_per_full_tir || c.units_per_pallet <= 0 || c.pallets_per_full_tir <= 0) return sum
      return sum + Math.ceil(item.quantity_ordered / c.units_per_pallet) / c.pallets_per_full_tir
    }, 0)
    return fill
  }, [items, componentById, supplier])

  const generatePdf = async () => {
    if (!purchaseOrder || !supplier || !companySettings) {
      pushToast('Brak danych do wygenerowania PDF', 'error')
      return
    }
    try {
      await generateZdPdf(
        {
          zdNumber: purchaseOrder.zd_number,
          createdAt: purchaseOrder.created_at.slice(0, 10),
          expectedDelivery: purchaseOrder.expected_delivery_date,
          notes: purchaseOrder.notes,
          company: companySettings,
          supplier,
          items: items.map((item) => {
            const c = componentById.get(item.component_id)
            return {
              component_name: c?.name ?? `SKU #${item.component_id}`,
              component_code: c?.code ?? '—',
              quantity_ordered: item.quantity_ordered,
              units_per_pallet: c?.units_per_pallet ?? null,
              pallets_per_full_tir: c?.pallets_per_full_tir ?? null,
              notes: item.notes,
            }
          }),
          totalPallets,
          tirFillness,
        },
        'download',
      )
    } catch (error) {
      console.error('PDF gen failed (details modal):', error)
      pushToast(`Błąd generowania PDF: ${error instanceof Error ? error.message : 'nieznany błąd'}`, 'error')
    }
  }

  const saveDraftItems = async () => {
    if (!purchaseOrder || saving) return
    setSaving(true)
    for (const item of items) {
      const qty = Math.max(1, Number(draftQtyByItem[item.id] ?? item.quantity_ordered))
      const { error } = await supabase
        .from('purchase_order_items')
        .update({ quantity_ordered: qty })
        .eq('id', item.id)
      if (error) {
        setSaving(false)
        pushToast(`Błąd zapisu pozycji: ${error.message}`, 'error')
        return
      }
    }
    setSaving(false)
    setEditing(false)
    pushToast('Pozycje zamówienia zapisane', 'success')
    onAfterAction()
  }

  const markSent = async () => {
    if (!purchaseOrder) return
    const { error } = await supabase.rpc('mark_purchase_order_sent', { p_po_id: purchaseOrder.id })
    if (error) {
      pushToast(`Błąd: ${error.message}`, 'error')
      return
    }
    pushToast('Zamówienie oznaczone jako wysłane', 'success')
    onAfterAction()
  }

  const cancelOrder = async () => {
    if (!purchaseOrder) return
    if (!window.confirm('Anulować zamówienie?')) return
    const { error } = await supabase.rpc('cancel_purchase_order', { p_po_id: purchaseOrder.id })
    if (error) {
      pushToast(`Błąd: ${error.message}`, 'error')
      return
    }
    pushToast('Zamówienie anulowane', 'success')
    onAfterAction()
  }

  const cancelItem = async (itemId: number) => {
    const { error } = await supabase.rpc('cancel_purchase_order_item', { p_po_item_id: itemId })
    if (error) {
      pushToast(`Błąd: ${error.message}`, 'error')
      return
    }
    pushToast('Pozycja zamknięta', 'success')
    onAfterAction()
  }

  if (!open || !purchaseOrder) return null

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="order-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1150 }}>
        <div className="order-modal-header">
          <h2>
            Zamówienie: {purchaseOrder.zd_number}{' '}
            <span className={`po-status-badge po-status-badge--${purchaseOrder.status}`}>
              {PURCHASE_ORDER_STATUS_LABELS[purchaseOrder.status]}
            </span>
          </h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose}>
            X
          </button>
        </div>
        <p className="reorder-row-meta">
          Data utworzenia: {purchaseOrder.created_at.slice(0, 10)} | Wystawił:{' '}
          {resolveUserLabel(purchaseOrder.created_by)}{' '}
          {purchaseOrder.sent_at ? `| Wysłano: ${purchaseOrder.sent_at.slice(0, 10)}` : ''}
          {purchaseOrder.sent_by ? ` | Wysłał: ${resolveUserLabel(purchaseOrder.sent_by)}` : ''}
        </p>
        {supplier && (
          <div className="reorder-info-banner">
            Dostawca: <strong>{supplier.name}</strong> | Czas realizacji: {supplier.lead_time_days} dni | Pełny TIR:{' '}
            {supplier.requires_full_tir ? 'tak' : 'nie'}
          </div>
        )}
        {purchaseOrder.notes && (
          <div className="reorder-phase-banner" style={{ marginTop: 8 }}>
            Notatki: {purchaseOrder.notes}
          </div>
        )}
        <div className="table-wrapper">
          <table className="orders-table">
            <thead>
              <tr>
                <th style={{ width: 'auto' }}>SKU</th>
                <th style={{ width: 80 }}>Zamów.</th>
                <th style={{ width: 80 }}>Otrzym.</th>
                <th style={{ width: 120 }}>Status</th>
                <th style={{ width: 140 }}>Akcje</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const component = componentById.get(item.component_id)
                return (
                  <tr key={item.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{component?.name ?? `SKU #${item.component_id}`}</div>
                      <div style={{ fontSize: 11, color: '#666' }}>{component?.code ?? '—'}</div>
                    </td>
                    <td>
                      {editing && purchaseOrder.status === 'draft' && canOperate ? (
                        <input
                          type="number"
                          min={1}
                          className="extension-qty-input"
                          value={draftQtyByItem[item.id] ?? item.quantity_ordered}
                          onChange={(e) =>
                            setDraftQtyByItem((prev) => ({
                              ...prev,
                              [item.id]: Math.max(1, Number(e.target.value) || 1),
                            }))
                          }
                        />
                      ) : (
                        item.quantity_ordered
                      )}
                    </td>
                    <td>{item.quantity_received}</td>
                    <td>
                      <span className={`po-status-badge po-status-badge--item-${item.status_per_item}`}>
                        {PURCHASE_ORDER_ITEM_STATUS_LABELS[item.status_per_item]}
                      </span>
                    </td>
                    <td>
                      {canOperate &&
                        (item.status_per_item === 'pending' || item.status_per_item === 'partial') && (
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => void cancelItem(item.id)}
                          >
                            Zamknij pozycję
                          </button>
                        )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="order-form-actions">
          {purchaseOrder.status === 'draft' && canOperate && (
            <>
              {editing ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void saveDraftItems()}
                  disabled={saving}
                >
                  Zapisz pozycje
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setEditing(true)}
                >
                  Edytuj pozycje
                </button>
              )}
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void markSent()}>
                Oznacz jako wysłane
              </button>
            </>
          )}

          {(purchaseOrder.status === 'sent' || purchaseOrder.status === 'partial') && canOperate && (
            <button type="button" className="btn btn-primary" onClick={() => onOpenReceive(purchaseOrder)}>
              Przyjmij dostawę
            </button>
          )}

          {isManager &&
            (purchaseOrder.status === 'draft' ||
              purchaseOrder.status === 'sent' ||
              purchaseOrder.status === 'partial') && (
              <button type="button" className="btn btn-sm btn-danger" onClick={() => void cancelOrder()}>
                Anuluj zamówienie
              </button>
            )}

          <button type="button" className="btn btn-sm btn-primary" onClick={() => void generatePdf()}>
            Pobierz PDF
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Zamknij
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
