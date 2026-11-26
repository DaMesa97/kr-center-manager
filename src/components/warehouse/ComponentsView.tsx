import { appAlert, appConfirm } from '../../lib/appDialogs'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Activity } from 'lucide-react'
import { PRODUCT_CATEGORY_LABELS } from '../../constants'
import { isOptimaImportedComponent } from '../../lib/internalWarehouse'
import { isStocked, setComponentsStocked } from '../../lib/warehouseStocked'
import BackgroundComponentsPanel from './BackgroundComponentsPanel'
import type {
  SmartRopRow,
  Supplier,
  ToastVariant,
  Warehouse,
  WarehouseComponent,
  WarehouseComponentCreateInput,
  WarehouseComponentUpdateInput,
  WarehouseStockRow,
} from '../../types'
import SkuLogisticsFields from './SkuLogisticsFields'
import Spinner from '../Spinner'
import DataTable, { type DataTableColumn } from '../DataTable'
import { isInternalWarehouseCode } from '../../utils'

const UNIT_OPTIONS = ['mb', 'szt', 'm2', 'kg'] as const

function slugifyCode(input: string): string {
  return input
    // Ł/ł nie rozkładają się w NFD (to nie znak diakrytyczny) — mapujemy ręcznie,
    // inaczej "PŁYTA" → "P-YTA" (bug ze zgłoszeń)
    .replace(/Ł/g, 'L')
    .replace(/ł/g, 'l')
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
  /** Smart ROP (get_all_smart_rop) — progi liczone z historii WZ; Zamawianie używa tych samych */
  smartRopData?: SmartRopRow[]
  editRequestComponent?: WarehouseComponent | null
  onEditRequestHandled?: () => void
  /** przestawianie „na magazynie” (kierownik, magazyn — rpc set_components_stocked) */
  canSetStocked?: boolean
  /** po zmianie is_stocked — odśwież komponenty (lista ładuje tylko trzymane na magazynie) */
  onComponentsChanged?: () => void | Promise<void>
  pushToast?: (message: string, variant: ToastVariant) => void
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
  order_multiple: '' as number | '',
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
  smartRopData = [],
  editRequestComponent,
  onEditRequestHandled,
  canSetStocked = false,
  onComponentsChanged,
  pushToast,
}: ComponentsViewProps) {
  // is_stocked (26.11): na co dzień lista = trzymane na magazynie; „kartoteki w tle” stronami z serwera
  const [showBackground, setShowBackground] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [stockBusy, setStockBusy] = useState(false)
  const toast = useCallback((m: string, v: ToastVariant) => (pushToast ? pushToast(m, v) : void appAlert(m)), [pushToast])
  const changeStocked = useCallback(
    async (ids: number[], stocked: boolean) => {
      if (ids.length === 0) return
      if (!stocked && !(await appConfirm(`Ustawić ${ids.length === 1 ? 'ten komponent' : `${ids.length} komponentów`} jako kartotekę w tle (towar na zamówienie)? Zniknie z listy, inwentaryzacji i wydań — stan nie będzie schodził.`))) return
      setStockBusy(true)
      try {
        const n = await setComponentsStocked(ids, stocked)
        toast(stocked ? `Na magazynie: ${n}` : `Kartoteki w tle: ${n} — znajdziesz je pod „Pokaż kartoteki w tle”`, 'success')
        setSelectedIds(new Set())
        await onComponentsChanged?.()
      } catch (e) {
        toast(`Nie zmieniono „na magazynie”: ${e instanceof Error ? e.message : String(e)}`, 'error')
      } finally {
        setStockBusy(false)
      }
    },
    [onComponentsChanged, toast],
  )

  const smartById = useMemo(() => new Map(smartRopData.map((r) => [r.component_id, r])), [smartRopData])
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
      door_accessory: components.filter((c) => c.product_category === 'door_accessory').length,
    }),
    [components],
  )

  // Liczniki dla PRAWDZIWYCH kategorii (ZAMKI I OKUCIA, BLACHY, SKRZYDŁA…) —
  // zgłoszenie #32: piguła "Surowce" wrzucała wszystko do jednego wora
  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>()
    components.forEach((c) => {
      const cat = c.category?.trim()
      if (!cat) return
      m.set(cat, (m.get(cat) ?? 0) + 1)
    })
    return m
  }, [components])

  // Wyszukiwarka + filtr po dostawcy (zgłoszenia z firmy)
  const [search, setSearch] = useState('')
  const [supplierFilter, setSupplierFilter] = useState<number | ''>('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return components.filter((c) => {
      if (categoryFilter.startsWith('cat:')) {
        if ((c.category?.trim() ?? '') !== categoryFilter.slice(4)) return false
      } else if (categoryFilter !== 'all' && c.product_category !== categoryFilter) return false
      if (supplierFilter !== '' && c.supplier_id !== supplierFilter) return false
      if (!q) return true
      return (
        c.name.toLowerCase().includes(q) ||
        (c.code ?? '').toLowerCase().includes(q) ||
        (c.category ?? '').toLowerCase().includes(q) ||
        // drzwi wewnętrzne (kilka tysięcy z kartotek Optimy): model, kolor, rozmiar
        [c.door_model, c.door_color, c.door_size].some((v) => (v ?? '').toLowerCase().includes(q))
      )
    })
  }, [components, categoryFilter, search, supplierFilter])

  const suppliersById = useMemo(
    () => new Map(suppliers.map((s) => [s.id, s])),
    [suppliers],
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
      order_multiple: row.order_multiple ?? '',
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
    async (row: WarehouseComponent) => {
      // komponent z kartotek Optimy: kod jest kluczem powiązania — tylko dezaktywacja (App.handleDeleteWarehouseComponent)
      const msg = isOptimaImportedComponent(row)
        ? `„${row.name}” pochodzi z kartotek Optimy — nie usuwamy go, tylko dezaktywujemy (zniknie z list, kod zostaje). Dezaktywować?`
        : 'Czy na pewno chcesz usunąć ten komponent?'
      if (!(await appConfirm(msg))) return
      await onDelete(row.id)
    },
    [onDelete],
  )

  const handleSubmit = useCallback(async () => {
    const name = form.name.trim()
    if (!name) {
      void appAlert('Uzupełnij nazwę.')
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
    const omRaw = form.order_multiple
    const omNum = omRaw === '' || omRaw === null || omRaw === undefined ? null : Number(omRaw)
    if (minNum !== null && Number.isNaN(minNum)) {
      void appAlert('Minimalny stan musi być liczbą.')
      return
    }
    if (targetNum !== null && Number.isNaN(targetNum)) {
      void appAlert('Docelowy stan musi być liczbą.')
      return
    }
    if (uppNum !== null && (Number.isNaN(uppNum) || uppNum < 1)) {
      void appAlert('Sztuki na palecie muszą być >= 1.')
      return
    }
    if (pftNum !== null && (Number.isNaN(pftNum) || pftNum < 1)) {
      void appAlert('Palety na pełny TIR muszą być >= 1.')
      return
    }
    if (omNum !== null && (!Number.isInteger(omNum) || omNum < 1)) {
      void appAlert('Minimum logistyczne musi być liczbą całkowitą >= 1.')
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
      order_multiple: omNum ?? (modalMode === 'create' ? 1 : null),
      notes: form.notes.trim() ? form.notes.trim() : null,
    }
    if (selectedWarehouseIds.length === 0) {
      void appAlert('Wybierz co najmniej jeden magazyn.')
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

  // Kolumny zależne od filtra (drzwi wewnętrzne mają swoje atrybuty)
  const componentColumns = useMemo((): DataTableColumn<WarehouseComponent>[] => {
    const col = (
      key: string,
      label: string,
      sortValue: (c: WarehouseComponent) => unknown,
      render: (c: WarehouseComponent) => ReactNode,
    ): DataTableColumn<WarehouseComponent> => ({ key, label, sortValue, render })
    const dash = (v: string | null | undefined) => v ?? '—'

    const cols: DataTableColumn<WarehouseComponent>[] = [
      ...(canSetStocked
        ? [
            {
              key: 'sel',
              label: '',
              title: 'Zaznacz do akcji masowej „Ustaw: kartoteka w tle”',
              stopRowClick: true,
              render: (row: WarehouseComponent) => (
                <input
                  type="checkbox"
                  checked={selectedIds.has(row.id)}
                  onChange={(e) =>
                    setSelectedIds((prev) => {
                      const n = new Set(prev)
                      if (e.target.checked) n.add(row.id)
                      else n.delete(row.id)
                      return n
                    })
                  }
                  aria-label={`Zaznacz ${row.name}`}
                />
              ),
            } as DataTableColumn<WarehouseComponent>,
          ]
        : []),
      col('name', 'NAZWA', (c) => c.name, (c) => c.name),
      { ...col('code', 'KOD', (c) => c.code, (c) => c.code ?? '—'), stackUnder: 'name' },
      col(
        'category',
        'KATEGORIA',
        (c) => (c.category?.trim() ? c.category : (PRODUCT_CATEGORY_LABELS[c.product_category] ?? c.product_category)),
        (row) =>
          row.category?.trim() ? (
            <span className="component-category-badge">{row.category}</span>
          ) : row.product_category && row.product_category !== 'raw' ? (
            <span className="component-category-badge">
              {PRODUCT_CATEGORY_LABELS[row.product_category] ?? row.product_category}
            </span>
          ) : (
            // "Surowiec" mylił (zgłoszenie #32) — puste = do uzupełnienia
            <span
              style={{ color: '#b45309', fontSize: '0.8rem' }}
              title="Komponent bez kategorii — uzupełnij w edycji (np. Zamki i okucia, Szklenie, Blachy)"
            >
              — uzupełnij
            </span>
          ),
      ),
      {
        ...col(
          'supplier',
          'DOSTAWCA',
          (c) => (c.supplier_id ? suppliersById.get(c.supplier_id)?.name ?? '' : ''),
          (row) => (row.supplier_id ? (suppliersById.get(row.supplier_id)?.name ?? '—') : '—'),
        ),
        stackUnder: 'category',
      },
    ]

    const model = col('model', 'MODEL', (c) => c.door_model, (c) => dash(c.door_model))
    const size = col('size', 'ROZMIAR', (c) => c.door_size, (c) => dash(c.door_size))
    const direction = { ...col('direction', 'KIERUNEK', (c) => c.door_direction, (c) => dash(c.door_direction)), stackUnder: 'size' }
    const color = col('color', 'KOLOR', (c) => c.door_color, (c) => dash(c.door_color))
    if (categoryFilter === 'door_wing') cols.push(model, size, direction, color)
    if (categoryFilter === 'door_frame') {
      cols.push(
        col('frame_type', 'TYP RAMKI', (c) => c.door_frame_type, (row) =>
          row.door_frame_type === 'simple' ? 'Prosta' : row.door_frame_type === 'adjustable' ? 'Regulowana' : '—',
        ),
        {
          ...col('frame_code', 'FRAME CODE', (c) => c.door_frame_code, (row) =>
            row.door_frame_type === 'adjustable' ? (row.door_frame_code ?? '—') : '—',
          ),
          stackUnder: 'frame_type',
        },
        size,
        direction,
        color,
      )
    }
    if (categoryFilter === 'door_handle') {
      cols.push(model, color, col('shield', 'SZYLD', (c) => c.door_handle_shield, (c) => dash(c.door_handle_shield)))
    }
    if (categoryFilter === 'door_hinge_cover') cols.push(color)

    cols.push(
      { ...col('unit', 'JEDNOSTKA', (c) => c.unit, (c) => c.unit), stackUnder: 'min' },
      // te same progi co w Zamawianiu: smart (z historii WZ) nadpisuje ręczne
      col('min', 'MIN / TARGET', (c) => smartById.get(c.id)?.effective_min_stock ?? c.min_stock_level, (row) => {
        const smart = smartById.get(row.id)
        const isSmart = smart?.smart_status === 'smart'
        const min = isSmart ? smart.effective_min_stock : row.min_stock_level
        const target = isSmart ? smart.effective_target_stock : row.target_stock_level
        const manual = `${row.min_stock_level ?? '—'} / ${row.target_stock_level ?? '—'}`
        return (
          <>
            {min != null ? min : '—'} / {target != null ? target : '—'}
            {isSmart && (
              <span
                className="smart-badge smart-badge--smart"
                style={{ marginLeft: 6 }}
                title={`Smart: ${smart.weeks_of_history ?? 0} tyg historii, avg ${smart.daily_avg?.toFixed(1) ?? '0'} szt/dzień · ręczne: ${manual}`}
              >
                🤖
              </span>
            )}
          </>
        )
      }),
    )
    cols.push({
      key: 'stocked',
      label: 'NA MAGAZYNIE',
      title: 'TAK = trzymamy na magazynie (inwentaryzacja, wydania zdejmują stan); NIE = kartoteka w tle, towar na zamówienie',
      sortValue: (c) => (isStocked(c) ? 1 : 0),
      stopRowClick: true,
      render: (row) =>
        canSetStocked ? (
          <button type="button" className="stocked-toggle" disabled={stockBusy} onClick={() => void changeStocked([row.id], !isStocked(row))} title={isStocked(row) ? 'Przestaw na: kartoteka w tle' : 'Przestaw na: trzymamy na magazynie'}>
            <span className={`stocked-badge ${isStocked(row) ? 'stocked-badge--yes' : 'stocked-badge--no'}`}>{isStocked(row) ? 'TAK' : 'NIE'}</span>
          </button>
        ) : (
          <span className={`stocked-badge ${isStocked(row) ? 'stocked-badge--yes' : 'stocked-badge--no'}`}>{isStocked(row) ? 'TAK' : 'NIE'}</span>
        ),
    })
    if (categoryFilter === 'all' || categoryFilter === 'raw' || categoryFilter.startsWith('cat:')) {
      cols.push({ ...col('notes', 'UWAGI', (c) => c.notes, (row) => (row.notes?.trim() ? row.notes : '—')), stackUnder: 'name' })
    }
    cols.push({
      key: 'actions',
      label: 'AKCJE',
      render: (row) => (
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
              <button type="button" className="btn btn-sm btn-primary" onClick={() => handleEdit(row)}>
                Edytuj
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => void handleDeleteRow(row)}
                title={isOptimaImportedComponent(row) ? 'Komponent z kartotek Optimy — tylko dezaktywacja' : undefined}
              >
                {isOptimaImportedComponent(row) ? 'Dezaktywuj' : 'Usuń'}
              </button>
            </>
          )}
        </div>
      ),
    })
    return cols
  }, [categoryFilter, suppliersById, smartById, isManager, onShowHistory, handleEdit, handleDeleteRow, canSetStocked, selectedIds, stockBusy, changeStocked])

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
                if (!(await appConfirm('Usunąć błędne (zerowe) półki — surowce z magazynów wewnętrznych i drzwi wewnętrzne spoza nich?'))) return
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
      <div className="stocked-switch">
        <label className="orders-filter-checkbox" title="Kartoteki z Optimy i inne komponenty, których nie trzymamy na magazynie (towar na zamówienie)">
          <input type="checkbox" checked={showBackground} onChange={(e) => { setShowBackground(e.target.checked); setSelectedIds(new Set()) }} />
          <span>Pokaż kartoteki w tle (nie na magazynie)</span>
        </label>
        {!showBackground && canSetStocked && selectedIds.size > 0 && (
          <>
            <button type="button" className="btn btn-sm btn-secondary" disabled={stockBusy} onClick={() => void changeStocked([...selectedIds], false)}>
              Ustaw: kartoteka w tle ({selectedIds.size})
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelectedIds(new Set())}>Odznacz</button>
          </>
        )}
      </div>
      {showBackground ? (
        <BackgroundComponentsPanel canEdit={canSetStocked} pushToast={toast} onChanged={async () => { await onComponentsChanged?.() }} />
      ) : loading ? (
        <Spinner center label="Ładowanie komponentów…" />
      ) : (
        <div>
          <div className="components-filter-pills">
            <button
              type="button"
              className={`alerts-filter-pill ${categoryFilter === 'all' ? 'alerts-filter-pill--active' : ''}`}
              onClick={() => setCategoryFilter('all')}
            >
              Wszystkie
              <span className="alerts-filter-pill-count">{counts.all}</span>
            </button>
            {/* prawdziwe kategorie zamiast worka "Surowce" (#32) */}
            {uniqueCategories.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`alerts-filter-pill ${categoryFilter === `cat:${cat}` ? 'alerts-filter-pill--active' : ''}`}
                onClick={() => setCategoryFilter(`cat:${cat}`)}
              >
                {cat}
                <span className="alerts-filter-pill-count">{categoryCounts.get(cat) ?? 0}</span>
              </button>
            ))}
            {/* moduł drzwi wewnętrznych — piguły tylko gdy coś w nich jest */}
            {[
              { key: 'door_wing', label: 'Skrzydła wewnętrzne' },
              { key: 'door_frame', label: 'Ościeżnice wewnętrzne' },
              { key: 'door_handle', label: 'Klamki' },
              { key: 'door_hinge_cover', label: 'Osłonki na zawias' },
              { key: 'door_accessory', label: 'Akcesoria drzwi wewn.' },
            ]
              .filter((p) => (counts[p.key as keyof typeof counts] as number) > 0)
              .map((p) => (
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
          <div className="orders-filters" style={{ margin: '8px 0 10px', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="text"
              className="search-input"
              placeholder="Szukaj po nazwie, kodzie lub kategorii…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: 240, flex: '1 1 220px' }}
            />
            <label className="day-filter" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span>Dostawca</span>
              <select
                className="day-filter"
                value={supplierFilter === '' ? '' : String(supplierFilter)}
                onChange={(e) => setSupplierFilter(e.target.value === '' ? '' : Number(e.target.value))}
              >
                <option value="">Wszyscy</option>
                {[...suppliers].sort((a, b) => a.name.localeCompare(b.name, 'pl')).map((s) => (
                  <option key={s.id} value={String(s.id)}>{s.name}</option>
                ))}
              </select>
            </label>
          </div>
          <DataTable
            rows={filtered}
            rowKey={(row) => row.id}
            columns={componentColumns}
            emptyText="Brak komponentów spełniających kryteria."
          />
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
                  orderMultiple={form.order_multiple}
                  setOrderMultiple={(n) => setForm((p) => ({ ...p, order_multiple: n }))}
                  minStockLevel={form.min_stock_level}
                  setMinStockLevel={(n) => setForm((p) => ({ ...p, min_stock_level: n }))}
                  targetStockLevel={form.target_stock_level}
                  setTargetStockLevel={(n) => setForm((p) => ({ ...p, target_stock_level: n }))}
                  suppliers={suppliers}
                  smart={editingId != null ? smartById.get(editingId) ?? null : null}
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
