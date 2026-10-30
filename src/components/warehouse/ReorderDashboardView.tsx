import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type {
  IncomingStockRow,
  ShoppingListItem,
  SmartRopRow,
  Supplier,
  WarehouseComponent,
  WarehouseStockRow,
} from '../../types'
import Spinner from '../Spinner'
import { computeReorder, type ReorderStatus } from '../../lib/reorder'

type Row = {
  component: WarehouseComponent
  smartRow: SmartRopRow | null
  effective_min_stock: number | null
  effective_target_stock: number | null
  current_stock: number
  /** zarezerwowane pod zlecenia (informacyjnie — nie wchodzi do pozycji) */
  reserved: number
  /** w drodze z otwartych ZD — wchodzi do pozycji zapasu */
  incoming: IncomingStockRow | null
  supplier: Supplier | null
  lead_time_days: number | null
  status: ReorderStatus
  suggested_qty: number | null
}

type Props = {
  components: WarehouseComponent[]
  suppliers: Supplier[]
  stock: WarehouseStockRow[]
  /** niedostarczone pozycje wysłanych ZD (get_incoming_stock_per_component) */
  incoming?: IncomingStockRow[]
  componentsLoading?: boolean
  stockLoading?: boolean
  smartRopData: SmartRopRow[]
  smartRopLoading: boolean
  isManager: boolean
  onAddToShoppingList: (item: ShoppingListItem) => void
  shoppingList: ShoppingListItem[]
  onOpenShoppingList: () => void
  onEditComponent: (component: WarehouseComponent) => void
}

function isDoorsInternal(category: string | null | undefined): boolean {
  return ['door_wing', 'door_frame', 'door_handle', 'door_hinge_cover'].includes(category ?? '')
}

function getCategoryFilterLabel(filter: 'all' | 'raw' | 'doors_internal'): string {
  if (filter === 'raw') return 'Surowce'
  if (filter === 'doors_internal') return 'Drzwi wewn.'
  return 'Wszystkie kategorie'
}

function fmtEta(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}

function sortByLeadAndStock(a: Row, b: Row): number {
  const aLead = a.lead_time_days
  const bLead = b.lead_time_days
  if (aLead == null && bLead != null) return 1
  if (aLead != null && bLead == null) return -1
  if (aLead != null && bLead != null && aLead !== bLead) return bLead - aLead
  return a.current_stock - b.current_stock
}

