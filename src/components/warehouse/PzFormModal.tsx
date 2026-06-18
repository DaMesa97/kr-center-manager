import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PzFormState, PzItem, Supplier, Warehouse, WarehouseComponent } from '../../types'
import SearchableSelect from '../SearchableSelect'
import { isInternalWarehouseCode } from '../../utils'

type PzFormModalProps = {
  open: boolean
  mode: 'create'
  formData: PzFormState
  warehouses: Warehouse[]
  components: WarehouseComponent[]
  suppliers: Supplier[]
  onChange: (field: keyof PzFormState, value: unknown) => void
  onItemChange: (index: number, field: keyof PzItem, value: unknown) => void
  onAddItem: () => void
  onRemoveItem: (index: number) => void
  onSave: () => Promise<void>
  onClose: () => void
  saving: boolean
}

function componentOptionLabel(c: WarehouseComponent): string {
  return `${c.code} — ${c.name} (${c.unit})`
}

const COMPONENT_FILTERS = [
  { key: 'all', label: 'Wszystkie', productCategory: null },
  { key: 'raw', label: 'Surowce', productCategory: 'raw' },
  { key: 'door_wing', label: 'Skrzydła wewn.', productCategory: 'door_wing' },
  { key: 'door_frame', label: 'Ościeżnice wewn.', productCategory: 'door_frame' },
  { key: 'door_handle', label: 'Klamki', productCategory: 'door_handle' },
  { key: 'door_hinge_cover', label: 'Osłonki', productCategory: 'door_hinge_cover' },
] as const

