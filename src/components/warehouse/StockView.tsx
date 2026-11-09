// =====================================================================
// Magazyn → Stany: poziomy braków. Reguły (krytyczny / pokryty dostawą / niski /
// OK / nieaktywny) i „do zamówienia” liczy BAZA — widok v_stock_levels
// (migrate/magazyn_poziomy_brakow.sql). Tu: filtry, liczniki, sortowanie
// „najpierw braki”, minimum półki (inline + hurtowo), eksport braków.
// =====================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ShoppingListItem, SmartRopRow, StockLevel, StockLevelRow, StockMinimumInput, Supplier, ToastVariant, Warehouse,
  WarehouseComponent,
} from '../../types'
import DamageReportModal from '../DamageReportModal'
import Spinner from '../Spinner'
import DataTable, { type DataTableColumn } from '../DataTable'
import StockAtDateExport from './StockAtDateExport'
import type { SortState } from '../../lib/tableSort'
import { appConfirm } from '../../lib/appDialogs'
import {
  aggregateStockLevels, buildStockShortageCsv, compareByStockLevel, countStockLevels, isStockProblem, minSourceLabel,
  parseMinInput, stockLevelHint, stockLevelLabel, type AggregatedStockLevelRow,
} from '../../lib/stockLevels'

type LevelFilter = StockLevel | 'problems' | null
type SortMode = 'worst' | 'alpha'

const PREFS_KEY = 'kr-stock-view'
type Prefs = { levelFilter: LevelFilter; sortMode: SortMode; warehouseId: number | ''; hideInactive: boolean }
const DEFAULT_PREFS: Prefs = { levelFilter: null, sortMode: 'worst', warehouseId: '', hideInactive: false }

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    const p = JSON.parse(raw) as Partial<Prefs>
    return {
      levelFilter: p.levelFilter ?? null,
      sortMode: p.sortMode === 'alpha' ? 'alpha' : 'worst',
      warehouseId: typeof p.warehouseId === 'number' ? p.warehouseId : '',
      hideInactive: p.hideInactive === true,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

// 'YYYY-MM-DD' → 'DD.MM.RRRR'
function formatDatePl(d: string | null | undefined): string {
  if (!d) return ''
  const [y, m, day] = d.slice(0, 10).split('-')
  return y && m && day ? `${day}.${m}.${y}` : d
}

const orDash = (v: string | null | undefined) => (v?.trim() ? v : '—')
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3))))

const renderAvailableCell = (available: number) => (
  <strong style={available < 0 ? { color: '#c62828' } : undefined}>{fmtQty(available)}</strong>
)

const renderIncomingCell = (qty: number, eta: string | null, openPos: number) => {
  if (qty <= 0) return <span>—</span>
  const tooltip = [`Najbliższa dostawa: ${formatDatePl(eta) || 'brak daty'}`, `Otwarte ZD: ${openPos}`].join('\n')
  return (
    <span title={tooltip} style={{ cursor: 'help', textDecoration: 'underline dotted' }}>
      {fmtQty(qty)}
    </span>
  )
}

const renderShortageCell = (shortage: number) =>
  shortage > 0 ? <span className="stock-shortage">{fmtQty(shortage)}</span> : <span>—</span>

const renderLevelCell = (level: StockLevel, eta?: string | null) => (
  <span className={`stock-level-label stock-level-label--${level}`} title={stockLevelHint(level)}>
    <span className={`stock-level-dot stock-level-dot--${level}`} aria-hidden />
    {level === 'critical' ? '⚠ ' : ''}
    {stockLevelLabel(level)}
    {level === 'covered' && eta ? <span className="stock-min-src">({formatDatePl(eta)})</span> : null}
  </span>
)

// wiersz-odniesienie do sortowania kolumny STATUS (ranga poziomu przez compareByStockLevel)
const LEVEL_SORT_REF = { level: 'ok' as StockLevel, shortage: 0, component_code: '', component_name: '', available_quantity: 0 }