export default function ReorderDashboardView({
  components,
  suppliers,
  stock,
  incoming = [],
  componentsLoading = false,
  stockLoading = false,
  smartRopData,
  smartRopLoading,
  isManager,
  onAddToShoppingList,
  shoppingList,
  onOpenShoppingList,
  onEditComponent,
}: Props) {
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'raw' | 'doors_internal'>('all')
  const [showNoThreshold, setShowNoThreshold] = useState(false)
  const [showOk, setShowOk] = useState(false)
  // Szukanie po nazwie/kodzie/dostawcy i filtr dostawcy — bez progów min
  // wszystko ląduje w zwiniętym „Brak progu", więc bez tego nie da się
  // niczego znaleźć ani zamówić po dostawcy
  const [query, setQuery] = useState('')
  const [supplierFilter, setSupplierFilter] = useState<number | ''>('')
  const filterActive = query.trim() !== '' || supplierFilter !== ''
  // Niestandardowe ilości dla sekcji OK i brak progu
  const [customQty, setCustomQty] = useState<Record<number, string>>({})

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers])
  const supplierOptions = useMemo(() => {
    const counts = new Map<number, number>()
    for (const c of components) {
      if (c.is_active && c.supplier_id) counts.set(c.supplier_id, (counts.get(c.supplier_id) ?? 0) + 1)
    }
    return suppliers
      .filter((s) => s.is_active || counts.has(s.id))
      .map((s) => ({ supplier: s, count: counts.get(s.id) ?? 0 }))
      .sort((a, b) => a.supplier.name.localeCompare(b.supplier.name, 'pl'))
  }, [components, suppliers])
  const shoppingIds = useMemo(() => new Set(shoppingList.map((s) => s.component_id)), [shoppingList])
  const smartRopByComponentId = useMemo(
    () => new Map(smartRopData.map((row) => [row.component_id, row])),
    [smartRopData],
  )

  const incomingByComponent = useMemo(() => new Map(incoming.map((i) => [i.component_id, i])), [incoming])

  const rows = useMemo(() => {
    const stockSumByComponent = new Map<number, number>()
    const reservedByComponent = new Map<number, number>()
    for (const s of stock) {
      stockSumByComponent.set(s.component_id, (stockSumByComponent.get(s.component_id) ?? 0) + Number(s.quantity || 0))
      reservedByComponent.set(s.component_id, (reservedByComponent.get(s.component_id) ?? 0) + Number(s.reserved_quantity || 0))
    }

    const q = query.trim().toLowerCase()
    const source = components.filter((c) => {
      if (categoryFilter === 'raw' && !(c.product_category === 'raw' || c.product_category == null)) return false
      if (categoryFilter === 'doors_internal' && !isDoorsInternal(c.product_category)) return false
      if (supplierFilter !== '' && c.supplier_id !== supplierFilter) return false
      if (q) {
        const supplierName = c.supplier_id ? supplierById.get(c.supplier_id)?.name ?? '' : ''
        return (
          c.name.toLowerCase().includes(q) ||
          (c.code ?? '').toLowerCase().includes(q) ||
          supplierName.toLowerCase().includes(q)
        )
      }
      return true
    })

    return source.map((component) => {
      const currentStock = stockSumByComponent.get(component.id) ?? 0
      const supplier = component.supplier_id ? supplierById.get(component.supplier_id) ?? null : null
      const leadTime = supplier?.lead_time_days ?? null
      const smartRow = smartRopByComponentId.get(component.id) ?? null
      const effectiveMin = smartRow?.effective_min_stock ?? component.min_stock_level ?? null
      const effectiveTarget = smartRow?.effective_target_stock ?? component.target_stock_level ?? null
      const inc = incomingByComponent.get(component.id) ?? null
      // pozycja = stan + w drodze; status i ilość liczy lib/reorder (wspólna arytmetyka)
      const { status, suggested } = computeReorder({
        stock: currentStock,
        incoming: inc?.incoming_qty ?? 0,
        min: effectiveMin,
        target: effectiveTarget,
        unitsPerPallet: component.units_per_pallet ?? null,
      })

      return {
        component,
        smartRow,
        effective_min_stock: effectiveMin,
        effective_target_stock: effectiveTarget,
        current_stock: currentStock,
        reserved: reservedByComponent.get(component.id) ?? 0,
        incoming: inc,
        supplier,
        lead_time_days: leadTime,
        status,
        suggested_qty: suggested,
      } as Row
    })
  }, [components, stock, supplierById, categoryFilter, smartRopByComponentId, query, supplierFilter, incomingByComponent])

  const noThresholdSkus = useMemo(
    () => rows.filter((r) => r.status === 'no_threshold').sort((a, b) => a.component.name.localeCompare(b.component.name, 'pl')),
    [rows],
  )
  const criticalSkus = useMemo(() => rows.filter((r) => r.status === 'critical').sort(sortByLeadAndStock), [rows])
  const observeSkus = useMemo(() => rows.filter((r) => r.status === 'observe').sort(sortByLeadAndStock), [rows])
  const okSkus = useMemo(
    () => rows.filter((r) => r.status === 'ok').sort((a, b) => a.component.name.localeCompare(b.component.name, 'pl')),
    [rows],
  )

  const categoryCounts = useMemo(() => {
    const all = components.length
    const raw = components.filter((c) => c.product_category === 'raw' || c.product_category == null).length
    const doorsInternal = components.filter((c) => isDoorsInternal(c.product_category)).length
    return { all, raw, doors_internal: doorsInternal }
  }, [components])

  const smartCount = useMemo(() => smartRopData.filter((r) => r.smart_status === 'smart').length, [smartRopData])
  const manualCount = useMemo(() => smartRopData.filter((r) => r.smart_status === 'manual').length, [smartRopData])

  const missingSupplierCount = (skus: Row[]) =>
    skus.filter((r) => {
      const s = r.component.supplier_id ? supplierById.get(r.component.supplier_id) : null
      return !r.component.supplier_id || !s || !s.is_active
    }).length

  const handleAddToList = (row: Row, qtyOverride?: number) => {
    const c = row.component
    const qty = qtyOverride ?? row.suggested_qty
    if (!qty || qty <= 0) return
    onAddToShoppingList({
      component_id: c.id,
      component_name: c.name,
      component_code: c.code ?? '',
      supplier_id: c.supplier_id ?? null,
      supplier_name: row.supplier?.name ?? null,
      quantity: qty,
      units_per_pallet: c.units_per_pallet ?? null,
      pallets_per_full_tir: c.pallets_per_full_tir ?? null,
      current_stock: row.current_stock,
      min_stock_level: row.effective_min_stock,
      target_stock_level: row.effective_target_stock,
    })
  }

  const renderOrderCard = (row: Row, variant: 'critical' | 'observe') => {
    const c = row.component
    const smartRow = row.smartRow
    const supplier = c.supplier_id ? supplierById.get(c.supplier_id) ?? null : null
    const noSupplier = !c.supplier_id
    const supplierInactive = Boolean(supplier && !supplier.is_active)
    const invalidSupplier = noSupplier || (!supplier && Boolean(c.supplier_id)) || supplierInactive
    const alreadyAdded = shoppingIds.has(c.id)
    const disabled = invalidSupplier || alreadyAdded
    const lead = row.lead_time_days != null ? `${row.lead_time_days} dni` : '—'
    const warningLabel = noSupplier
      ? '⚠️ Brak dostawcy'
      : !supplier && c.supplier_id
        ? '⚠️ Dostawca nieaktywny'
        : supplierInactive
          ? `⚠️ Dostawca dezaktywowany: ${supplier?.name ?? ''}`
          : null
    const smartBadgeTitle =
      smartRow?.smart_status === 'smart'
        ? `Smart: ${smartRow.weeks_of_history ?? 0} tyg historii, avg ${smartRow.daily_avg?.toFixed(1) ?? '0'} szt/dzień`
        : `Manual (${smartRow?.distinct_wz_days ?? 0}/4 dni z WZ do smart)`

    return (
      <div key={c.id} className={`reorder-row reorder-row--${variant}`}>
        <div className="reorder-row-info">
          <div className="reorder-row-title">
            <span className={`movement-badge movement-badge--${variant === 'critical' ? 'wz' : 'zwr'}`}>
              {variant === 'critical' ? 'PILNE' : 'OBSERWUJ'}
            </span>{' '}
            <span title={smartBadgeTitle}>{c.name}</span>
            {smartRow?.smart_status === 'smart' ? (
              <span className="smart-badge smart-badge--smart" title={smartBadgeTitle}>🤖 Smart</span>
            ) : (
              <span className="smart-badge smart-badge--manual" title={smartBadgeTitle}>📝 Manual</span>
            )}
          </div>
          <div className="reorder-row-meta">
            {warningLabel ? (
              <button type="button" className="reorder-row-warning-badge" onClick={() => onEditComponent(c)}>
                {warningLabel}
              </button>
            ) : (
              <>Dostawca: {supplier!.name} · czas realizacji: {lead}</>
            )}
          </div>
          <div className="reorder-row-meta">
            Stock: <strong>{row.current_stock}</strong>
            {row.incoming && row.incoming.incoming_qty > 0 && (
              <>
                {' '}+ w drodze: <strong>{row.incoming.incoming_qty}</strong>
                {row.incoming.earliest_eta ? ` (ETA ${fmtEta(row.incoming.earliest_eta)})` : ''}
              </>
            )}
            {row.incoming && row.incoming.draft_qty > 0 && (
              <span title="Już wpisane w niewysłanym szkicu ZD — nie liczy się do pozycji, żeby nie zamówić dwa razy">
                {' '}| w szkicu ZD: <strong>{row.incoming.draft_qty}</strong>
              </span>
            )}
            {' '}| Min: {row.effective_min_stock ?? '—'} | Target: {row.effective_target_stock ?? '—'}
            {row.reserved > 0 && <> | zarezerwowane pod zlecenia: {row.reserved}</>}
          </div>
          <div className="reorder-row-meta">
            Sugerowane: <strong>{row.suggested_qty ?? '—'} szt</strong>
            {c.units_per_pallet && row.suggested_qty ? ` (${Math.ceil(row.suggested_qty / c.units_per_pallet)} palet)` : ''}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-success reorder-add-btn"
          disabled={disabled}
          title={invalidSupplier ? 'Brak dostawcy — kliknij badge' : alreadyAdded ? 'Już na liście' : ''}
          onClick={() => handleAddToList(row)}
        >
          {alreadyAdded ? '✓ Na liście' : '+ Do listy'}
        </button>
      </div>
    )
  }

  const renderSimpleCard = (row: Row) => {
    const c = row.component
    const supplier = c.supplier_id ? supplierById.get(c.supplier_id) ?? null : null
    const noSupplier = !c.supplier_id
    const invalidSupplier = noSupplier || (!supplier && Boolean(c.supplier_id))
    const alreadyAdded = shoppingIds.has(c.id)
    const qty = parseInt(customQty[c.id] ?? '') || (row.suggested_qty ?? 0)

    return (
      <div key={c.id} className="reorder-row reorder-row--simple">
        <div className="reorder-row-info">
          <div className="reorder-row-title">{c.name}</div>
          <div className="reorder-row-meta">
            Stock: <strong>{row.current_stock}</strong>
            {row.incoming && row.incoming.incoming_qty > 0 && (
              <> + w drodze: {row.incoming.incoming_qty}{row.incoming.earliest_eta ? ` (ETA ${fmtEta(row.incoming.earliest_eta)})` : ''}</>
            )}
            {row.incoming && row.incoming.draft_qty > 0 && (
              <span title="Już wpisane w niewysłanym szkicu ZD — nie liczy się do pozycji"> | w szkicu ZD: {row.incoming.draft_qty}</span>
            )}
            {row.effective_min_stock != null && <> | Min: {row.effective_min_stock}</>}
            {row.effective_target_stock != null && <> | Target: {row.effective_target_stock}</>}
            {supplier && <> · {supplier.name}</>}
          </div>
        </div>
        <div className="reorder-row-actions">
          <input
            type="number"
            className="reorder-qty-input"
            min={1}
            placeholder={row.suggested_qty != null ? String(row.suggested_qty) : 'Ilość'}
            value={customQty[c.id] ?? ''}
            onChange={(e) => setCustomQty((prev) => ({ ...prev, [c.id]: e.target.value }))}
            disabled={alreadyAdded}
          />
          <button
            type="button"
            className="btn btn-sm btn-secondary reorder-add-btn"
            disabled={invalidSupplier || alreadyAdded || qty <= 0}
            title={noSupplier ? 'Brak dostawcy' : alreadyAdded ? 'Już na liście' : ''}
            onClick={() => handleAddToList(row, qty || undefined)}
          >
            {alreadyAdded ? '✓' : '+ Do listy'}
          </button>
          {isManager && noSupplier && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onEditComponent(c)} title="Przypisz dostawcę">
              ⚠️
            </button>
          )}
        </div>
      </div>
    )
  }

  // Spinner TYLKO gdy trwa ładowanie. Pusta kartoteka to stan, nie ładowanie —
  // wcześniej pusta baza = spinner w nieskończoność (bug ze zgłoszeń).
  if (componentsLoading || stockLoading) {
    return <Spinner center label="Ładowanie dashboardu zamawiania…" />
  }
  if (components.length === 0) {
    return (
      <p className="no-results">
        Brak komponentów w kartotece. Dodaj komponenty w Magazyn → Komponenty —
        wtedy pojawią się tu sugestie zamówień.
      </p>
    )
  }

  return (
    <div className="reorder-dashboard">
      <div className="reorder-header">
        <h2>Zamawianie towaru</h2>
        <button type="button" className="btn btn-sm btn-primary" onClick={onOpenShoppingList}>
          Lista zakupowa ({shoppingList.length})
        </button>
      </div>

      <p className="reorder-phase-banner">
        {smartRopLoading
          ? 'Ładowanie smart logic...'
          : smartCount === 0
            ? 'ℹ️ System używa manualnych progów min/target. Smart logic aktywuje się po 4 dniach z WZ w 12 tygodniach.'
            : `ℹ️ Smart logic aktywne dla ${smartCount} SKU. Pozostałe ${manualCount} SKU używa progów manualnych.`}
      </p>

      <div className="alerts-filter-pills">
        {(['all', 'raw', 'doors_internal'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`alerts-filter-pill ${categoryFilter === f ? 'alerts-filter-pill--active' : ''}`}
            onClick={() => setCategoryFilter(f)}
          >
            {getCategoryFilterLabel(f)}{' '}
            <span className="alerts-filter-pill-count">
              {f === 'all' ? categoryCounts.all : f === 'raw' ? categoryCounts.raw : categoryCounts.doors_internal}
            </span>
          </button>
        ))}
        {categoryFilter !== 'all' && (
          <button
            type="button"
            className="alerts-filter-pill"
            style={{ borderColor: '#94a3b8', color: '#64748b' }}
            onClick={() => setCategoryFilter('all')}
          >
            ✕ Pokaż wszystkie
          </button>
        )}
      </div>

      <div className="reorder-toolbar">
        <input
          type="text"
          className="search-input"
          placeholder="🔍 Szukaj: nazwa, kod lub dostawca…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value === '' ? '' : Number(e.target.value))}
          title="Pokaż tylko SKU tego dostawcy"
        >
          <option value="">Wszyscy dostawcy</option>
          {supplierOptions.map(({ supplier, count }) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name} ({count}){supplier.is_active ? '' : ' — nieaktywny'}
            </option>
          ))}
        </select>
        {filterActive && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setQuery('')
              setSupplierFilter('')
            }}
          >
            ✕ Wyczyść
          </button>
        )}
        <span className="reorder-row-meta">{rows.length} SKU</span>
      </div>

      {/* Pilnie zamów */}
      {criticalSkus.length > 0 && (
        <section className="reorder-section reorder-section--critical">
          <h3>🔴 Pilnie zamów ({criticalSkus.length})</h3>
          {missingSupplierCount(criticalSkus) > 0 && (
            <div className="reorder-info-banner">
              ℹ️ {missingSupplierCount(criticalSkus)} SKU bez przypisanego dostawcy — kliknij badge ⚠️ aby ustawić.
            </div>
          )}
          {criticalSkus.map((row) => renderOrderCard(row, 'critical'))}
        </section>
      )}

      {/* Obserwuj */}
      {observeSkus.length > 0 && (
        <section className="reorder-section reorder-section--observe">
          <h3>🟡 Obserwuj ({observeSkus.length})</h3>
          {missingSupplierCount(observeSkus) > 0 && (
            <div className="reorder-info-banner">
              ℹ️ {missingSupplierCount(observeSkus)} SKU bez dostawcy.
            </div>
          )}
          {observeSkus.map((row) => renderOrderCard(row, 'observe'))}
        </section>
      )}

      {/* Wszystko OK — zwinięte, ale z możliwością dodania do listy */}
      {okSkus.length > 0 && (
        <section className="reorder-section reorder-section--ok">
          <button
            type="button"
            className="reorder-section-toggle"
            onClick={() => setShowOk((v) => !v)}
            aria-expanded={showOk}
          >
            <span>🟢 Wszystko OK ({okSkus.length}) — kliknij aby zamówić z wyprzedzeniem</span>
            {showOk || filterActive ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          {(showOk || filterActive) && okSkus.map((row) => renderSimpleCard(row))}
        </section>
      )}

      {/* Brak progu */}
      {noThresholdSkus.length > 0 && (
        <section className="reorder-section reorder-section--no-threshold">
          <button
            type="button"
            className="reorder-section-toggle"
            onClick={() => setShowNoThreshold((v) => !v)}
            aria-expanded={showNoThreshold}
          >
            <span>⚪ Brak progu ({noThresholdSkus.length})</span>
            {showNoThreshold || filterActive ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          {(showNoThreshold || filterActive) && (
            <>
              <p className="reorder-section-caption">
                SKU bez ustawionego progu min — system nie może automatycznie wskazać kiedy zamówić.
                Możesz jednak dodać je ręcznie do listy zakupowej.
              </p>
              {noThresholdSkus.map((row) => renderSimpleCard(row))}
            </>
          )}
        </section>
      )}

      {rows.length === 0 && filterActive ? (
        <p className="no-results">Żaden SKU nie pasuje do filtra.</p>
      ) : (
        criticalSkus.length === 0 &&
        observeSkus.length === 0 &&
        noThresholdSkus.length === 0 && <p className="no-results">🎉 Wszystkie zapasy w normie!</p>
      )}
    </div>
  )
}