function PzFormModal({
  open,
  mode,
  formData,
  warehouses,
  components,
  suppliers,
  onChange,
  onItemChange,
  onAddItem,
  onRemoveItem,
  onSave,
  onClose,
  saving,
}: PzFormModalProps) {
  const [componentCategoryFilter, setComponentCategoryFilter] = useState<(typeof COMPONENT_FILTERS)[number]['key']>('all')
  const [supplierFilter, setSupplierFilter] = useState<number | 'all' | 'none'>('all')

  useEffect(() => {
    if (open) {
      setComponentCategoryFilter('all')
      setSupplierFilter('all')
    }
  }, [open])

  // Dostawcy faktycznie obecni wśród komponentów (+ czy są komponenty bez dostawcy)
  const supplierChoices = useMemo(() => {
    const presentIds = new Set<number>()
    let hasNone = false
    components.forEach((c) => {
      if (c.supplier_id) presentIds.add(c.supplier_id)
      else hasNone = true
    })
    const list = suppliers
      .filter((s) => presentIds.has(s.id))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { list, hasNone }
  }, [components, suppliers])

  // Najpierw zawężamy po dostawcy, potem liczymy kategorie z tej zawężonej listy
  const supplierFiltered = useMemo(() => {
    if (supplierFilter === 'all') return components
    if (supplierFilter === 'none') return components.filter((c) => !c.supplier_id)
    return components.filter((c) => c.supplier_id === supplierFilter)
  }, [components, supplierFilter])

  // null/undefined product_category traktujemy jak 'raw' (spójnie z useWarehouse/ComponentsView)
  const catOf = (c: WarehouseComponent) => c.product_category ?? 'raw'

  const componentCounts = useMemo(
    () => ({
      all: supplierFiltered.length,
      raw: supplierFiltered.filter((c) => catOf(c) === 'raw').length,
      door_wing: supplierFiltered.filter((c) => catOf(c) === 'door_wing').length,
      door_frame: supplierFiltered.filter((c) => catOf(c) === 'door_frame').length,
      door_handle: supplierFiltered.filter((c) => catOf(c) === 'door_handle').length,
      door_hinge_cover: supplierFiltered.filter((c) => catOf(c) === 'door_hinge_cover').length,
    }),
    [supplierFiltered],
  )

  const filteredComponents = useMemo(() => {
    if (componentCategoryFilter === 'all') return supplierFiltered
    return supplierFiltered.filter((c) => catOf(c) === componentCategoryFilter)
  }, [supplierFiltered, componentCategoryFilter])

  const componentOptions = useMemo(
    () => filteredComponents.map((c) => componentOptionLabel(c)),
    [filteredComponents],
  )

  const optionToId = useMemo(() => {
    const m = new Map<string, number>()
    filteredComponents.forEach((c) => {
      m.set(componentOptionLabel(c), c.id)
    })
    return m
  }, [filteredComponents])

  const idToOption = useMemo(() => {
    const m = new Map<number, string>()
    components.forEach((c) => {
      m.set(c.id, componentOptionLabel(c))
    })
    return m
  }, [components])
  const componentById = useMemo(() => {
    const m = new Map<number, WarehouseComponent>()
    components.forEach((c) => m.set(c.id, c))
    return m
  }, [components])

  const warehousesSorted = useMemo(
    () => [...warehouses].sort((a, b) => a.code.localeCompare(b.code)),
    [warehouses],
  )
  const selectedWarehouse = useMemo(
    () => warehouses.find((w) => w.id === formData.warehouse_id) ?? null,
    [warehouses, formData.warehouse_id],
  )
  const internalIds = useMemo(
    () => new Set(warehouses.filter((w) => isInternalWarehouseCode(w.code)).map((w) => w.id)),
    [warehouses],
  )
  const firstInternalWarehouse = useMemo(
    () => warehousesSorted.find((w) => internalIds.has(w.id)) ?? null,
    [warehousesSorted, internalIds],
  )
  const firstNonInternalWarehouse = useMemo(
    () => warehousesSorted.find((w) => !internalIds.has(w.id)) ?? null,
    [warehousesSorted, internalIds],
  )
  const selectedCategoryFlags = useMemo(() => {
    let hasRaw = false
    let hasInternalDoor = false
    formData.items.forEach((it) => {
      if (!it.component_id || it.component_id <= 0) return
      const comp = componentById.get(it.component_id)
      if (!comp) return
      if (comp.product_category === 'raw') hasRaw = true
      if (comp.product_category !== 'raw') hasInternalDoor = true
    })
    return { hasRaw, hasInternalDoor, isMixed: hasRaw && hasInternalDoor }
  }, [formData.items, componentById])
  const warehouseWarning = useMemo(() => {
    if (selectedCategoryFlags.isMixed) {
      return {
        kind: 'info' as const,
        message:
          'Mieszane kategorie pozycji w jednym dokumencie PZ. Zalecane jest tworzenie osobnych dokumentów dla surowców i drzwi wewnętrznych.',
        buttonLabel: null as string | null,
        onClick: null as (() => void) | null,
      }
    }
    if (selectedCategoryFlags.hasInternalDoor && formData.warehouse_id && !internalIds.has(formData.warehouse_id)) {
      const selectedLabel = selectedWarehouse ? `${selectedWarehouse.code} — ${selectedWarehouse.name}` : 'inny magazyn'
      return {
        kind: 'warning' as const,
        message: `Uwaga: wybrana pozycja to drzwi wewnętrzne, ale magazyn jest ustawiony na ${selectedLabel}. Czy zmienić na magazyn wewnętrzny?`,
        buttonLabel: firstInternalWarehouse ? `Zmień na ${firstInternalWarehouse.code}` : null,
        onClick: firstInternalWarehouse ? () => onChange('warehouse_id', firstInternalWarehouse.id) : null,
      }
    }
    if (selectedCategoryFlags.hasRaw && formData.warehouse_id && internalIds.has(formData.warehouse_id)) {
      return {
        kind: 'warning' as const,
        message: 'Uwaga: wybrana pozycja to surowiec, ale magazyn jest wewnętrzny.',
        buttonLabel: firstNonInternalWarehouse ? `Zmień na ${firstNonInternalWarehouse.code}` : 'Wyczyść magazyn',
        onClick: () => onChange('warehouse_id', firstNonInternalWarehouse ? firstNonInternalWarehouse.id : null),
      }
    }
    return null
  }, [selectedCategoryFlags, formData.warehouse_id, selectedWarehouse, firstInternalWarehouse, firstNonInternalWarehouse, internalIds, onChange])

  if (!open) return null

  const title = mode === 'create' ? 'Nowe przyjęcie (PZ)' : 'Przyjęcie (PZ)'

  return createPortal(
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={() => {
        if (saving) return
        onClose()
      }}
    >
      <div
        className="order-modal order-modal--sta recipe-editor-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="order-modal-header">
          <h2>{title}</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={saving}>
            X
          </button>
        </div>

        <div className="recipe-editor-modal-body">
          <div className="order-form-grid order-form-grid--sta recipe-editor-modal-form-top">
            <h3 className="order-field-full" style={{ margin: '0.5rem 0 0', gridColumn: '1 / -1' }}>
              Dokument
            </h3>
            <label className="order-field-full">
              <span className="order-field-label-text">Magazyn</span>
              <select
                value={formData.warehouse_id ?? ''}
                onChange={(e) =>
                  onChange('warehouse_id', e.target.value === '' ? null : Number(e.target.value))
                }
                disabled={saving}
              >
                <option value="">— wybierz magazyn —</option>
                {warehousesSorted.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
            </label>
            {warehouseWarning && (
              <div className={`pz-warning-banner ${warehouseWarning.kind === 'info' ? 'pz-warning-banner--info' : ''}`}>
                <span>{warehouseWarning.message}</span>
                {warehouseWarning.buttonLabel && warehouseWarning.onClick && (
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={warehouseWarning.onClick}
                    disabled={saving}
                  >
                    {warehouseWarning.buttonLabel}
                  </button>
                )}
              </div>
            )}
            <label className="order-field-full">
              <span className="order-field-label-text">Numer dokumentu</span>
              <input
                type="text"
                value={formData.reference_doc}
                onChange={(e) => onChange('reference_doc', e.target.value)}
                disabled={saving}
                placeholder="Automatyczny jeśli puste"
              />
            </label>
            <label className="order-field-full">
              <span className="order-field-label-text">Uwagi</span>
              <textarea
                value={formData.notes}
                onChange={(e) => onChange('notes', e.target.value)}
                disabled={saving}
                rows={3}
                style={{ width: '100%', resize: 'vertical' }}
              />
            </label>
          </div>

          <div className="recipe-editor-positions-section">
            <h3 className="order-field-full" style={{ margin: '0.75rem 0 0', gridColumn: '1 / -1' }}>
              Pozycje
            </h3>
            <label className="movements-view-filter" style={{ marginBottom: 8, display: 'block', maxWidth: 320 }}>
              <span className="order-field-label-text">Dostawca</span>
              <select
                className="day-filter"
                style={{ width: '100%' }}
                value={supplierFilter === 'all' ? 'all' : supplierFilter === 'none' ? 'none' : String(supplierFilter)}
                onChange={(e) => {
                  const v = e.target.value
                  setSupplierFilter(v === 'all' ? 'all' : v === 'none' ? 'none' : Number(v))
                }}
                disabled={saving}
              >
                <option value="all">Wszyscy dostawcy</option>
                {supplierChoices.list.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                {supplierChoices.hasNone && <option value="none">— bez dostawcy —</option>}
              </select>
            </label>
            <div className="components-filter-pills" style={{ marginBottom: 10 }}>
              {COMPONENT_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`alerts-filter-pill ${
                    componentCategoryFilter === f.key ? 'alerts-filter-pill--active' : ''
                  }`}
                  onClick={() => setComponentCategoryFilter(f.key)}
                  disabled={saving}
                >
                  {f.label} ({componentCounts[f.key]})
                </button>
              ))}
            </div>
            <div className="recipe-editor-positions-scroll">
              <div className="table-wrapper recipe-editor-positions-wrap">
                <table
                  className="orders-table recipe-editor-positions-table"
                  style={{ width: '100%', tableLayout: 'fixed' }}
                >
                  <colgroup>
                    <col style={{ width: '55%' }} />
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '22%' }} />
                    <col style={{ width: '8%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="recipe-editor-component-th">KOMPONENT</th>
                      <th>ILOŚĆ</th>
                      <th>UWAGI</th>
                      <th className="recipe-editor-actions-th">AKCJA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {formData.items.map((row, index) => {
                      const selectValue =
                        row.component_id > 0 ? (idToOption.get(row.component_id) ?? '') : ''
                      const rowComp = row.component_id > 0 ? componentById.get(row.component_id) : null
                      const rowUnit = rowComp?.unit ?? ''
                      const isWholeUnit = rowUnit === 'szt'
                      return (
                        <tr key={index}>
                          <td className="recipe-editor-component-cell">
                            <SearchableSelect
                              value={selectValue}
                              onChange={(val) => {
                                const id = optionToId.get(val) ?? 0
                                onItemChange(index, 'component_id', id)
                                if (mode !== 'create' || id <= 0) return
                                const selectedComponent = componentById.get(id)
                                if (!selectedComponent) return
                                const isInternalDoor = selectedComponent.product_category !== 'raw'
                                if (isInternalDoor && !formData.warehouse_id && firstInternalWarehouse) {
                                  onChange('warehouse_id', firstInternalWarehouse.id)
                                }
                              }}
                              options={componentOptions}
                              placeholder="— wybierz komponent —"
                              disabled={saving}
                            />
                          </td>
                          <td>
                            <div className="pz-qty-cell">
                              <input
                                type="number"
                                min={0}
                                step={isWholeUnit ? 1 : 0.001}
                                value={Number.isFinite(row.quantity) ? row.quantity : 0}
                                onChange={(e) => {
                                  const raw = parseFloat(e.target.value) || 0
                                  const val = isWholeUnit ? Math.round(raw) : raw
                                  onItemChange(index, 'quantity', val < 0 ? 0 : val)
                                }}
                                disabled={saving}
                              />
                              {rowUnit && <span className="pz-qty-unit">{rowUnit}</span>}
                            </div>
                          </td>
                          <td>
                            <input
                              type="text"
                              value={row.notes ?? ''}
                              onChange={(e) => onItemChange(index, 'notes', e.target.value)}
                              disabled={saving}
                            />
                          </td>
                          <td className="recipe-editor-actions-td">
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              onClick={() => onRemoveItem(index)}
                              disabled={saving}
                            >
                              Usuń
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-success"
              style={{ marginTop: 10 }}
              onClick={onAddItem}
              disabled={saving}
            >
              + Dodaj pozycję
            </button>
          </div>
        </div>

        <div className="order-form-actions">
          <button type="button" className="btn btn-primary" onClick={() => void onSave()} disabled={saving}>
            {saving ? 'Zapisywanie…' : 'Zapisz'}
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={onClose} disabled={saving}>
            Anuluj
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default PzFormModal
