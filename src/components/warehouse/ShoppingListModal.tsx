import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../supabaseClient'
import type {
  ShoppingListItem,
  Supplier,
  ToastVariant,
  WarehouseComponent,
  WarehouseStockRow,
} from '../../types'

type Props = {
  open: boolean
  shoppingList: ShoppingListItem[]
  suppliers: Supplier[]
  components: WarehouseComponent[]
  stock: WarehouseStockRow[]
  onClose: () => void
  onRemove: (componentId: number) => void
  onUpdateQuantity: (componentId: number, newQty: number) => void
  onAddToShoppingList: (item: ShoppingListItem) => void
  onClear: () => void
  onGenerated: () => void
  pushToast: (msg: string, type: ToastVariant) => void
}

type Group = {
  supplier: Supplier
  items: ShoppingListItem[]
}

export default function ShoppingListModal({
  open,
  shoppingList,
  suppliers,
  components,
  stock,
  onClose,
  onRemove,
  onUpdateQuantity,
  onAddToShoppingList,
  onClear,
  onGenerated,
  pushToast,
}: Props) {
  const [notesBySupplier, setNotesBySupplier] = useState<Record<number, string>>({})
  const [generatingSupplierId, setGeneratingSupplierId] = useState<number | null>(null)
  const [generatingAll, setGeneratingAll] = useState(false)
  const [suggestedQuantities, setSuggestedQuantities] = useState<Record<number, number>>({})

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers])
  const stockByComponentId = useMemo(() => {
    const map = new Map<number, number>()
    for (const s of stock) {
      map.set(s.component_id, (map.get(s.component_id) ?? 0) + Number(s.quantity || 0))
    }
    return map
  }, [stock])

  const orphanItems = useMemo(
    () =>
      shoppingList.filter((item) => {
        if (!item.supplier_id) return true
        return !supplierById.has(item.supplier_id)
      }),
    [shoppingList, supplierById],
  )

  const groups = useMemo(() => {
    const map = new Map<number, ShoppingListItem[]>()
    for (const item of shoppingList) {
      if (!item.supplier_id) continue
      const supplier = supplierById.get(item.supplier_id)
      if (!supplier) continue
      const list = map.get(item.supplier_id) ?? []
      list.push(item)
      map.set(item.supplier_id, list)
    }
    return Array.from(map.entries())
      .map(([supplierId, items]) => ({ supplier: supplierById.get(supplierId)!, items }) as Group)
      .sort((a, b) => a.supplier.name.localeCompare(b.supplier.name, 'pl'))
  }, [shoppingList, supplierById])

  const sectionStats = (group: Group) => {
    const pallets = group.items.reduce((sum, item) => {
      if (!item.units_per_pallet || item.units_per_pallet <= 0) return sum
      return sum + Math.ceil(item.quantity / item.units_per_pallet)
    }, 0)
    const fillness = group.items.reduce((sum, item) => {
      if (!item.units_per_pallet || item.units_per_pallet <= 0) return sum
      if (!item.pallets_per_full_tir || item.pallets_per_full_tir <= 0) return sum
      return sum + Math.ceil(item.quantity / item.units_per_pallet) / item.pallets_per_full_tir
    }, 0)
    return { pallets, fillness }
  }

  const calculateRunwayLabel = (proximityToMin: number): string => {
    if (proximityToMin <= 0) return '⚠️ Krytyczny'
    if (proximityToMin < 5) return `${proximityToMin} szt do min`
    return 'OK'
  }

  const getCandidatesForSupplier = (supplierId: number) => {
    return components
      .filter((c) => c.supplier_id === supplierId)
      .filter((c) => c.is_active)
      .filter((c) => !shoppingList.some((s) => s.component_id === c.id))
      .filter((c) => Boolean(c.units_per_pallet && c.units_per_pallet > 0 && c.pallets_per_full_tir && c.pallets_per_full_tir > 0))
      .map((component) => {
        const currentStock = stockByComponentId.get(component.id) ?? 0
        const minLevel = component.min_stock_level ?? 0
        const proximityToMin = currentStock - minLevel
        return { component, currentStock, proximityToMin }
      })
      .sort((a, b) => a.proximityToMin - b.proximityToMin)
      .slice(0, 8)
  }

  const getSuggestedQty = (component: WarehouseComponent) => {
    const local = suggestedQuantities[component.id]
    if (local && local > 0) return local
    return Math.max(component.units_per_pallet ?? 1, 1)
  }

  const handleAddSuggestion = (
    component: WarehouseComponent,
    currentStock: number,
    quantity: number,
  ) => {
    const supplier = suppliers.find((s) => s.id === component.supplier_id)
    onAddToShoppingList({
      component_id: component.id,
      component_name: component.name,
      component_code: component.code ?? '',
      supplier_id: component.supplier_id ?? null,
      supplier_name: supplier?.name ?? null,
      quantity: Math.max(1, quantity),
      units_per_pallet: component.units_per_pallet ?? null,
      pallets_per_full_tir: component.pallets_per_full_tir ?? null,
      current_stock: currentStock,
      min_stock_level: component.min_stock_level ?? null,
      target_stock_level: component.target_stock_level ?? null,
    })
  }

  const generateForGroup = async (group: Group) => {
    setGeneratingSupplierId(group.supplier.id)
    const payload = group.items.map((item) => ({
      component_id: item.component_id,
      quantity_ordered: item.quantity,
      notes: null,
    }))
    const { error } = await supabase.rpc('create_purchase_order', {
      p_supplier_id: group.supplier.id,
      p_items: payload,
      p_notes: notesBySupplier[group.supplier.id]?.trim() || null,
    })
    setGeneratingSupplierId(null)
    if (error) {
      pushToast(`Błąd: ${error.message}`, 'error')
      return
    }
    pushToast('Zamówienie utworzone (status: szkic)', 'success')
    group.items.forEach((item) => onRemove(item.component_id))
    onGenerated()
  }

  const generateAll = async () => {
    setGeneratingAll(true)
    for (const group of groups) {
      const payload = group.items.map((item) => ({
        component_id: item.component_id,
        quantity_ordered: item.quantity,
        notes: null,
      }))
      const { error } = await supabase.rpc('create_purchase_order', {
        p_supplier_id: group.supplier.id,
        p_items: payload,
        p_notes: notesBySupplier[group.supplier.id]?.trim() || null,
      })
      if (error) {
        pushToast(`Błąd generowania dla ${group.supplier.name}: ${error.message}`, 'error')
        setGeneratingAll(false)
        return
      }
      group.items.forEach((item) => onRemove(item.component_id))
    }
    setGeneratingAll(false)
    pushToast('Wygenerowano zamówienia dla wszystkich dostawców', 'success')
    onGenerated()
  }

  if (!open) return null

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="order-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1100 }}>
        <div className="order-modal-header">
          <h2>Lista zakupowa ({shoppingList.length} pozycji)</h2>
          <div className="contractor-actions">
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => {
                if (!window.confirm('Wyczyścić całą listę zakupową?')) return
                onClear()
              }}
            >
              Wyczyść listę
            </button>
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose}>
              X
            </button>
          </div>
        </div>

        {orphanItems.length > 0 && (
          <div className="reorder-info-banner" style={{ marginBottom: 10 }}>
            ℹ️ {orphanItems.length} pozycji bez przypisanego dostawcy zostało pominiętych. Wróć do dashboardu i
            przypisz dostawców.
          </div>
        )}

        {groups.length === 0 ? (
          <p className="no-results">Brak pozycji z przypisanym dostawcą.</p>
        ) : (
          <div className="shopping-groups-wrap">
            {groups.map((group) => {
              const stats = sectionStats(group)
              const fillPercent = stats.fillness * 100
              const tirState =
                fillPercent < 95 ? 'low' : fillPercent <= 105 ? 'ok' : 'high'
              return (
                <section key={group.supplier.id} className="reorder-section">
                  <div className="reorder-row" style={{ alignItems: 'center' }}>
                    <div>
                      <strong>{group.supplier.name}</strong>{' '}
                      <span className="reorder-row-meta">• Czas realizacji: {group.supplier.lead_time_days} dni</span>
                      {group.supplier.requires_full_tir && (
                        <span className="supplier-badge supplier-badge--yes" style={{ marginLeft: 8 }}>
                          Wymaga pełnego TIR
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="table-wrapper">
                    <table className="orders-table">
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>Stock / Min/Target</th>
                          <th>Ilość zamawiana</th>
                          <th>Palety</th>
                          <th>Akcja</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((item) => (
                          <tr key={item.component_id}>
                            <td>{item.component_name}</td>
                            <td>
                              {item.current_stock} | {item.min_stock_level ?? '—'}/{item.target_stock_level ?? '—'}
                            </td>
                            <td>
                              <input
                                type="number"
                                min={1}
                                value={item.quantity}
                                className="extension-qty-input"
                                onChange={(e) => onUpdateQuantity(item.component_id, Math.max(1, Number(e.target.value) || 1))}
                              />
                            </td>
                            <td>
                              {item.units_per_pallet && item.units_per_pallet > 0
                                ? Math.ceil(item.quantity / item.units_per_pallet)
                                : '—'}
                            </td>
                            <td>
                              <button type="button" className="btn btn-sm btn-danger" onClick={() => onRemove(item.component_id)}>
                                Usuń
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="reorder-row-meta">
                    Suma pozycji: {group.items.length}
                    {group.supplier.requires_full_tir && (
                      <>
                        {' | '}
                        {stats.pallets} palet ({fillPercent.toFixed(1)}%) {' — '}
                        {tirState === 'low'
                          ? `🔴 Brakuje ${(100 - fillPercent).toFixed(1)}% do pełnego TIRa`
                          : tirState === 'ok'
                            ? '🟢 Pełny TIR'
                            : `🟡 Przeładowanie ${(fillPercent - 100).toFixed(1)}% — sprawdź`}
                      </>
                    )}
                  </div>
                  {group.supplier.requires_full_tir && stats.fillness < 0.95 && (
                    <div
                      className="shopping-list-suggestions"
                      style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginTop: 10 }}
                    >
                      <div className="shopping-list-suggestions-info" style={{ marginBottom: 8, color: '#4b5563' }}>
                        ℹ️ System sugeruje SKU od tego dostawcy posortowane po tym jak szybko zostaną wyczerpane.
                        Dorzucanie tych pozycji do bieżącego zamówienia pozwala zapełnić TIR i unikać dodatkowych
                        dostaw.
                      </div>
                      <div className="shopping-list-suggestions-header" style={{ fontWeight: 600, marginBottom: 8 }}>
                        💡 Brakuje {(100 - stats.fillness * 100).toFixed(0)}% do pełnego TIRa. Dorzuć z dostępnych SKU u
                        dostawcy:
                      </div>
                      {(() => {
                        const candidates = getCandidatesForSupplier(group.supplier.id)
                        if (candidates.length === 0) {
                          return (
                            <p className="no-results" style={{ margin: 0 }}>
                              Brak dodatkowych SKU u tego dostawcy do dorzucenia.
                            </p>
                          )
                        }
                        return (
                          <div className="table-wrapper shopping-list-suggestions-table">
                            <table className="orders-table">
                              <thead>
                                <tr>
                                  <th>SKU</th>
                                  <th>Stock / Min</th>
                                  <th>Runway</th>
                                  <th>Sugerowana ilość</th>
                                  <th>Palety</th>
                                  <th>Akcja</th>
                                </tr>
                              </thead>
                              <tbody>
                                {candidates.map(({ component, currentStock, proximityToMin }) => {
                                  const suggestedQty = getSuggestedQty(component)
                                  const unitsPerPallet = Math.max(component.units_per_pallet ?? 1, 1)
                                  const palletsCount = Math.ceil(suggestedQty / unitsPerPallet)
                                  return (
                                    <tr key={component.id}>
                                      <td>{component.name}</td>
                                      <td>
                                        {currentStock} / {component.min_stock_level ?? '—'}{' '}
                                        {proximityToMin <= 0 && (
                                          <span className="subtab-badge subtab-badge--alert">PONIŻEJ MIN</span>
                                        )}
                                      </td>
                                      <td>{calculateRunwayLabel(proximityToMin)}</td>
                                      <td>
                                        <input
                                          type="number"
                                          min={1}
                                          step={unitsPerPallet}
                                          className="extension-qty-input"
                                          value={suggestedQty}
                                          onChange={(e) =>
                                            setSuggestedQuantities((prev) => ({
                                              ...prev,
                                              [component.id]: Math.max(1, Number(e.target.value) || 1),
                                            }))
                                          }
                                        />
                                      </td>
                                      <td>{palletsCount}</td>
                                      <td>
                                        <button
                                          type="button"
                                          className="btn btn-sm btn-primary suggestion-add-btn"
                                          onClick={() =>
                                            handleAddSuggestion(component, currentStock, getSuggestedQty(component))
                                          }
                                        >
                                          + Dorzuć
                                        </button>
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        )
                      })()}
                    </div>
                  )}
                  <label className="order-field-full">
                    <span className="order-field-label-text">Notatki do zamówienia</span>
                    <textarea
                      rows={2}
                      value={notesBySupplier[group.supplier.id] ?? ''}
                      onChange={(e) => setNotesBySupplier((p) => ({ ...p, [group.supplier.id]: e.target.value }))}
                    />
                  </label>
                  <div className="order-form-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void generateForGroup(group)}
                      disabled={generatingSupplierId === group.supplier.id || generatingAll}
                    >
                      Generuj zamówienie
                    </button>
                  </div>
                </section>
              )
            })}
          </div>
        )}

        <div className="order-form-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void generateAll()}
            disabled={groups.length === 0 || generatingAll}
          >
            Generuj wszystkie
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
