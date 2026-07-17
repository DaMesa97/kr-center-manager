import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Activity } from 'lucide-react'
import { PRODUCT_CATEGORY_LABELS } from '../../constants'
import type {
  Supplier,
  Warehouse,
  WarehouseComponent,
  WarehouseComponentCreateInput,
  WarehouseComponentUpdateInput,
  WarehouseStockRow,
} from '../../types'
import SkuLogisticsFields from './SkuLogisticsFields'
import Spinner from '../Spinner'
import SortableTh from '../SortableTh'
import { sortRows, toggleSort, type SortState } from '../../lib/tableSort'
import { isInternalWarehouseCode } from '../../utils'

const UNIT_OPTIONS = ['mb', 'szt', 'm2', 'kg'] as const

function slugifyCode(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

type ComponentsViewProps = {
  isManager: boolean
  components: WarehouseComponent[]
  warehouses: Warehouse[]
  stock: WarehouseStockRow[]
  loading: boolean
  onCreate: (data: WarehouseComponentCreateInput, warehouseIds?: number[]) => Promise<void>
  onUpdate: (id: number, data: WarehouseComponentUpdateInput) => Promise<void>
  onSetComponentWarehouses: (componentId: number, warehouseIds: number[]) => Promise<void>
  onCleanupStock: () => Promise<void>
  onDelete: (id: number) => Promise<void>
  onAddDoorComponent: () => void
  onEditDoorComponent: (component: WarehouseComponent) => void
  onShowHistory: (component: WarehouseComponent) => void
  suppliers: Supplier[]
  editRequestComponent?: WarehouseComponent | null
  onEditRequestHandled?: () => void
}

type ModalMode = 'create' | 'edit'

const emptyForm = () => ({
  code: '',
  name: '',
  unit: 'szt' as (typeof UNIT_OPTIONS)[number],
  category: '',
  min_stock_level: '' as number | '',
  target_stock_level: '' as number | '',
  supplier_id: null as number | null,
  units_per_pallet: '' as number | '',
  pallets_per_full_tir: '' as number | '',
  notes: '',
})

function ComponentsView({
  isManager,
  components,
  warehouses,
  stock,
  loading,
  onCreate,
  onUpdate,
  onSetComponentWarehouses,
  onCleanupStock,
  onDelete,
  onAddDoorComponent,
  onEditDoorComponent,
  onShowHistory,
  suppliers,
  editRequestComponent,
  onEditRequestHandled,
}: ComponentsViewProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<ModalMode>('create')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [selectedWarehouseIds, setSelectedWarehouseIds] = useState<number[]>([])
  const [cleaning, setCleaning] = useState(false)

  const warehousesSorted = useMemo(
    () => [...warehouses].sort((a, b) => a.code.localeCompare(b.code)),
    [warehouses],
  )
  const nonInternalIds = useMemo(
    () => warehouses.filter((w) => !isInternalWarehouseCode(w.code)).map((w) => w.id),
    [warehouses],
  )
  // mapa komponent -> magazyny w których ma półkę (z warehouse_stock)
  const componentWarehouses = useMemo(() => {
    const m = new Map<number, number[]>()
    stock.forEach((s) => {
      const arr = m.get(s.component_id) ?? []
      arr.push(s.warehouse_id)
      m.set(s.component_id, arr)
    })
    return m
  }, [stock])

  const uniqueCategories = useMemo(() => {
    const set = new Set<string>()
    components.forEach((c) => {
      if (c.category?.trim()) set.add(c.category.trim())
    })
    return Array.from(set).sort()
  }, [components])

  const counts = useMemo(
    () => ({
      all: components.length,
      raw: components.filter((c) => c.product_category === 'raw').length,
      door_wing: components.filter((c) => c.product_category === 'door_wing').length,
      door_frame: components.filter((c) => c.product_category === 'door_frame').length,
      door_handle: components.filter((c) => c.product_category === 'door_handle').length,
      door_hinge_cover: components.filter((c) => c.product_category === 'door_hinge_cover').length,
    }),
    [components],
  )

  const filtered = useMemo(() => {
    if (categoryFilter === 'all') return components
    return components.filter((c) => c.product_category === categoryFilter)
  }, [components, categoryFilter])

  const suppliersById = useMemo(
    () => new Map(suppliers.map((s) => [s.id, s])),
    [suppliers],
  )

  // Sortowanie po kliknięciu nagłówka (3 stany: A→Z / Z→A / domyślne = kod)
  const [sort, setSort] = useState<SortState>(null)
  const handleSort = useCallback((key: string) => setSort((prev) => toggleSort(prev, key)), [])
  const sortedComponents = useMemo(
    () =>
      sortRows(filtered, sort, {
        name: (c) => c.name,
        code: (c) => c.code,
        category: (c) => PRODUCT_CATEGORY_LABELS[c.product_category] ?? c.product_category,
        supplier: (c) => (c.supplier_id ? suppliersById.get(c.supplier_id)?.name ?? '' : ''),
        model: (c) => c.door_model,
        size: (c) => c.door_size,
        direction: (c) => c.door_direction,
        color: (c) => c.door_color,
        frame_type: (c) => c.door_frame_type,
        frame_code: (c) => c.door_frame_code,
        shield: (c) => c.door_handle_shield,
        unit: (c) => c.unit,
        min: (c) => c.min_stock_level,
        notes: (c) => c.notes,
      }),
    [filtered, sort, suppliersById],
  )

  const openCreate = useCallback(() => {
    setModalMode('create')
    setEditingId(null)
    setForm(emptyForm())
    // surowiec domyślnie trafia do wszystkich magazynów oprócz WEWNETRZNE
    setSelectedWarehouseIds(nonInternalIds)
    setModalOpen(true)
  }, [nonInternalIds])

  const openEdit = useCallback((row: WarehouseComponent) => {
    setModalMode('edit')
    setEditingId(row.id)
    setSelectedWarehouseIds(componentWarehouses.get(row.id) ?? [])
    setForm({
      code: row.code ?? '',
      name: row.name,
      unit: (UNIT_OPTIONS.includes(row.unit as (typeof UNIT_OPTIONS)[number])
        ? row.unit
        : 'szt') as (typeof UNIT_OPTIONS)[number],
      category: row.category ?? '',
      min_stock_level: row.min_stock_level ?? '',
      target_stock_level: row.target_stock_level ?? '',
      supplier_id: row.supplier_id ?? null,
      units_per_pallet: row.units_per_pallet ?? '',
      pallets_per_full_tir: row.pallets_per_full_tir ?? '',
      notes: row.notes ?? '',
    })
    setModalOpen(true)
  }, [componentWarehouses])

  const closeModal = useCallback(() => {
    if (saving) return
    setModalOpen(false)
    setEditingId(null)
    setForm(emptyForm())
  }, [saving])

  const handleDeleteRow = useCallback(
    async (id: number) => {
      if (!window.confirm('Czy na pewno chcesz usunąć ten komponent?')) return
      await onDelete(id)
    },
    [onDelete],
  )

  const handleSubmit = useCallback(async () => {
    const name = form.name.trim()
    if (!name) {
      window.alert('Uzupełnij nazwę.')
      return
    }
    // Kod opcjonalny: jeśli pusty, generujemy automatycznie z nazwy i deduplikujemy
    let code = form.code.trim()
    if (!code) {
      const slug = slugifyCode(name)
      const base = (slug || 'KOMP').slice(0, 60)
      const existing = new Set(
        components
          .filter((c) => c.id !== editingId)
          .map((c) => (c.code ?? '').trim().toUpperCase())
          .filter(Boolean),
      )
      code = base
      let idx = 2
      while (existing.has(code.toUpperCase())) {
        code = `${base}-${idx}`
        idx += 1
      }
    }
    const categoryTrim = form.category.trim()
    const minRaw = form.min_stock_level
    const minNum =
      minRaw === '' || minRaw === null || minRaw === undefined
        ? null
        : Number(minRaw)
    const targetRaw = form.target_stock_level
    const targetNum =
      targetRaw === '' || targetRaw === null || targetRaw === undefined ? null : Number(targetRaw)
    const uppRaw = form.units_per_pallet
    const uppNum = uppRaw === '' || uppRaw === null || uppRaw === undefined ? null : Number(uppRaw)
    const pftRaw = form.pallets_per_full_tir
    const pftNum = pftRaw === '' || pftRaw === null || pftRaw === undefined ? null : Number(pftRaw)
    if (minNum !== null && Number.isNaN(minNum)) {
      window.alert('Minimalny stan musi być liczbą.')
      return
    }
    if (targetNum !== null && Number.isNaN(targetNum)) {
      window.alert('Docelowy stan musi być liczbą.')
      return
    }
    if (uppNum !== null && (Number.isNaN(uppNum) || uppNum < 1)) {
      window.alert('Sztuki na palecie muszą być >= 1.')
      return
    }
    if (pftNum !== null && (Number.isNaN(pftNum) || pftNum < 1)) {
      window.alert('Palety na pełny TIR muszą być >= 1.')
      return
    }
    const payloadCommon = {
      code,
      name,
      unit: form.unit,
      category: categoryTrim ? categoryTrim : null,
      min_stock_level: minNum,
      target_stock_level: targetNum,
      supplier_id: form.supplier_id,
      units_per_pallet: uppNum,
      pallets_per_full_tir: pftNum,
      notes: form.notes.trim() ? form.notes.trim() : null,
    }
    if (selectedWarehouseIds.length === 0) {
      window.alert('Wybierz co najmniej jeden magazyn.')
      return
    }
    setSaving(true)
    try {
      if (modalMode === 'create') {
        await onCreate({ ...payloadCommon, is_active: true }, selectedWarehouseIds)
      } else if (editingId != null) {
        await onUpdate(editingId, payloadCommon)
        await onSetComponentWarehouses(editingId, selectedWarehouseIds)
      }
      setModalOpen(false)
      setEditingId(null)
      setForm(emptyForm())
    } finally {
      setSaving(false)
    }
  }, [editingId, form, modalMode, onCreate, onUpdate, onSetComponentWarehouses, selectedWarehouseIds, components])

  const handleEdit = useCallback(
    (row: WarehouseComponent) => {
      if (row.product_category === 'raw') {
        openEdit(row)
      } else {
        onEditDoorComponent(row)
      }
    },
    [onEditDoorComponent, openEdit],
  )

  useEffect(() => {
    if (!editRequestComponent) return
    if (editRequestComponent.product_category === 'raw' || editRequestComponent.product_category == null) {
      openEdit(editRequestComponent)
    } else {
      onEditDoorComponent(editRequestComponent)
    }
    onEditRequestHandled?.()
  }, [editRequestComponent, onEditDoorComponent, onEditRequestHandled, openEdit])

  return (
    <>
      {isManager && (
        <div className="orders-filters" style={{ marginBottom: 12 }}>
          <div className="components-actions">
            <button type="button" className="btn btn-sm btn-primary" onClick={openCreate}>
              + Dodaj surowiec
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={onAddDoorComponent}>
              + Dodaj drzwi wewnętrzne
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={cleaning}
              title="Usuwa zerowe półki tam, gdzie komponent nie pasuje do magazynu (surowce z Wewnętrznych, drzwi spoza Wewnętrznych)."
              onClick={async () => {
                if (!window.confirm('Usunąć błędne (zerowe) półki — surowce z magazynów wewnętrznych i drzwi wewnętrzne spoza nich?')) return
                setCleaning(true)
                try {
                  await onCleanupStock()
                } finally {
                  setCleaning(false)
                }
              }}
            >
              {cleaning ? 'Czyszczę…' : 'Wyczyść błędne półki'}
            </button>
          </div>
        </div>
      )}
      {loading ? (
        <Spinner center label="Ładowanie komponentów…" />
      ) : (
        <div className="table-wrapper">
          <div className="components-filter-pills">
            {[
              { key: 'all', label: 'Wszystkie' },
              { key: 'raw', label: 'Surowce' },
              { key: 'door_wing', label: 'Skrzydła wewnętrzne' },
              { key: 'door_frame', label: 'Ościeżnice wewnętrzne' },
              { key: 'door_handle', label: 'Klamki' },
              { key: 'door_hinge_cover', label: 'Osłonki na zawias' },
            ].map((p) => (
              <button
                key={p.key}
                type="button"
                className={`alerts-filter-pill ${categoryFilter === p.key ? 'alerts-filter-pill--active' : ''}`}
                onClick={() => setCategoryFilter(p.key)}
              >
                {p.label}
                <span className="alerts-filter-pill-count">
                  {counts[p.key as keyof typeof counts]}
                </span>
              </button>
            ))}
          </div>
          <table className="orders-table">
            <thead>
              <tr>
                <SortableTh label="NAZWA" sortKey="name" state={sort} onToggle={handleSort} />
                <SortableTh label="KOD" sortKey="code" state={sort} onToggle={handleSort} />
                <SortableTh label="KATEGORIA" sortKey="category" state={sort} onToggle={handleSort} />
                <SortableTh label="DOSTAWCA" sortKey="supplier" state={sort} onToggle={handleSort} />
                {categoryFilter === 'door_wing' && (
                  <>
                    <SortableTh label="MODEL" sortKey="model" state={sort} onToggle={handleSort} />
                    <SortableTh label="ROZMIAR" sortKey="size" state={sort} onToggle={handleSort} />
                    <SortableTh label="KIERUNEK" sortKey="direction" state={sort} onToggle={handleSort} />
                    <SortableTh label="KOLOR" sortKey="color" state={sort} onToggle={handleSort} />
                  </>
                )}
                {categoryFilter === 'door_frame' && (
                  <>
                    <SortableTh label="TYP RAMKI" sortKey="frame_type" state={sort} onToggle={handleSort} />
                    <SortableTh label="FRAME CODE" sortKey="frame_code" state={sort} onToggle={handleSort} />
                    <SortableTh label="ROZMIAR" sortKey="size" state={sort} onToggle={handleSort} />
                    <SortableTh label="KIERUNEK" sortKey="direction" state={sort} onToggle={handleSort} />
                    <SortableTh label="KOLOR" sortKey="color" state={sort} onToggle={handleSort} />
                  </>
                )}
                {categoryFilter === 'door_handle' && (
                  <>
                    <SortableTh label="MODEL" sortKey="model" state={sort} onToggle={handleSort} />
                    <SortableTh label="KOLOR" sortKey="color" state={sort} onToggle={handleSort} />
                    <SortableTh label="SZYLD" sortKey="shield" state={sort} onToggle={handleSort} />
                  </>
                )}
                {categoryFilter === 'door_hinge_cover' && (
                  <>
                    <SortableTh label="KOLOR" sortKey="color" state={sort} onToggle={handleSort} />
                  </>
                )}
                <SortableTh label="JEDNOSTKA" sortKey="unit" state={sort} onToggle={handleSort} />
                <SortableTh label="MIN / TARGET" sortKey="min" state={sort} onToggle={handleSort} />
                {(categoryFilter === 'all' || categoryFilter === 'raw') && (
                  <SortableTh label="UWAGI" sortKey="notes" state={sort} onToggle={handleSort} />
                )}
                <th>AKCJE</th>
              </tr>
            </thead>
            <tbody>
              {sortedComponents.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.code ?? '—'}</td>
                  <td>
                    <span className="component-category-badge">
                      {PRODUCT_CATEGORY_LABELS[row.product_category] ?? row.product_category}
                    </span>
                  </td>
                  <td>{row.supplier_id ? (suppliersById.get(row.supplier_id)?.name ?? '—') : '—'}</td>
                  {categoryFilter === 'door_wing' && (
                    <>
                      <td>{row.door_model ?? '—'}</td>
                      <td>{row.door_size ?? '—'}</td>
                      <td>{row.door_direction ?? '—'}</td>
                      <td>{row.door_color ?? '—'}</td>
                    </>
                  )}
                  {categoryFilter === 'door_frame' && (
                    <>
                      <td>
                        {row.door_frame_type === 'simple'
                          ? 'Prosta'
                          : row.door_frame_type === 'adjustable'
                            ? 'Regulowana'
                            : '—'}
                      </td>
                      <td>{row.door_frame_type === 'adjustable' ? (row.door_frame_code ?? '—') : '—'}</td>
                      <td>{row.door_size ?? '—'}</td>
                      <td>{row.door_direction ?? '—'}</td>
                      <td>{row.door_color ?? '—'}</td>
                    </>
                  )}
                  {categoryFilter === 'door_handle' && (
                    <>
                      <td>{row.door_model ?? '—'}</td>
                      <td>{row.door_color ?? '—'}</td>
                      <td>{row.door_handle_shield ?? '—'}</td>
                    </>
                  )}
                  {categoryFilter === 'door_hinge_cover' && (
                    <>
                      <td>{row.door_color ?? '—'}</td>
                    </>
                  )}
                  <td>{row.unit}</td>
                  <td>
                    {row.min_stock_level != null ? row.min_stock_level : '—'} /{' '}
                    {row.target_stock_level != null ? row.target_stock_level : '—'}
                  </td>
                  {(categoryFilter === 'all' || categoryFilter === 'raw') && (
                    <td>{row.notes?.trim() ? row.notes : '—'}</td>
                  )}
                  <td>
                    <div className="contractor-actions">
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => onShowHistory(row)}
                        title="Historia ruchów"
                      >
                        <Activity size={14} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
                        Historia
                      </button>
                      {isManager && (
                        <>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => handleEdit(row)}
                        >
                          Edytuj
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => void handleDeleteRow(row.id)}
                        >
                          Usuń
                        </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="no-results">Brak aktywnych komponentów.</p>
          )}
        </div>
      )}

      {modalOpen &&
        createPortal(
          <div className="modal-overlay" role="dialog" aria-modal="true" onClick={closeModal}>
            <div className="order-modal order-modal--sta" onClick={(e) => e.stopPropagation()}>
              <div className="order-modal-header">
                <h2>{modalMode === 'create' ? 'Nowy komponent' : 'Edycja komponentu'}</h2>
                <button type="button" className="btn btn-icon btn-ghost" onClick={closeModal}>
                  X
                </button>
              </div>
              <div className="order-form-grid order-form-grid--sta">
                <label className="order-field-full">
                  <span className="order-field-label-text">Kod (auto jeśli puste)</span>
                  <input
                    type="text"
                    value={form.code}
                    placeholder="auto z nazwy"
                    onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
                    disabled={saving}
                  />
                </label>
                <label className="order-field-full">
                  <span className="order-field-label-text">Nazwa *</span>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    disabled={saving}
                  />
                </label>
                <label className="order-field-full">
                  <span className="order-field-label-text">Jednostka</span>
                  <select
                    value={form.unit}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        unit: e.target.value as (typeof UNIT_OPTIONS)[number],
                      }))
                    }
                    disabled={saving}
                  >
                    {UNIT_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="order-field-full">
                  <span className="order-field-label-text">Kategoria</span>
                  <input
                    type="text"
                    list="component-categories-datalist"
                    value={form.category}
                    onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                    disabled={saving}
                  />
                  <datalist id="component-categories-datalist">
                    {uniqueCategories.map((cat) => (
                      <option key={cat} value={cat} />
                    ))}
                  </datalist>
                </label>
                <label className="order-field-full">
                  <span className="order-field-label-text">Uwagi</span>
                  <textarea
                    rows={3}
                    value={form.notes}
                    onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                    disabled={saving}
                  />
                </label>
                <SkuLogisticsFields
                  supplierId={form.supplier_id}
                  setSupplierId={(id) => setForm((p) => ({ ...p, supplier_id: id }))}
                  unitsPerPallet={form.units_per_pallet}
                  setUnitsPerPallet={(n) => setForm((p) => ({ ...p, units_per_pallet: n }))}
                  palletsPerFullTir={form.pallets_per_full_tir}
                  setPalletsPerFullTir={(n) => setForm((p) => ({ ...p, pallets_per_full_tir: n }))}
                  minStockLevel={form.min_stock_level}
                  setMinStockLevel={(n) => setForm((p) => ({ ...p, min_stock_level: n }))}
                  targetStockLevel={form.target_stock_level}
                  setTargetStockLevel={(n) => setForm((p) => ({ ...p, target_stock_level: n }))}
                  suppliers={suppliers}
                />
                <div className="order-field-full">
                  <span className="order-field-label-text">Magazyny</span>
                  <div className="component-wh-picker">
                    {warehousesSorted.map((w) => {
                      const checked = selectedWarehouseIds.includes(w.id)
                      return (
                        <label key={w.id} className={`component-wh-chip ${checked ? 'component-wh-chip--on' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={saving}
                            onChange={(e) =>
                              setSelectedWarehouseIds((prev) =>
                                e.target.checked ? [...prev, w.id] : prev.filter((id) => id !== w.id),
                              )
                            }
                          />
                          {w.code}
                        </label>
                      )
                    })}
                  </div>
                  <span className="component-wh-hint">
                    Komponent będzie widoczny i przyjmowany tylko w zaznaczonych magazynach.
                  </span>
                </div>
              </div>
              <div className="order-form-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void handleSubmit()}
                  disabled={saving}
                >
                  {saving ? 'Zapisywanie...' : 'Zapisz'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

export default ComponentsView
