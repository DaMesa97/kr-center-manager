import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Activity } from 'lucide-react'
import { PRODUCT_CATEGORY_LABELS } from '../../constants'
import type {
  Supplier,
  WarehouseComponent,
  WarehouseComponentCreateInput,
  WarehouseComponentUpdateInput,
} from '../../types'
import SkuLogisticsFields from './SkuLogisticsFields'

const UNIT_OPTIONS = ['mb', 'szt', 'm2', 'kg'] as const

type ComponentsViewProps = {
  isManager: boolean
  components: WarehouseComponent[]
  loading: boolean
  onCreate: (data: WarehouseComponentCreateInput) => Promise<void>
  onUpdate: (id: number, data: WarehouseComponentUpdateInput) => Promise<void>
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
  loading,
  onCreate,
  onUpdate,
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

  const openCreate = useCallback(() => {
    setModalMode('create')
    setEditingId(null)
    setForm(emptyForm())
    setModalOpen(true)
  }, [])

  const openEdit = useCallback((row: WarehouseComponent) => {
    setModalMode('edit')
    setEditingId(row.id)
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
  }, [])

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
    const code = form.code.trim()
    const name = form.name.trim()
    if (!code || !name) {
      window.alert('Uzupełnij kod i nazwę.')
      return
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
    setSaving(true)
    try {
      if (modalMode === 'create') {
        await onCreate({ ...payloadCommon, is_active: true })
      } else if (editingId != null) {
        await onUpdate(editingId, payloadCommon)
      }
      setModalOpen(false)
      setEditingId(null)
      setForm(emptyForm())
    } finally {
      setSaving(false)
    }
  }, [editingId, form, modalMode, onCreate, onUpdate])

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
          </div>
        </div>
      )}
      {loading ? (
        <p className="no-results">Ładowanie komponentów...</p>
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
                <th>NAZWA</th>
                <th>KOD</th>
                <th>KATEGORIA</th>
                <th>DOSTAWCA</th>
                {categoryFilter === 'door_wing' && (
                  <>
                    <th>MODEL</th>
                    <th>ROZMIAR</th>
                    <th>KIERUNEK</th>
                    <th>KOLOR</th>
                  </>
                )}
                {categoryFilter === 'door_frame' && (
                  <>
                    <th>TYP RAMKI</th>
                    <th>FRAME CODE</th>
                    <th>ROZMIAR</th>
                    <th>KIERUNEK</th>
                    <th>KOLOR</th>
                  </>
                )}
                {categoryFilter === 'door_handle' && (
                  <>
                    <th>MODEL</th>
                    <th>KOLOR</th>
                    <th>SZYLD</th>
                  </>
                )}
                {categoryFilter === 'door_hinge_cover' && (
                  <>
                    <th>KOLOR</th>
                  </>
                )}
                <th>JEDNOSTKA</th>
                <th>MIN / TARGET</th>
                {(categoryFilter === 'all' || categoryFilter === 'raw') && <th>UWAGI</th>}
                <th>AKCJE</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
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
                  <span className="order-field-label-text">Kod *</span>
                  <input
                    type="text"
                    value={form.code}
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
