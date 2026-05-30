import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type {
  ShoppingListItem,
  SmartRopRow,
  Supplier,
  WarehouseComponent,
  WarehouseStockRow,
} from '../../types'

type ReorderStatus = 'no_threshold' | 'critical' | 'observe' | 'ok'

type Row = {
  component: WarehouseComponent
  smartRow: SmartRopRow | null
  effective_min_stock: number | null
  effective_target_stock: number | null
  current_stock: number
  supplier: Supplier | null
  lead_time_days: number | null
  status: ReorderStatus
  suggested_qty: number | null
}

type Props = {
  components: WarehouseComponent[]
  suppliers: Supplier[]
  stock: WarehouseStockRow[]
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

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers])
  const shoppingIds = useMemo(() => new Set(shoppingList.map((s) => s.component_id)), [shoppingList])
  const smartRopByComponentId = useMemo(
    () => new Map(smartRopData.map((row) => [row.component_id, row])),
    [smartRopData],
  )

  const rows = useMemo(() => {
    const stockSumByComponent = new Map<number, number>()
    for (const s of stock) {
      stockSumByComponent.set(s.component_id, (stockSumByComponent.get(s.component_id) ?? 0) + Number(s.quantity || 0))
    }

    const source = components.filter((c) => {
      if (categoryFilter === 'all') return true
      if (categoryFilter === 'raw') return c.product_category === 'raw' || c.product_category == null
      return isDoorsInternal(c.product_category)
    })

    return source.map((component) => {
      const currentStock = stockSumByComponent.get(component.id) ?? 0
      const supplier = component.supplier_id ? supplierById.get(component.supplier_id) ?? null : null
      const leadTime = supplier?.lead_time_days ?? null
      const smartRow = smartRopByComponentId.get(component.id) ?? null
      const effectiveMin = smartRow?.effective_min_stock ?? component.min_stock_level ?? null
      const effectiveTarget = smartRow?.effective_target_stock ?? component.target_stock_level ?? null
      let status: ReorderStatus = 'ok'
      if (effectiveMin == null) {
        status = 'no_threshold'
      } else if (currentStock <= effectiveMin) {
        status = 'critical'
      } else if (currentStock <= effectiveMin * 1.5) {
        status = 'observe'
      }

      let suggested: number | null = null
      if (status === 'critical' || status === 'observe') {
        const fallbackTarget = effectiveMin == null ? null : effectiveMin * 4
        const rawQty = Math.max((effectiveTarget ?? fallbackTarget ?? 0) - currentStock, 1)
        if (component.units_per_pallet != null && component.units_per_pallet > 0) {
          suggested = Math.max(Math.ceil(rawQty / component.units_per_pallet) * component.units_per_pallet, 1)
        } else {
          suggested = Math.max(rawQty, 1)
        }
      }

      return {
        component,
        smartRow,
        effective_min_stock: effectiveMin,
        effective_target_stock: effectiveTarget,
        current_stock: currentStock,
        supplier,
        lead_time_days: leadTime,
        status,
        suggested_qty: suggested,
      } as Row
    })
  }, [components, stock, supplierById, categoryFilter, smartRopByComponentId])

  const noThresholdSkus = useMemo(
    () =>
      rows
        .filter((r) => r.status === 'no_threshold')
        .sort((a, b) => a.component.name.localeCompare(b.component.name, 'pl')),
    [rows],
  )
  const criticalSkus = useMemo(
    () => rows.filter((r) => r.status === 'critical').sort(sortByLeadAndStock),
    [rows],
  )
  const observeSkus = useMemo(
    () => rows.filter((r) => r.status === 'observe').sort(sortByLeadAndStock),
    [rows],
  )
  const okSkus = useMemo(
    () =>
      rows
        .filter((r) => r.status === 'ok')
        .sort((a, b) => a.component.name.localeCompare(b.component.name, 'pl')),
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

  const criticalMissingSupplierCount = useMemo(
    () =>
      criticalSkus.filter((r) => {
        const sid = r.component.supplier_id
        if (!sid) return true
        const s = supplierById.get(sid)
        return !s || !s.is_active
      }).length,
    [criticalSkus, supplierById],
  )
  const observeMissingSupplierCount = useMemo(
    () =>
      observeSkus.filter((r) => {
        const sid = r.component.supplier_id
        if (!sid) return true
        const s = supplierById.get(sid)
        return !s || !s.is_active
      }).length,
    [observeSkus, supplierById],
  )

  if (components.length === 0 || stock.length === 0) {
    return <p className="no-results">Ładowanie dashboardu zamawiania...</p>
  }

  if (criticalSkus.length === 0 && observeSkus.length === 0 && noThresholdSkus.length === 0 && shoppingList.length === 0) {
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
            ? 'Ladowanie smart logic...'
            : smartCount === 0
              ? 'ℹ️ System używa manualnych progów min/target. Smart logic aktywuje się automatycznie dla każdego SKU po zebraniu 4 dni z WZ w ciągu 12 tygodni.'
              : `ℹ️ Smart logic aktywne dla ${smartCount} SKU (wyliczone z historii sprzedaży). Pozostałe ${manualCount} SKU używa manualnych progów (smart aktywuje się po 4 dniach z WZ w 12 tygodni).`}
        </p>
        <p className="no-results">🎉 Wszystkie zapasy w normie!</p>
      </div>
    )
  }

  const renderOrderCard = (row: Row, variant: 'critical' | 'observe') => {
    const c = row.component
    const smartRow = row.smartRow
    const supplier = c.supplier_id ? supplierById.get(c.supplier_id) ?? null : null
    const noSupplier = !c.supplier_id
    const supplierMissing = Boolean(c.supplier_id && !supplier)
    const supplierInactive = Boolean(supplier && !supplier.is_active)
    const invalidSupplier = noSupplier || supplierMissing || supplierInactive
    const alreadyAdded = shoppingIds.has(c.id)
    const disabled = invalidSupplier || alreadyAdded
    const lead = row.lead_time_days != null ? `${row.lead_time_days} dni ≈ ${Math.round(row.lead_time_days / 7)} tyg` : '—'
    const warningLabel = noSupplier
      ? '⚠️ Brak dostawcy'
      : supplierMissing
        ? '⚠️ Dostawca nieaktywny'
        : supplierInactive
          ? `⚠️ Dostawca dezaktywowany: ${supplier?.name ?? ''}`
          : null
    const smartBadgeTitle =
      smartRow?.smart_status === 'smart'
        ? `Wyliczone z historii: ${smartRow.weeks_of_history ?? 0} tyg, srednio ${smartRow.daily_avg?.toFixed(1) ?? '0.0'} szt/dzien.\nSmart calculation:\n- Historia: ${smartRow.weeks_of_history ?? 0} tyg\n- Srednie zuzycie: ${smartRow.daily_avg?.toFixed(1) ?? '0.0'} szt/dzien\n- Sezonowy factor: ${smartRow.seasonal_factor?.toFixed(2) ?? '1.00'}\n- ROP wyliczony: ${smartRow.recommended_min_stock ?? row.effective_min_stock ?? 0} szt\n- Target wyliczony: ${smartRow.recommended_target_stock ?? row.effective_target_stock ?? 0} szt\n- Twoj manualny: ${smartRow.manual_min_stock ?? c.min_stock_level ?? 0} szt (ignorowany w smart)`
        : `Wartosci reczne. Smart aktywuje sie gdy historia bedzie wystarczajaca (${smartRow?.distinct_wz_days ?? 0}/4 dni z WZ).`
    return (
      <div key={c.id} className={`reorder-row reorder-row--${variant}`}>
        <div>
          <div className="reorder-row-title">
            <span className={`movement-badge movement-badge--${variant === 'critical' ? 'wz' : 'zwr'}`}>
              {variant === 'critical' ? 'PILNE' : 'OBSERWUJ'}
            </span>{' '}
            <span title={smartBadgeTitle}>{c.name}</span>
            {smartRow?.smart_status === 'smart' ? (
              <span className="smart-badge smart-badge--smart" title={smartBadgeTitle}>
                🤖 Smart
              </span>
            ) : (
              <span className="smart-badge smart-badge--manual" title={smartBadgeTitle}>
                📝 Manual
              </span>
            )}
          </div>
          <div className="reorder-row-meta">
            {warningLabel ? (
              <button
                type="button"
                className="reorder-row-warning-badge"
                onClick={() => onEditComponent(c)}
                title="Kliknij aby przypisać/poprawić dostawcę"
              >
                {warningLabel}
              </button>
            ) : (
              <>Dostawca: {supplier!.name} (Czas realizacji {lead})</>
            )}
          </div>
          <div className="reorder-row-meta">
            Stock: {row.current_stock} szt | Min: {row.effective_min_stock ?? '—'} | Target:{' '}
            {row.effective_target_stock ?? '—'}
          </div>
          <div className="reorder-row-meta">
            Sugerowane zamówienie: <strong>{row.suggested_qty ?? '—'} szt</strong>{' '}
            {c.units_per_pallet ? `(${Math.ceil((row.suggested_qty ?? 0) / c.units_per_pallet)} palet)` : ''}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-success reorder-add-btn"
          disabled={disabled}
          title={
            invalidSupplier
              ? 'Nie można dodać — brak przypisanego dostawcy. Kliknij badge ostrzegawczy.'
              : alreadyAdded
                ? 'Już na liście zakupowej'
                : ''
          }
          onClick={() =>
            row.suggested_qty &&
            onAddToShoppingList({
              component_id: c.id,
              component_name: c.name,
              component_code: c.code ?? '',
              supplier_id: c.supplier_id ?? null,
              supplier_name: row.supplier?.name ?? null,
              quantity: row.suggested_qty,
              units_per_pallet: c.units_per_pallet ?? null,
              pallets_per_full_tir: c.pallets_per_full_tir ?? null,
              current_stock: row.current_stock,
              min_stock_level: row.effective_min_stock,
              target_stock_level: row.effective_target_stock,
            })
          }
        >
          + Do listy
        </button>
      </div>
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
          ? 'Ladowanie smart logic...'
          : smartCount === 0
            ? 'ℹ️ System używa manualnych progów min/target. Smart logic aktywuje się automatycznie dla każdego SKU po zebraniu 4 dni z WZ w ciągu 12 tygodni.'
            : `ℹ️ Smart logic aktywne dla ${smartCount} SKU (wyliczone z historii sprzedaży). Pozostałe ${manualCount} SKU używa manualnych progów (smart aktywuje się po 4 dniach z WZ w 12 tygodni).`}
      </p>

      <div className="alerts-filter-pills">
        <button
          type="button"
          className={`alerts-filter-pill ${categoryFilter === 'all' ? 'alerts-filter-pill--active' : ''}`}
          onClick={() => setCategoryFilter('all')}
        >
          Wszystkie kategorie <span className="alerts-filter-pill-count">{categoryCounts.all}</span>
        </button>
        <button
          type="button"
          className={`alerts-filter-pill ${categoryFilter === 'raw' ? 'alerts-filter-pill--active' : ''}`}
          onClick={() => setCategoryFilter('raw')}
        >
          Surowce <span className="alerts-filter-pill-count">{categoryCounts.raw}</span>
        </button>
        <button
          type="button"
          className={`alerts-filter-pill ${categoryFilter === 'doors_internal' ? 'alerts-filter-pill--active' : ''}`}
          onClick={() => setCategoryFilter('doors_internal')}
        >
          Drzwi wewn. <span className="alerts-filter-pill-count">{categoryCounts.doors_internal}</span>
        </button>
      </div>

      {noThresholdSkus.length > 0 && (
        <section className="reorder-section reorder-section--no-threshold">
          <button
            type="button"
            className="reorder-section-toggle"
            onClick={() => setShowNoThreshold((v) => !v)}
            title={showNoThreshold ? 'Kliknij aby zwinąć' : 'Kliknij aby rozwinąć'}
            role="button"
            aria-expanded={showNoThreshold}
          >
            <span>🔴 Wymaga uwagi: brak progu ({noThresholdSkus.length})</span>
            {showNoThreshold ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          {showNoThreshold && (
            <>
              <p className="reorder-section-caption">
                {noThresholdSkus.length} SKU nie ma ustawionego progu min_stock_level. Bez tego system nie może
                wskazać kiedy zamówić.
              </p>
              {noThresholdSkus.map((row) => (
                <div key={row.component.id} className="reorder-row">
                  <div>
                    <span className="subtab-badge subtab-badge--alert">BRAK PROGU</span> {row.component.name}
                    {row.smartRow?.smart_status === 'smart' ? (
                      <span
                        className="smart-badge smart-badge--smart"
                        title={`Wyliczone z historii: ${row.smartRow.weeks_of_history ?? 0} tyg, srednio ${row.smartRow.daily_avg?.toFixed(1) ?? '0.0'} szt/dzien`}
                      >
                        🤖 Smart
                      </span>
                    ) : (
                      <span
                        className="smart-badge smart-badge--manual"
                        title={`Wartosci reczne. Smart aktywuje sie gdy historia bedzie wystarczajaca (${row.smartRow?.distinct_wz_days ?? 0}/4 dni z WZ).`}
                      >
                        📝 Manual
                      </span>
                    )}
                  </div>
                  {isManager && (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => onEditComponent(row.component)}
                    >
                      Ustaw próg
                    </button>
                  )}
                </div>
              ))}
            </>
          )}
        </section>
      )}

      {criticalSkus.length > 0 && (
        <section className="reorder-section reorder-section--critical">
          <h3>🔴 Pilnie zamów ({criticalSkus.length})</h3>
          {criticalMissingSupplierCount > 0 && (
            <div className="reorder-info-banner">
              ℹ️ {criticalMissingSupplierCount} SKU w tej sekcji ma nieprzypisanego dostawcę i nie może być
              dodane do listy zakupowej. Kliknij badge "⚠️ Brak dostawcy" przy SKU aby przypisać.
            </div>
          )}
          {criticalSkus.map((row) => renderOrderCard(row, 'critical'))}
        </section>
      )}

      {observeSkus.length > 0 && (
        <section className="reorder-section reorder-section--observe">
          <h3>🟡 Obserwuj ({observeSkus.length})</h3>
          {observeMissingSupplierCount > 0 && (
            <div className="reorder-info-banner">
              ℹ️ {observeMissingSupplierCount} SKU w tej sekcji ma nieprzypisanego dostawcę i nie może być
              dodane do listy zakupowej. Kliknij badge "⚠️ Brak dostawcy" przy SKU aby przypisać.
            </div>
          )}
          {observeSkus.map((row) => renderOrderCard(row, 'observe'))}
        </section>
      )}

      {okSkus.length > 0 && (
        <section className="reorder-section reorder-section--ok">
          <button
            type="button"
            className="reorder-section-toggle"
            onClick={() => setShowOk((v) => !v)}
            title={showOk ? 'Kliknij aby zwinąć' : 'Kliknij aby rozwinąć'}
            role="button"
            aria-expanded={showOk}
          >
            <span>🟢 Wszystko OK ({okSkus.length})</span>
            {showOk ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          {showOk &&
            okSkus.map((row) => (
              <div key={row.component.id} className="reorder-row">
                <div>
                  {row.component.name}
                  {row.smartRow?.smart_status === 'smart' ? (
                    <span
                      className="smart-badge smart-badge--smart"
                      title={`Wyliczone z historii: ${row.smartRow.weeks_of_history ?? 0} tyg, srednio ${row.smartRow.daily_avg?.toFixed(1) ?? '0.0'} szt/dzien`}
                    >
                      🤖 Smart
                    </span>
                  ) : (
                    <span
                      className="smart-badge smart-badge--manual"
                      title={`Wartosci reczne. Smart aktywuje sie gdy historia bedzie wystarczajaca (${row.smartRow?.distinct_wz_days ?? 0}/4 dni z WZ).`}
                    >
                      📝 Manual
                    </span>
                  )}{' '}
                  — stock: {row.current_stock} / min: {row.effective_min_stock ?? '—'}
                </div>
              </div>
            ))}
        </section>
      )}

      <p className="sku-logistics-helper">Filtr kategorii: {getCategoryFilterLabel(categoryFilter)}</p>
    </div>
  )
}