type StockViewProps = {
  warehouses: Warehouse[]
  components: WarehouseComponent[]
  /** poziomy braków per półka — v_stock_levels */
  levels: StockLevelRow[]
  suppliers?: Supplier[]
  /** tylko do tooltipa 🤖 (szczegóły Smart ROP) — źródło minimum podaje baza */
  smartRopData?: SmartRopRow[]
  loading: boolean
  isManager?: boolean
  /** minimum półki — role, które dziś edytują magazyn (warehouse.manage) */
  canEditMin?: boolean
  onSetMinimums?: (items: StockMinimumInput[]) => Promise<boolean>
  onAddToShoppingList?: (item: ShoppingListItem) => void
  /** PZ z widoku stanów (warehouse.movements); domyślnie = isManager */
  canAddPz?: boolean
  onAddPz?: (warehouseId?: number) => void
  onShowHistory: (component: WarehouseComponent) => void
  pushToast?: (msg: string, variant: ToastVariant) => void
  onStockChanged?: () => void
}

function StockView({
  warehouses, components, levels, suppliers = [], smartRopData = [], loading, isManager, canEditMin, onSetMinimums,
  onAddToShoppingList, canAddPz, onAddPz, onShowHistory, pushToast, onStockChanged,
}: StockViewProps) {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* prywatne okno */ }
  }, [prefs])
  const { levelFilter, sortMode, hideInactive } = prefs
  const selectedWarehouseId: number | '' =
    prefs.warehouseId !== '' && warehouses.some((w) => w.id === prefs.warehouseId) ? prefs.warehouseId : ''
  const setSelectedWarehouseId = (id: number | '') => setPrefs((p) => ({ ...p, warehouseId: id }))

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [supplierFilter, setSupplierFilter] = useState<number | ''>('')
  const [sort, setSort] = useState<SortState>(null)
  const [damageTarget, setDamageTarget] = useState<{ componentId: number; warehouseId: number | null } | null>(null)
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [bulkValue, setBulkValue] = useState('')
  const [editing, setEditing] = useState<{ stockId: number; value: string } | null>(null)
  const [expandedComponent, setExpandedComponent] = useState<number | null>(null)
  const [expandedValues, setExpandedValues] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const editInputRef = useRef<HTMLInputElement | null>(null)
  const canEdit = Boolean(canEditMin && onSetMinimums)

  const smartById = useMemo(() => {
    const m = new Map<number, SmartRopRow>()
    for (const r of smartRopData) if (r.smart_status === 'smart') m.set(r.component_id, r)
    return m
  }, [smartRopData])

  const componentById = useMemo(() => {
    const m = new Map<number, WarehouseComponent>()
    components.forEach((c) => m.set(c.id, c))
    return m
  }, [components])

  const supplierById = useMemo(() => {
    const m = new Map<number, Supplier>()
    suppliers.forEach((s) => m.set(s.id, s))
    return m
  }, [suppliers])

  const warehousesSorted = useMemo(() => [...warehouses].sort((a, b) => a.code.localeCompare(b.code)), [warehouses])

  const uniqueCategories = useMemo(() => {
    const set = new Set<string>()
    levels.forEach((r) => { if (r.component_category?.trim()) set.add(r.component_category.trim()) })
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pl'))
  }, [levels])

  // ── filtry wspólne (bez poziomu) → z nich liczniki; poziom filtruje dopiero wiersze tabeli
  const matchesBase = useCallback(
    (r: { component_category: string | null; supplier_id: number | null; component_code: string; component_name: string }) => {
      if (categoryFilter && (r.component_category ?? '').trim().toLowerCase() !== categoryFilter.trim().toLowerCase()) return false
      if (supplierFilter !== '' && r.supplier_id !== supplierFilter) return false
      const q = search.trim().toLowerCase()
      if (!q) return true
      return r.component_code.toLowerCase().includes(q) || r.component_name.toLowerCase().includes(q)
    },
    [categoryFilter, supplierFilter, search],
  )
  const matchesLevel = useCallback(
    (level: StockLevel) => {
      if (hideInactive && level === 'inactive' && levelFilter !== 'inactive') return false
      if (levelFilter === null) return true
      if (levelFilter === 'problems') return isStockProblem(level)
      return level === levelFilter
    },
    [levelFilter, hideInactive],
  )

  const isAllWarehouses = selectedWarehouseId === ''

  // Półki (tryb jednego magazynu; w „Wszystkie” = wszystkie półki do eksportu) — bez poziomu, do liczników
  const shelfRowsBase = useMemo(
    () => levels.filter((r) => (isAllWarehouses || r.warehouse_id === selectedWarehouseId) && matchesBase(r)),
    [levels, isAllWarehouses, selectedWarehouseId, matchesBase],
  )
  // Komponenty (tryb „Wszystkie”) — agregat po wszystkich magazynach
  const aggregatedBase = useMemo(
    () => (isAllWarehouses ? aggregateStockLevels(levels).filter(matchesBase) : []),
    [levels, isAllWarehouses, matchesBase],
  )

  const counts = useMemo(
    () => countStockLevels(isAllWarehouses ? aggregatedBase : shelfRowsBase),
    [isAllWarehouses, aggregatedBase, shelfRowsBase],
  )
  const problemsCount = counts.critical + counts.covered + counts.low

  const sortRows = useCallback(
    <T extends AggregatedStockLevelRow | StockLevelRow>(rows: T[]): T[] =>
      [...rows].sort(
        sortMode === 'alpha'
          ? (a, b) => (a.component_name || a.component_code).localeCompare(b.component_name || b.component_code, 'pl')
          : compareByStockLevel,
      ),
    [sortMode],
  )

  const shelfRows = useMemo(() => sortRows(shelfRowsBase.filter((r) => matchesLevel(r.level))), [shelfRowsBase, matchesLevel, sortRows])
  const aggregatedRows = useMemo(
    () => sortRows(aggregatedBase.filter((r) => matchesLevel(r.level))),
    [aggregatedBase, matchesLevel, sortRows],
  )

  // zaznaczenie żyje tylko wśród widocznych półek
  useEffect(() => {
    if (selected.size === 0) return
    const visible = new Set(shelfRows.map((r) => r.stock_id))
    if ([...selected].every((id) => visible.has(id))) return
    setSelected((prev) => new Set([...prev].filter((id) => visible.has(id))))
  }, [shelfRows, selected])
  useEffect(() => { setSelected(new Set()); setEditing(null); setExpandedComponent(null) }, [selectedWarehouseId])
  useEffect(() => { if (editing) editInputRef.current?.focus() }, [editing])

  const setLevelFilter = (f: LevelFilter) => setPrefs((p) => ({ ...p, levelFilter: p.levelFilter === f ? null : f }))
  const setSortMode = (m: SortMode) => { setPrefs((p) => ({ ...p, sortMode: m })); setSort(null) }

  // ── minimum półki
  const saveMinimums = useCallback(
    async (items: StockMinimumInput[]) => {
      if (!onSetMinimums || items.length === 0) return false
      setSaving(true)
      try { return await onSetMinimums(items) } finally { setSaving(false) }
    },
    [onSetMinimums],
  )

  const commitInlineEdit = useCallback(
    async (row: StockLevelRow) => {
      if (!editing || editing.stockId !== row.stock_id) return
      const parsed = parseMinInput(editing.value)
      if (parsed === 'invalid') { pushToast?.('Minimum musi być liczbą ≥ 0 (puste = nie pilnujemy)', 'error'); return }
      setEditing(null)
      if (parsed === row.min_quantity) return
      await saveMinimums([{ warehouse_id: row.warehouse_id, component_id: row.component_id, min_quantity: parsed }])
    },
    [editing, pushToast, saveMinimums],
  )

  const applyBulk = useCallback(
    async (value: number | null) => {
      const ids = [...selected]
      if (ids.length === 0) return
      const byId = new Map(shelfRows.map((r) => [r.stock_id, r]))
      const items: StockMinimumInput[] = ids
        .map((id) => byId.get(id))
        .filter((r): r is StockLevelRow => Boolean(r))
        .map((r) => ({ warehouse_id: r.warehouse_id, component_id: r.component_id, min_quantity: value }))
      const ok = await saveMinimums(items)
      if (ok) { setSelected(new Set()); setBulkValue('') }
    },
    [selected, shelfRows, saveMinimums],
  )

  const openExpanded = useCallback((agg: AggregatedStockLevelRow) => {
    setExpandedComponent((prev) => (prev === agg.component_id ? null : agg.component_id))
    const vals: Record<number, string> = {}
    for (const s of agg.shelves) vals[s.warehouse_id] = s.min_quantity == null ? '' : fmtQty(s.min_quantity)
    setExpandedValues(vals)
  }, [])

  const saveExpanded = useCallback(
    async (agg: AggregatedStockLevelRow) => {
      const items: StockMinimumInput[] = []
      for (const s of agg.shelves) {
        const parsed = parseMinInput(expandedValues[s.warehouse_id] ?? '')
        if (parsed === 'invalid') { pushToast?.(`${s.warehouse_code}: minimum musi być liczbą ≥ 0`, 'error'); return }
        if (parsed !== s.min_quantity) items.push({ warehouse_id: s.warehouse_id, component_id: s.component_id, min_quantity: parsed })
      }
      if (items.length === 0) { setExpandedComponent(null); return }
      const ok = await saveMinimums(items)
      if (ok) setExpandedComponent(null)
    },
    [expandedValues, pushToast, saveMinimums],
  )

  // ── eksport / lista zakupów — braki w bieżącym filtrze (półki), najpierw braki
  const shortageRows = useMemo(
    () => [...shelfRowsBase.filter((r) => isStockProblem(r.level))].sort(compareByStockLevel),
    [shelfRowsBase],
  )

  const exportShortages = useCallback(() => {
    if (shortageRows.length === 0) { pushToast?.('Brak braków w bieżącym filtrze', 'info'); return }
    const csv = buildStockShortageCsv(shortageRows)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `braki_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }, [shortageRows, pushToast])

  const addShortagesToShoppingList = useCallback(async () => {
    if (!onAddToShoppingList) return
    // „do zamówienia” sumowane po komponencie (różne magazyny = jedno zamówienie u dostawcy)
    const byComponent = new Map<number, number>()
    for (const r of shortageRows) if (r.shortage > 0) byComponent.set(r.component_id, (byComponent.get(r.component_id) ?? 0) + r.shortage)
    if (byComponent.size === 0) { pushToast?.('Nic do zamówienia w bieżącym filtrze', 'info'); return }
    const ok = await appConfirm(
      `Dodać ${byComponent.size} ${byComponent.size === 1 ? 'komponent' : 'komponentów'} z brakami do listy zakupowej? Ilość = „do zamówienia” (komponenty już na liście zostaną pominięte).`,
      { title: 'Lista zakupowa', confirmLabel: 'Dodaj' },
    )
    if (!ok) return
    const aggAll = aggregateStockLevels(levels)
    for (const [componentId, qty] of byComponent) {
      const c = componentById.get(componentId)
      const agg = aggAll.find((a) => a.component_id === componentId)
      if (!agg) continue
      const supplierId = c?.supplier_id ?? agg.supplier_id ?? null
      onAddToShoppingList({
        component_id: componentId,
        component_name: agg.component_name,
        component_code: agg.component_code,
        supplier_id: supplierId,
        supplier_name: supplierId != null ? (supplierById.get(supplierId)?.name ?? null) : null,
        quantity: Math.max(1, Math.ceil(qty)),
        units_per_pallet: c?.units_per_pallet ?? null,
        pallets_per_full_tir: c?.pallets_per_full_tir ?? null,
        current_stock: agg.total,
        min_stock_level: c?.min_stock_level ?? null,
        target_stock_level: c?.target_stock_level ?? null,
      })
    }
  }, [onAddToShoppingList, shortageRows, pushToast, componentById, levels, supplierById])

  // ── komórki
  const renderMinSourceBadge = useCallback(
    (row: { min_source: StockLevelRow['min_source']; component_id: number }) => {
      if (row.min_source === 'smart') {
        const s = smartById.get(row.component_id)
        return (
          <span
            className="smart-badge smart-badge--smart"
            title={s ? `Smart ROP: ${s.weeks_of_history ?? 0} tyg historii, avg ${s.daily_avg?.toFixed(1) ?? '0'} szt/dzień · ręczne min: ${s.manual_min_stock ?? '—'}` : 'Smart ROP'}
          >
            🤖
          </span>
        )
      }
      if (row.min_source === 'component') return <span className="stock-min-src" title="Minimum z karty komponentu (Komponenty)">komp.</span>
      return null
    },
    [smartById],
  )

  const renderMinCellShelf = useCallback(
    (r: StockLevelRow) => {
      if (editing && editing.stockId === r.stock_id) {
        return (
          <input
            ref={editInputRef}
            className="stock-min-input"
            value={editing.value}
            placeholder={r.min_effective != null && r.min_source !== 'shelf' ? fmtQty(r.min_effective) : '—'}
            disabled={saving}
            onChange={(e) => setEditing({ stockId: r.stock_id, value: e.target.value })}
            onBlur={() => void commitInlineEdit(r)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void commitInlineEdit(r) }
              if (e.key === 'Escape') { e.preventDefault(); setEditing(null) }
            }}
          />
        )
      }
      const title = canEdit
        ? `${minSourceLabel(r.min_source)} — kliknij, aby ustawić minimum tej półki`
        : minSourceLabel(r.min_source)
      return (
        <span
          className={`stock-min-cell${canEdit ? ' stock-min-cell--editable' : ''}`}
          title={title}
          onClick={canEdit ? () => setEditing({ stockId: r.stock_id, value: r.min_quantity == null ? '' : fmtQty(r.min_quantity) }) : undefined}
        >
          {r.min_effective != null ? fmtQty(r.min_effective) : '—'}
          {renderMinSourceBadge(r)}
        </span>
      )
    },
    [editing, saving, canEdit, commitInlineEdit, renderMinSourceBadge],
  )

  const maxMinOf = (r: AggregatedStockLevelRow) => Math.max(-1, ...Object.values(r.minEffectiveByWarehouse).map((v) => v ?? -1))

  const renderMinCellAggregated = useCallback(
    (r: AggregatedStockLevelRow) => {
      const parts = warehousesSorted
        .filter((w) => w.id in r.minEffectiveByWarehouse)
        .map((w) => `${w.code}: ${r.minEffectiveByWarehouse[w.id] != null ? fmtQty(r.minEffectiveByWarehouse[w.id] as number) : '—'}`)
      const maxMin = maxMinOf(r)
      const worstShelf = [...r.shelves].sort(compareByStockLevel)[0]
      return (
        <span
          className={`stock-min-cell${canEdit ? ' stock-min-cell--editable' : ''}`}
          title={`${parts.join(' · ') || 'brak półek'}${canEdit ? '\nKliknij, aby ustawić minimum per magazyn' : ''}`}
          onClick={canEdit ? () => openExpanded(r) : undefined}
        >
          {maxMin >= 0 ? fmtQty(maxMin) : '—'}
          {worstShelf ? renderMinSourceBadge(worstShelf) : null}
        </span>
      )
    },
    [warehousesSorted, canEdit, openExpanded, renderMinSourceBadge],
  )

  const renderActions = useCallback(
    (componentId: number, warehouseId: number | null) => (
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => { const c = componentById.get(componentId); if (c) onShowHistory(c) }}
        >
          Historia
        </button>
        {isManager && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            title="Zgłoś zniszczenie (drugi gatunek) — zdejmie z magazynu"
            onClick={() => setDamageTarget({ componentId, warehouseId })}
          >
            ZN
          </button>
        )}
      </div>
    ),
    [componentById, onShowHistory, isManager],
  )

  const allVisibleSelected = shelfRows.length > 0 && shelfRows.every((r) => selected.has(r.stock_id))
  const toggleAll = useCallback(
    () => setSelected(allVisibleSelected ? new Set() : new Set(shelfRows.map((r) => r.stock_id))),
    [allVisibleSelected, shelfRows],
  )

  const shelfColumns = useMemo((): DataTableColumn<StockLevelRow>[] => {
    const selCol: DataTableColumn<StockLevelRow>[] = canEdit
      ? [{
          key: 'sel',
          label: <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} title="Zaznacz widoczne" />,
          stopRowClick: true,
          render: (r) => (
            <input
              type="checkbox"
              checked={selected.has(r.stock_id)}
              onChange={(e) => setSelected((prev) => { const n = new Set(prev); if (e.target.checked) n.add(r.stock_id); else n.delete(r.stock_id); return n })}
            />
          ),
        }]
      : []
    return [
      ...selCol,
      { key: 'code', label: 'KOD', stackUnder: 'name', sortValue: (r) => r.component_code, render: (r) => orDash(r.component_code) },
      { key: 'name', label: 'NAZWA', sortValue: (r) => r.component_name, render: (r) => orDash(r.component_name) },
      { key: 'category', label: 'KATEGORIA', stackUnder: 'name', sortValue: (r) => r.component_category, render: (r) => orDash(r.component_category) },
      { key: 'unit', label: 'JEDN.', stackUnder: 'qty', sortValue: (r) => r.component_unit, render: (r) => orDash(r.component_unit) },
      { key: 'qty', label: 'FIZYCZNE', sortValue: (r) => r.quantity, render: (r) => fmtQty(r.quantity) },
      { key: 'reserved', label: 'ZAREZERW.', stackUnder: 'qty', sortValue: (r) => r.reserved_quantity, render: (r) => (r.reserved_quantity ? fmtQty(r.reserved_quantity) : '—') },
      { key: 'available', label: 'DOSTĘPNE', sortValue: (r) => r.available_quantity, render: (r) => renderAvailableCell(r.available_quantity) },
      { key: 'incoming', label: 'W DRODZE', sortValue: (r) => r.incoming_qty, render: (r) => renderIncomingCell(r.incoming_qty, r.earliest_eta, r.open_pos) },
      { key: 'projected', label: 'PROGNOZA', stackUnder: 'incoming', sortValue: (r) => r.available_quantity + r.incoming_qty, render: (r) => fmtQty(r.available_quantity + r.incoming_qty) },
      { key: 'min', label: 'MINIMUM', stopRowClick: true, sortValue: (r) => r.min_effective, render: renderMinCellShelf },
      { key: 'shortage', label: 'DO ZAMÓWIENIA', sortValue: (r) => r.shortage, render: (r) => renderShortageCell(r.shortage) },
      { key: 'level', label: 'STATUS', sortValue: (r) => -compareByStockLevel(r, LEVEL_SORT_REF), render: (r) => renderLevelCell(r.level, r.earliest_eta) },
      { key: 'actions', label: 'AKCJE', stopRowClick: true, render: (r) => renderActions(r.component_id, r.warehouse_id) },
    ]
  }, [canEdit, allVisibleSelected, toggleAll, selected, renderMinCellShelf, renderActions])

  const aggregatedColumns = useMemo((): DataTableColumn<AggregatedStockLevelRow>[] => [
    { key: 'code', label: 'KOD', stackUnder: 'name', sortValue: (r) => r.component_code, render: (r) => orDash(r.component_code) },
    { key: 'name', label: 'NAZWA', sortValue: (r) => r.component_name, render: (r) => orDash(r.component_name) },
    { key: 'category', label: 'KATEGORIA', stackUnder: 'name', sortValue: (r) => r.component_category, render: (r) => orDash(r.component_category) },
    { key: 'unit', label: 'JEDN.', stackUnder: 'total', sortValue: (r) => r.component_unit, render: (r) => orDash(r.component_unit) },
    ...warehousesSorted.map(
      (w): DataTableColumn<AggregatedStockLevelRow> => ({
        key: `wh_${w.id}`,
        label: w.code,
        sortValue: (r) => r.quantities[w.id] ?? 0,
        tdClassName: (r) => {
          const shelf = r.shelves.find((s) => s.warehouse_id === w.id)
          return shelf && isStockProblem(shelf.level) ? `stock-cell--${shelf.level}` : undefined
        },
        tdTitle: (r) => {
          const shelf = r.shelves.find((s) => s.warehouse_id === w.id)
          return shelf
            ? `${w.code}: ${stockLevelLabel(shelf.level)} · dostępne ${fmtQty(shelf.available_quantity)}${shelf.shortage > 0 ? ` · do zamówienia ${fmtQty(shelf.shortage)}` : ''}`
            : undefined
        },
        render: (r) => (w.id in r.quantities ? fmtQty(r.quantities[w.id]) : '—'),
      }),
    ),
    { key: 'total', label: 'FIZYCZNE', sortValue: (r) => r.total, render: (r) => fmtQty(r.total) },
    { key: 'reserved', label: 'ZAREZERW.', stackUnder: 'total', sortValue: (r) => r.reserved, render: (r) => (r.reserved ? fmtQty(r.reserved) : '—') },
    { key: 'available', label: 'DOSTĘPNE', sortValue: (r) => r.available, render: (r) => renderAvailableCell(r.available) },
    {
      key: 'incoming',
      label: 'W DRODZE',
      sortValue: (r) => r.incoming,
      render: (r) =>
        renderIncomingCell(
          r.incoming,
          r.shelves.map((s) => s.earliest_eta).filter((d): d is string => Boolean(d)).sort()[0] ?? null,
          r.shelves.reduce((n, s) => n + s.open_pos, 0),
        ),
    },
    { key: 'projected', label: 'PROGNOZA', stackUnder: 'incoming', sortValue: (r) => r.available + r.incoming, render: (r) => fmtQty(r.available + r.incoming) },
    { key: 'min', label: 'MINIMUM', stopRowClick: true, sortValue: (r) => maxMinOf(r), render: renderMinCellAggregated },
    { key: 'shortage', label: 'DO ZAMÓWIENIA', sortValue: (r) => r.shortage, render: (r) => renderShortageCell(r.shortage) },
    { key: 'level', label: 'STATUS', sortValue: (r) => -compareByStockLevel(r, LEVEL_SORT_REF), render: (r) => renderLevelCell(r.level, r.shelves.find((s) => s.level === 'covered')?.earliest_eta) },
    { key: 'actions', label: 'AKCJE', stopRowClick: true, render: (r) => renderActions(r.component_id, null) },
  ], [warehousesSorted, renderMinCellAggregated, renderActions])

  const renderExpandedEditor = useCallback(
    (r: AggregatedStockLevelRow) => {
      if (expandedComponent !== r.component_id) return null
      return (
        <tr className="stock-row--editor">
          <td colSpan={aggregatedColumns.length}>
            <div className="stock-min-editor">
              <strong>Minimum półki — {r.component_name}</strong>
              {r.shelves.length === 0 ? <span>Brak półek tego komponentu.</span> : null}
              {[...r.shelves].sort((a, b) => a.warehouse_code.localeCompare(b.warehouse_code)).map((s) => (
                <label key={s.stock_id}>
                  <span>
                    {s.warehouse_code}{' '}
                    <span className="stock-min-src">
                      ({minSourceLabel(s.min_source)}{s.min_source !== 'shelf' && s.min_effective != null ? ` ${fmtQty(s.min_effective)}` : ''})
                    </span>
                  </span>
                  <input
                    className="stock-min-input"
                    value={expandedValues[s.warehouse_id] ?? ''}
                    placeholder="—"
                    disabled={saving}
                    onChange={(e) => setExpandedValues((prev) => ({ ...prev, [s.warehouse_id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void saveExpanded(r) }
                      if (e.key === 'Escape') { e.preventDefault(); setExpandedComponent(null) }
                    }}
                  />
                </label>
              ))}
              <button type="button" className="btn btn-sm btn-primary" disabled={saving} onClick={() => void saveExpanded(r)}>Zapisz</button>
              <button type="button" className="btn btn-sm btn-secondary" disabled={saving} onClick={() => setExpandedComponent(null)}>Anuluj</button>
              <span className="stock-min-src">Puste = nie pilnujemy minimum tej półki.</span>
            </div>
          </td>
        </tr>
      )
    },
    [expandedComponent, aggregatedColumns.length, expandedValues, saving, saveExpanded],
  )

  const levelChip = (key: Exclude<LevelFilter, null>, label: string, count: number, cls?: string) => (
    <button
      type="button"
      className={`stock-level-chip${cls ? ` stock-level-chip--${cls}` : ''}${levelFilter === key ? ' stock-level-chip--active' : ''}`}
      aria-pressed={levelFilter === key}
      title={key === 'problems' ? 'Krytyczne + pokryte dostawą + niskie' : stockLevelHint(key)}
      onClick={() => setLevelFilter(key)}
    >
      {label} <span className="stock-level-chip__count">{count}</span>
    </button>
  )

  const onBulkSave = () => {
    const parsed = parseMinInput(bulkValue)
    if (parsed === 'invalid' || parsed === null) { pushToast?.('Podaj liczbę ≥ 0', 'error'); return }
    void applyBulk(parsed)
  }

  return (
    <>
      <div className="subtab-bar stock-view-warehouse-pills" role="tablist" aria-label="Magazyn — filtr" style={{ marginBottom: 10 }}>
        <button
          type="button"
          role="tab"
          aria-selected={isAllWarehouses}
          className={`btn btn-sm ${isAllWarehouses ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setSelectedWarehouseId('')}
        >
          Wszystkie
        </button>
        {warehouses.map((w) => (
          <button
            key={w.id}
            type="button"
            role="tab"
            aria-selected={selectedWarehouseId === w.id}
            className={`btn btn-sm ${selectedWarehouseId === w.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSelectedWarehouseId(w.id)}
          >
            {w.code}
          </button>
        ))}
      </div>

      <div className="orders-filters" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <label className="day-filter" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span>Kategoria</span>
          <select className="day-filter" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">Wszystkie</option>
            {uniqueCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
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
        <input
          type="text"
          className="search-input"
          placeholder="Szukaj po kodzie lub nazwie komponentu…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 220, flex: '1 1 200px' }}
        />
        <label className="day-filter" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={hideInactive} onChange={(e) => setPrefs((p) => ({ ...p, hideInactive: e.target.checked }))} />
          <span>Ukryj nieaktywne</span>
        </label>
        <button type="button" className="btn btn-secondary" onClick={exportShortages} title="CSV z brakami w bieżącym filtrze (półki, najpierw braki)">
          Eksportuj braki (CSV)
        </button>
        {onAddToShoppingList ? (
          <button type="button" className="btn btn-secondary" onClick={() => void addShortagesToShoppingList()} title="Komponenty z „do zamówienia” > 0 w bieżącym filtrze">
            Braki → lista zakupowa
          </button>
        ) : null}
        <StockAtDateExport warehouses={warehouses} warehouseId={selectedWarehouseId} pushToast={pushToast} />
        {(canAddPz ?? isManager) && onAddPz ? (
          <button type="button" className="btn btn-success" onClick={() => onAddPz(isAllWarehouses ? undefined : selectedWarehouseId)}>
            + Przyjmij dostawę
          </button>
        ) : null}
      </div>

      <div className="stock-level-bar" role="group" aria-label="Poziomy braków">
        {levelChip('problems', 'Problemy', problemsCount)}
        {levelChip('critical', 'Krytyczne', counts.critical, 'critical')}
        {levelChip('covered', 'Pokryte dostawą', counts.covered, 'covered')}
        {levelChip('low', 'Niskie', counts.low, 'low')}
        <span className="stock-level-bar__sep" aria-hidden />
        {levelChip('ok', 'OK', counts.ok)}
        {levelChip('inactive', 'Nieaktywne', counts.inactive)}
        <span className="stock-level-bar__sep" aria-hidden />
        <span className="stock-min-src">Sortuj:</span>
        <button type="button" className={`btn btn-sm ${sortMode === 'worst' && !sort ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSortMode('worst')}>Najpierw braki</button>
        <button type="button" className={`btn btn-sm ${sortMode === 'alpha' && !sort ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSortMode('alpha')}>Alfabetycznie</button>
      </div>

      {canEdit && !isAllWarehouses && selected.size > 0 ? (
        <div className="stock-bulk-bar">
          <strong>Zaznaczono: {selected.size}</strong>
          <span>Ustaw minimum:</span>
          <input
            className="stock-min-input"
            value={bulkValue}
            placeholder="np. 10"
            disabled={saving}
            onChange={(e) => setBulkValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onBulkSave() } }}
          />
          <button type="button" className="btn btn-sm btn-primary" disabled={saving} onClick={onBulkSave}>Zapisz</button>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={saving}
            onClick={async () => {
              const ok = await appConfirm(`Wyczyścić minimum dla ${selected.size} półek? Przestaną być pilnowane.`, { title: 'Minimum półki', confirmLabel: 'Wyczyść', tone: 'danger' })
              if (ok) void applyBulk(null)
            }}
          >
            Wyczyść minimum
          </button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={saving} onClick={() => setSelected(new Set())}>Odznacz</button>
        </div>
      ) : null}

      {loading && levels.length === 0 ? (
        <Spinner center label="Ładowanie stanów…" />
      ) : isAllWarehouses ? (
        <DataTable
          rows={aggregatedRows}
          rowKey={(r) => r.component_id}
          columns={aggregatedColumns}
          rowClassName={(r) => `stock-row--${r.level}`}
          renderAfterRow={renderExpandedEditor}
          sort={sort}
          onSortChange={setSort}
          emptyText="Brak wierszy spełniających kryteria."
        />
      ) : (
        <DataTable
          rows={shelfRows}
          rowKey={(r) => r.stock_id}
          columns={shelfColumns}
          rowClassName={(r) => `stock-row--${r.level}`}
          sort={sort}
          onSortChange={setSort}
          emptyText="Brak wierszy spełniających kryteria."
        />
      )}

      {pushToast && (
        <DamageReportModal
          open={damageTarget !== null}
          onClose={() => setDamageTarget(null)}
          pushToast={pushToast}
          onReported={onStockChanged}
          defaultComponentId={damageTarget?.componentId ?? null}
          defaultWarehouseId={damageTarget?.warehouseId ?? null}
        />
      )}
    </>
  )
}

export default StockView
