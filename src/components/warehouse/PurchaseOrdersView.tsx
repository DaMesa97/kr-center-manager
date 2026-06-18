import { useMemo, useState } from 'react'
import type {
  CompanySettings,
  CurrentUser,
  PurchaseOrder,
  PurchaseOrderItem,
  Supplier,
  ToastVariant,
  Warehouse,
  WarehouseComponent,
} from '../../types'
import { generateZdPdf } from '../../utils/zdPdfGenerator'
import { PURCHASE_ORDER_STATUS_LABELS } from '../../constants'
import Spinner from '../Spinner'

type Props = {
  purchaseOrders: PurchaseOrder[]
  purchaseOrderItems: PurchaseOrderItem[]
  loading: boolean
  suppliers: Supplier[]
  components: WarehouseComponent[]
  companySettings: CompanySettings | null
  warehouses: Warehouse[]
  isManager: boolean
  currentUser: CurrentUser | null
  onShowDetails: (po: PurchaseOrder) => void
  pushToast: (msg: string, type: ToastVariant) => void
}

type StatusFilter = 'all' | PurchaseOrder['status']

export default function PurchaseOrdersView({
  purchaseOrders,
  purchaseOrderItems,
  loading,
  suppliers,
  components,
  companySettings,
  onShowDetails,
  pushToast,
}: Props) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [supplierFilter, setSupplierFilter] = useState<number | 'all'>('all')

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers])
  const componentById = useMemo(() => new Map(components.map((c) => [c.id, c])), [components])
  const itemCountByPo = useMemo(() => {
    const map = new Map<number, number>()
    for (const item of purchaseOrderItems) {
      map.set(item.purchase_order_id, (map.get(item.purchase_order_id) ?? 0) + 1)
    }
    return map
  }, [purchaseOrderItems])

  const counts = useMemo(() => {
    return {
      all: purchaseOrders.length,
      draft: purchaseOrders.filter((p) => p.status === 'draft').length,
      sent: purchaseOrders.filter((p) => p.status === 'sent').length,
      partial: purchaseOrders.filter((p) => p.status === 'partial').length,
      completed: purchaseOrders.filter((p) => p.status === 'completed').length,
      cancelled: purchaseOrders.filter((p) => p.status === 'cancelled').length,
    }
  }, [purchaseOrders])

  const filtered = useMemo(
    () =>
      purchaseOrders.filter((po) => {
        if (statusFilter !== 'all' && po.status !== statusFilter) return false
        if (supplierFilter !== 'all' && po.supplier_id !== supplierFilter) return false
        return true
      }),
    [purchaseOrders, statusFilter, supplierFilter],
  )

  const handlePdf = async (po: PurchaseOrder) => {
    const supplier = supplierById.get(po.supplier_id)
    if (!supplier || !companySettings) return
    const items = purchaseOrderItems.filter((it) => it.purchase_order_id === po.id)
    const totalPallets = items.reduce((sum, item) => {
      const c = componentById.get(item.component_id)
      if (!c?.units_per_pallet || c.units_per_pallet <= 0) return sum
      return sum + Math.ceil(item.quantity_ordered / c.units_per_pallet)
    }, 0)
    const tirFillness = supplier.requires_full_tir
      ? items.reduce((sum, item) => {
          const c = componentById.get(item.component_id)
          if (!c?.units_per_pallet || !c?.pallets_per_full_tir || c.units_per_pallet <= 0 || c.pallets_per_full_tir <= 0) return sum
          return sum + Math.ceil(item.quantity_ordered / c.units_per_pallet) / c.pallets_per_full_tir
        }, 0)
      : null
    try {
      await generateZdPdf(
        {
          zdNumber: po.zd_number,
          createdAt: po.created_at.slice(0, 10),
          expectedDelivery: po.expected_delivery_date,
          notes: po.notes,
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
      console.error('PDF gen failed (orders view):', error)
      pushToast(`Błąd generowania PDF: ${error instanceof Error ? error.message : 'nieznany błąd'}`, 'error')
    }
  }

  return (
    <div className="reorder-dashboard">
      <div className="reorder-header">
        <h2>Zamówienia do dostawców</h2>
      </div>

      <div className="alerts-filter-pills">
        <button type="button" className={`alerts-filter-pill ${statusFilter === 'all' ? 'alerts-filter-pill--active' : ''}`} onClick={() => setStatusFilter('all')}>
          Wszystkie <span className="alerts-filter-pill-count">{counts.all}</span>
        </button>
        {(['draft', 'sent', 'partial', 'completed', 'cancelled'] as const).map((status) => (
          <button
            key={status}
            type="button"
            className={`alerts-filter-pill ${statusFilter === status ? 'alerts-filter-pill--active' : ''}`}
            onClick={() => setStatusFilter(status)}
          >
            {PURCHASE_ORDER_STATUS_LABELS[status]} <span className="alerts-filter-pill-count">{counts[status]}</span>
          </button>
        ))}
      </div>

      <div className="orders-filters" style={{ marginTop: 8 }}>
        <select
          className="day-filter"
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
        >
          <option value="all">Wszyscy dostawcy</option>
          {suppliers
            .filter((s) => s.is_active)
            .map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
        </select>
      </div>

      <div className="table-wrapper">
        {loading && <Spinner center label="Ładowanie zamówień do dostawców…" />}
        <table className="orders-table">
          <thead>
            <tr>
              <th style={{ width: 150 }}>Numer ZD</th>
              <th style={{ width: 'auto' }}>Dostawca</th>
              <th style={{ width: 120 }}>Utworzono</th>
              <th style={{ width: 120 }}>Dostawa</th>
              <th style={{ width: 70 }}>Poz.</th>
              <th style={{ width: 120 }}>Status</th>
              <th style={{ width: 140 }}>Akcje</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((po) => (
              <tr key={po.id}>
                <td>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => onShowDetails(po)}>
                    {po.zd_number}
                  </button>
                </td>
                <td>{supplierById.get(po.supplier_id)?.name ?? '—'}</td>
                <td>{po.created_at.slice(0, 10)}</td>
                <td>{po.expected_delivery_date ?? '—'}</td>
                <td>{itemCountByPo.get(po.id) ?? 0}</td>
                <td>
                  <span className={`po-status-badge po-status-badge--${po.status}`}>
                    {PURCHASE_ORDER_STATUS_LABELS[po.status]}
                  </span>
                </td>
                <td>
                  <div className="contractor-actions">
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => onShowDetails(po)}>
                      Szczegóły
                    </button>
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => void handlePdf(po)}>
                      PDF
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="no-results">
            Brak zamówień. Pierwsze zamówienia pojawią się po wygenerowaniu z listy zakupowej w sekcji
            Zamawianie.
          </p>
        )}
      </div>
    </div>
  )
}
