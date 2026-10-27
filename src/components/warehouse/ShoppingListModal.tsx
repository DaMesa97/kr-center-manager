import { appConfirm } from '../../lib/appDialogs'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../supabaseClient'
import type {
  ShoppingListItem,
  Supplier,
  ToastVariant,
  WarehouseComponent,
  WarehouseStockRow,
} from '../../types'
import DataTable from '../DataTable'

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
  // Magazyn docelowy dostawy — "w drodze" liczy się per magazyn, więc ZD
  // musi wiedzieć, dokąd jedzie towar (magazyny WEW* to wyroby, nie surowce)
  const [targetWarehouses, setTargetWarehouses] = useState<{ id: number; code: string; name: string }[]>([])
  const [targetWarehouseId, setTargetWarehouseId] = useState<number | ''>('')
  useEffect(() => {
    if (!open) return
    void (async () => {
      const { data } = await supabase
        .from('warehouses')
        .select('id, code, name')
        .eq('is_active', true)
        .order('id')
      const raw = ((data ?? []) as { id: number; code: string; name: string }[]).filter(
        (w) => !String(w.code).toUpperCase().startsWith('WEW'),
      )
      setTargetWarehouses(raw)
      setTargetWarehouseId((prev) => (prev === '' && raw.length > 0 ? raw[0].id : prev))
    })()
  }, [open])
  const [suggestedQuantities, setSuggestedQuantities] = useState<Record<number, number>>({})
  const [quickSearch, setQuickSearch] = useState('')
  // Zamawianie „od dostawcy": wybór dostawcy na górze pokazuje jego SKU do
  // dorzucenia, zanim cokolwiek jest na liście (wcześniej podpowiedzi były
  // tylko przy sekcji dostawcy, więc przy pustej liście nie było od czego zacząć)
  const [browseSupplierId, setBrowseSupplierId] = useState<number | ''>('')
  const [quickQty, setQuickQty] = useState<Record<number, string>>({})
  // Szukajka w podpowiedziach „dorzuć od dostawcy" — osobna per dostawca
  const [candidateSearch, setCandidateSearch] = useState<Record<number, string>>({})

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers])
  const supplierOptions = useMemo(() => {
    const counts = new Map<number, number>()
    for (const c of components) {
      if (c.is_active && c.supplier_id) counts.set(c.supplier_id, (counts.get(c.supplier_id) ?? 0) + 1)
    }
    return suppliers
      .filter((s) => s.is_active && counts.has(s.id))
      .map((s) => ({ supplier: s, count: counts.get(s.id) ?? 0 }))
      .sort((a, b) => a.supplier.name.localeCompare(b.supplier.name, 'pl'))
  }, [components, suppliers])

  const quickResults = useMemo(() => {
    const q = quickSearch.trim().toLowerCase()
    if (!q) return []
    return components
      .filter((c) => c.is_active)
      .filter((c) => browseSupplierId === '' || c.supplier_id === browseSupplierId)
      .filter((c) => !shoppingList.some((s) => s.component_id === c.id))
      .filter((c) => {
        const supplierName = c.supplier_id ? supplierById.get(c.supplier_id)?.name ?? '' : ''
        return (
          c.name.toLowerCase().includes(q) ||
          (c.code ?? '').toLowerCase().includes(q) ||
          supplierName.toLowerCase().includes(q)
        )
      })
      .slice(0, 15)
  }, [quickSearch, components, shoppingList, supplierById, browseSupplierId])
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
    // zapełnienie TIRa da się policzyć tylko, gdy pozycje mają szt/paletę i palet/TIR
    const hasTirData = group.items.some(
      (item) => (item.units_per_pallet ?? 0) > 0 && (item.pallets_per_full_tir ?? 0) > 0,
    )
    const pallets = group.items.reduce((sum, item) => {
      if (!item.units_per_pallet || item.units_per_pallet <= 0) return sum
      return sum + Math.ceil(item.quantity / item.units_per_pallet)
    }, 0)
    const fillness = group.items.reduce((sum, item) => {
      if (!item.units_per_pallet || item.units_per_pallet <= 0) return sum
      if (!item.pallets_per_full_tir || item.pallets_per_full_tir <= 0) return sum
      return sum + Math.ceil(item.quantity / item.units_per_pallet) / item.pallets_per_full_tir
    }, 0)
    return { pallets, fillness, hasTirData }
  }

  const calculateRunwayLabel = (proximityToMin: number | null): string => {
    if (proximityToMin == null) return 'brak progu'
    if (proximityToMin <= 0) return '⚠️ Krytyczny'
    if (proximityToMin < 5) return `${proximityToMin} szt do min`
    return 'OK'
  }

  // Inne SKU tego dostawcy do dorzucenia do tej samej dostawy. Najpierw te
  // najbliżej progu min, potem bez progu alfabetycznie; dane o paletach nie są
  // wymagane (bez nich nie ma tylko kolumny palet i zapełnienia TIRa).
  const getCandidatesForSupplier = (supplierId: number, search: string, limit: number) => {
    const q = search.trim().toLowerCase()
    const all = components
      .filter((c) => c.supplier_id === supplierId)
      .filter((c) => c.is_active)
      .filter((c) => !shoppingList.some((s) => s.component_id === c.id))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.code ?? '').toLowerCase().includes(q))
      .map((component) => {
        const currentStock = stockByComponentId.get(component.id) ?? 0
        const proximityToMin =
          component.min_stock_level == null ? null : currentStock - component.min_stock_level
        return { component, currentStock, proximityToMin }
      })
      .sort((a, b) => {
        if (a.proximityToMin == null && b.proximityToMin == null) {
          return a.component.name.localeCompare(b.component.name, 'pl')
        }
        if (a.proximityToMin == null) return 1
        if (b.proximityToMin == null) return -1
        return a.proximityToMin - b.proximityToMin
      })
    return { rows: all.slice(0, limit), total: all.length }
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

  const handleQuickAdd = (component: WarehouseComponent) => {
    const supplier = component.supplier_id ? supplierById.get(component.supplier_id) ?? null : null
    const currentStock = stockByComponentId.get(component.id) ?? 0
    const qty = parseInt(quickQty[component.id] ?? '') || Math.max(component.units_per_pallet ?? 1, 1)
    onAddToShoppingList({
      component_id: component.id,
      component_name: component.name,
      component_code: component.code ?? '',
      supplier_id: component.supplier_id ?? null,
      supplier_name: supplier?.name ?? null,
      quantity: Math.max(1, qty),
      units_per_pallet: component.units_per_pallet ?? null,
      pallets_per_full_tir: component.pallets_per_full_tir ?? null,
      current_stock: currentStock,
      min_stock_level: component.min_stock_level ?? null,
      target_stock_level: component.target_stock_level ?? null,
    })
    setQuickQty((prev) => ({ ...prev, [component.id]: '' }))
  }

  // pod sekcją dostawcy — krótka podpowiedź (10); przeglądanie dostawcy — do 50 z licznikiem
  const renderCandidates = (supplierId: number, limit = 10) => {
    const { rows: candidates, total } = getCandidatesForSupplier(supplierId, candidateSearch[supplierId] ?? '', limit)
    return (
      <>
        <input
          type="text"
          className="search-input"
          placeholder="Szukaj w SKU tego dostawcy (nazwa lub kod)…"
          value={candidateSearch[supplierId] ?? ''}
          onChange={(e) => setCandidateSearch((prev) => ({ ...prev, [supplierId]: e.target.value }))}
          style={{ marginBottom: 8 }}
        />
        {total > candidates.length && (
          <p className="reorder-row-meta" style={{ margin: '0 0 6px' }}>
            Pokazuję {candidates.length} z {total} SKU — zawęź szukajką, żeby zobaczyć pozostałe.
          </p>
        )}
        {candidates.length === 0 ? (
          <p className="no-results" style={{ margin: 0 }}>
            {candidateSearch[supplierId]?.trim() ? 'Nic nie pasuje u tego dostawcy.' : 'Brak dodatkowych SKU u tego dostawcy do dorzucenia.'}
          </p>
        ) : (
          <DataTable
            rows={candidates}
            rowKey={(c) => c.component.id}
            wrapperClassName="shopping-list-suggestions-table"
            columns={[
              { key: 'sku', label: 'SKU', render: ({ component }) => component.name },
              {
                key: 'stock',
                label: 'Stock / Min',
                render: ({ component, currentStock, proximityToMin }) => (
                  <>
                    {currentStock} / {component.min_stock_level ?? '—'}{' '}
                    {proximityToMin != null && proximityToMin <= 0 && (
                      <span className="subtab-badge subtab-badge--alert">PONIŻEJ MIN</span>
                    )}
                  </>
                ),
              },
              {
                key: 'runway',
                label: 'Runway',
                render: ({ proximityToMin }) => calculateRunwayLabel(proximityToMin),
              },
              {
                key: 'qty',
                label: 'Sugerowana ilość',
                render: ({ component }) => (
                  <input
                    type="number"
                    min={1}
                    step={Math.max(component.units_per_pallet ?? 1, 1)}
                    className="extension-qty-input"
                    value={getSuggestedQty(component)}
                    onChange={(e) =>
                      setSuggestedQuantities((prev) => ({
                        ...prev,
                        [component.id]: Math.max(1, Number(e.target.value) || 1),
                      }))
                    }
                  />
                ),
              },
              {
                key: 'pallets',
                label: 'Palety',
                render: ({ component }) =>
                  component.units_per_pallet && component.units_per_pallet > 0
                    ? Math.ceil(getSuggestedQty(component) / component.units_per_pallet)
                    : '—',
              },
              {
                key: 'action',
                label: 'Akcja',
                render: ({ component, currentStock }) => (
                  <button
                    type="button"
                    className="btn btn-sm btn-primary suggestion-add-btn"
                    onClick={() => handleAddSuggestion(component, currentStock, getSuggestedQty(component))}
                  >
                    + Dorzuć
                  </button>
                ),
              },
            ]}
          />
        )}
      </>
    )
  }

  const generateForGroup = async (group: Group) => {
    if (targetWarehouseId === '') {
      pushToast('Wybierz magazyn docelowy dostawy', 'error')
      return
    }
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
      p_warehouse_id: targetWarehouseId,
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
    if (targetWarehouseId === '') {
      pushToast('Wybierz magazyn docelowy dostawy', 'error')
      return
    }
    setGeneratingAll(true)
    // Snapshot grup — chroni przed zmianą danych (realtime) w trakcie pętli
    const groupsSnapshot = [...groups]
    let okCount = 0
    let failCount = 0
    for (const group of groupsSnapshot) {
      const payload = group.items.map((item) => ({
        component_id: item.component_id,
        quantity_ordered: item.quantity,
        notes: null,
      }))
      const { error } = await supabase.rpc('create_purchase_order', {
        p_supplier_id: group.supplier.id,
        p_items: payload,
        p_notes: notesBySupplier[group.supplier.id]?.trim() || null,
        p_warehouse_id: targetWarehouseId,
      })
      if (error) {
        // Nie przerywaj całości — pomiń tego dostawcę, kontynuuj resztę
        pushToast(`Błąd generowania dla ${group.supplier.name}: ${error.message}`, 'error')
        failCount++
        continue
      }
      // Usuń z listy tylko pozycje pomyślnie wygenerowane
      group.items.forEach((item) => onRemove(item.component_id))
      okCount++
    }
    setGeneratingAll(false)
    if (okCount > 0) {
      pushToast(
        failCount > 0
          ? `Wygenerowano ${okCount} zamówień, ${failCount} nieudanych — sprawdź listę`
          : 'Wygenerowano zamówienia dla wszystkich dostawców',
        failCount > 0 ? 'info' : 'success',
      )
    }
    onGenerated()
  }

  if (!open) return null

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="order-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1100 }}>
        <div className="order-modal-header">
          <h2>Lista zakupowa ({shoppingList.length} pozycji)</h2>
          <div className="contractor-actions">
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
              Magazyn docelowy:
              <select
                value={targetWarehouseId}
                onChange={(e) => setTargetWarehouseId(e.target.value === '' ? '' : Number(e.target.value))}
                title="Dokąd pojedzie ta dostawa — od tego liczy się 'w drodze' i prognoza magazynu"
              >
                {targetWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={async () => {
                if (!(await appConfirm('Wyczyścić całą listę zakupową?'))) return
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

        {/* Środek modala przewija się osobno — .order-modal ma overflow hidden,
            więc bez tego kontenera długa lista była ucięta i nie dało się jej przewinąć */}
        <div className="order-modal-body">
        {/* Szybkie dodawanie */}
        <div className="shopping-quick-add">
          <div className="shopping-quick-bar">
            <select
              className="day-filter"
              value={browseSupplierId}
              onChange={(e) => setBrowseSupplierId(e.target.value === '' ? '' : Number(e.target.value))}
              title="Zamawiaj od dostawcy: pokaż jego SKU do dorzucenia i zawęź szybkie dodawanie"
            >
              <option value="">Dostawca: wszyscy</option>
              {supplierOptions.map(({ supplier, count }) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name} ({count})
                </option>
              ))}
            </select>
            <input
              type="text"
              className="search-input"
              placeholder={browseSupplierId === '' ? '🔍 Szybkie dodawanie — nazwa, kod lub dostawca…' : '🔍 Szybkie dodawanie — w SKU tego dostawcy…'}
              value={quickSearch}
              onChange={(e) => setQuickSearch(e.target.value)}
            />
          </div>
          {quickResults.length > 0 && (
            <div className="shopping-quick-results">
              {quickResults.map((c) => {
                const supplier = c.supplier_id ? supplierById.get(c.supplier_id) : null
                const currentStock = stockByComponentId.get(c.id) ?? 0
                const defaultQty = Math.max(c.units_per_pallet ?? 1, 1)
                return (
                  <div key={c.id} className="shopping-quick-row">
                    <div className="shopping-quick-info">
                      <strong>{c.name}</strong>
                      <span className="shopping-quick-meta">
                        Stock: {currentStock}
                        {supplier ? ` · ${supplier.name}` : ' · ⚠️ brak dostawcy'}
                      </span>
                    </div>
                    <div className="shopping-quick-actions">
                      <input
                        type="number"
                        min={1}
                        className="reorder-qty-input"
                        placeholder={String(defaultQty)}
                        value={quickQty[c.id] ?? ''}
                        onChange={(e) => setQuickQty((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      />
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => handleQuickAdd(c)}
                      >
                        + Dodaj
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {browseSupplierId !== '' && (() => {
          const supplier = supplierById.get(browseSupplierId)
          if (!supplier) return null
          const onList = shoppingList.filter((i) => i.supplier_id === supplier.id).length
          return (
            <section className="reorder-section shopping-browse">
              <div className="reorder-row" style={{ alignItems: 'center' }}>
                <div>
                  <strong>{supplier.name}</strong>{' '}
                  <span className="reorder-row-meta">• Czas realizacji: {supplier.lead_time_days ?? '—'} dni</span>
                  {supplier.requires_full_tir && (
                    <span className="supplier-badge supplier-badge--yes" style={{ marginLeft: 8 }}>Wymaga pełnego TIR</span>
                  )}
                  <span className="reorder-row-meta" style={{ marginLeft: 8 }}>
                    {onList > 0 ? `· na liście: ${onList}` : '· nic jeszcze na liście'}
                  </span>
                </div>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setBrowseSupplierId('')}>✕ Zamknij</button>
              </div>
              <div className="shopping-list-suggestions" style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
                <div className="shopping-list-suggestions-header" style={{ fontWeight: 600, marginBottom: 8 }}>
                  💡 SKU tego dostawcy — najpierw najbliżej progu min:
                </div>
                {renderCandidates(supplier.id, 50)}
              </div>
            </section>
          )
        })()}

        {orphanItems.length > 0 && (
          <div className="reorder-info-banner" style={{ marginBottom: 10 }}>
            ℹ️ {orphanItems.length} pozycji bez przypisanego dostawcy zostało pominiętych. Wróć do dashboardu i
            przypisz dostawców.
          </div>
        )}

        {groups.length === 0 ? (
          <p className="no-results">
            Lista jest pusta. Wybierz dostawcę u góry albo wpisz nazwę w szybkim dodawaniu — dorzucone pozycje
            pogrupują się po dostawcach, a z każdej grupy wygenerujesz zamówienie.
          </p>
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
                  <DataTable
                    rows={group.items}
                    rowKey={(item) => item.component_id}
                    columns={[
                      { key: 'sku', label: 'SKU', render: (item) => item.component_name },
                      {
                        key: 'stock',
                        label: 'Stock / Min/Target',
                        render: (item) => (
                          <>
                            {item.current_stock} | {item.min_stock_level ?? '—'}/{item.target_stock_level ?? '—'}
                          </>
                        ),
                      },
                      {
                        key: 'qty',
                        label: 'Ilość zamawiana',
                        render: (item) => (
                          <input
                            type="number"
                            min={1}
                            value={item.quantity}
                            className="extension-qty-input"
                            onChange={(e) => onUpdateQuantity(item.component_id, Math.max(1, Number(e.target.value) || 1))}
                          />
                        ),
                      },
                      {
                        key: 'pallets',
                        label: 'Palety',
                        render: (item) =>
                          item.units_per_pallet && item.units_per_pallet > 0
                            ? Math.ceil(item.quantity / item.units_per_pallet)
                            : '—',
                      },
                      {
                        key: 'action',
                        label: 'Akcja',
                        render: (item) => (
                          <button type="button" className="btn btn-sm btn-danger" onClick={() => onRemove(item.component_id)}>
                            Usuń
                          </button>
                        ),
                      },
                    ]}
                  />
                  <div className="reorder-row-meta">
                    Suma pozycji: {group.items.length}
                    {group.supplier.requires_full_tir && stats.hasTirData && (
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
                    {group.supplier.requires_full_tir && !stats.hasTirData && (
                      <> | Wymaga pełnego TIR — zapełnienie policzę, gdy pozycje będą miały szt/paletę i palet/TIR (Komponenty)</>
                    )}
                  </div>
                  <div
                    className="shopping-list-suggestions"
                    style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginTop: 10 }}
                  >
                    <div className="shopping-list-suggestions-header" style={{ fontWeight: 600, marginBottom: 8 }}>
                      {group.supplier.requires_full_tir && stats.hasTirData && stats.fillness < 0.95
                        ? `💡 Brakuje ${(100 - stats.fillness * 100).toFixed(0)}% do pełnego TIRa. Dorzuć z SKU tego dostawcy:`
                        : '💡 Dorzuć inne SKU tego dostawcy do tej samej dostawy:'}
                    </div>
                    {renderCandidates(group.supplier.id)}
                  </div>
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
        </div>

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
