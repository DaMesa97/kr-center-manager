import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { buildRecipeAutoName, isInternalWarehouseCode } from '../utils'
import {
  INITIAL_MM_FORM, INITIAL_PZ_FORM, INITIAL_RECIPE_FORM
} from '../constants'
import type {
  CompanySettings, DeleteConfirmState, MmFormState, MmGroupRow, MmItem,
  MonthlyConsumptionPivot, MonthlyConsumptionRow, Order, OrderNeedingReview,
  PurchaseOrder, PurchaseOrderItem, PzFormState, PzGroupRow, PzItem,
  RecipeFormState, ShoppingListItem, SmartRopRow, Supplier,
  ToastVariant, Warehouse, WarehouseComponent, WarehouseComponentCreateInput,
  WarehouseComponentUpdateInput, WarehouseMovementRow, WarehouseRecipe,
  WarehouseRecipeComponent, WarehouseStockRow, WarehouseSubTab
} from '../types'
import React from 'react'

type UseWarehouseParams = {
  pushToast: (message: string, variant: ToastVariant) => void
  touchSession: () => void
  activeTab: string
  isWarehouseTab: boolean
  activeWarehouseSubTab: WarehouseSubTab
  setActiveWarehouseSubTab: React.Dispatch<React.SetStateAction<WarehouseSubTab>>
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>
  fetchOrders: () => Promise<void>
  setDeleteConfirm: (state: DeleteConfirmState | null) => void
  setAlertsBadgeCount: (n: number) => void
}

export function useWarehouse({
  pushToast,
  touchSession,
  setAlertsBadgeCount,
  activeTab,
  isWarehouseTab,
  activeWarehouseSubTab,
  setActiveWarehouseSubTab,
  setOrders,
  fetchOrders,
  setDeleteConfirm,
}: UseWarehouseParams) {
  const [warehouseComponents, setWarehouseComponents] = useState<WarehouseComponent[]>([])
  const [warehouseComponentsLoading, setWarehouseComponentsLoading] = useState(false)
  const [warehouseRecipes, setWarehouseRecipes] = useState<WarehouseRecipe[]>([])
  const [warehouseRecipesLoading, setWarehouseRecipesLoading] = useState(false)
  const [showDeletedRecipes, setShowDeletedRecipes] = useState(false)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [warehouseStock, setWarehouseStock] = useState<WarehouseStockRow[]>([])
  const [warehouseStockLoading, setWarehouseStockLoading] = useState(false)
  const [warehouseMovements, setWarehouseMovements] = useState<WarehouseMovementRow[]>([])
  const [warehouseMovementsLoading, setWarehouseMovementsLoading] = useState(false)
  const [pzGroups, setPzGroups] = useState<PzGroupRow[]>([])
  const [pzGroupsLoading, setPzGroupsLoading] = useState(false)
  const [pzFormOpen, setPzFormOpen] = useState(false)
  const [pzFormData, setPzFormData] = useState<PzFormState>(INITIAL_PZ_FORM)
  const [pzSaving, setPzSaving] = useState(false)
  const [mmGroups, setMmGroups] = useState<MmGroupRow[]>([])
  const [mmGroupsLoading, setMmGroupsLoading] = useState(false)
  const [monthlyConsumption, setMonthlyConsumption] = useState<MonthlyConsumptionPivot[]>([])
  const [monthlyConsumptionMonths, setMonthlyConsumptionMonths] = useState<string[]>([])
  const [monthlyConsumptionLoading, setMonthlyConsumptionLoading] = useState(false)
  const [monthlyConsumptionRange, setMonthlyConsumptionRange] = useState(12)
  const [mmFormOpen, setMmFormOpen] = useState(false)
  const [mmFormData, setMmFormData] = useState<MmFormState>(INITIAL_MM_FORM)
  const [mmSaving, setMmSaving] = useState(false)
  const [doorComponentModal, setDoorComponentModal] = useState<{
    open: boolean
    mode: 'add' | 'edit'
    component: WarehouseComponent | null
  }>({ open: false, mode: 'add', component: null })
  const [componentHistoryModal, setComponentHistoryModal] = useState<{
    open: boolean
    component: WarehouseComponent | null
  }>({ open: false, component: null })
  const [docDetailsModal, setDocDetailsModal] = useState<{
    open: boolean
    referenceDoc: string | null
    movementType: 'PZ' | 'MM' | null
  }>({ open: false, referenceDoc: null, movementType: null })
  const [recipeEditorOpen, setRecipeEditorOpen] = useState(false)
  const [recipeEditorMode, setRecipeEditorMode] = useState<'create' | 'edit'>('create')
  const [recipeFormData, setRecipeFormData] = useState<RecipeFormState>(INITIAL_RECIPE_FORM)
  const [recipeSaving, setRecipeSaving] = useState(false)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [suppliersLoading, setSuppliersLoading] = useState(false)
  const [supplierModal, setSupplierModal] = useState<{
    open: boolean
    mode: 'add' | 'edit'
    supplier: Supplier | null
  }>({ open: false, mode: 'add', supplier: null })
  const [shoppingList, setShoppingList] = useState<ShoppingListItem[]>([])
  const [shoppingListModalOpen, setShoppingListModalOpen] = useState(false)
  const [smartRopData, setSmartRopData] = useState<SmartRopRow[]>([])
  const [smartRopLoading, setSmartRopLoading] = useState(false)
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])
  const [purchaseOrderItems, setPurchaseOrderItems] = useState<PurchaseOrderItem[]>([])
  const [purchaseOrdersLoading, setPurchaseOrdersLoading] = useState(false)
  const [poDetailsModal, setPoDetailsModal] = useState<{ open: boolean; po: PurchaseOrder | null }>({
    open: false,
    po: null,
  })
  const [poReceiveModal, setPoReceiveModal] = useState<{ open: boolean; po: PurchaseOrder | null }>({
    open: false,
    po: null,
  })
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null)
  const [companySettingsLoading, setCompanySettingsLoading] = useState(false)
  const [warehouseEditRequestComponent, setWarehouseEditRequestComponent] = useState<WarehouseComponent | null>(null)
  const [ordersNeedingReview, setOrdersNeedingReview] = useState<OrderNeedingReview[]>([])
  const [reviewLoading, setReviewLoading] = useState(false)

  // ---------------------------------------------------------------------------
  // Fetch functions
  // ---------------------------------------------------------------------------

  const fetchWarehouseComponents = useCallback(async () => {
    touchSession()
    setWarehouseComponentsLoading(true)
    // Paginacja — PostgREST tnie po 1000 wierszy (kartoteka rośnie)
    const all: WarehouseComponent[] = []
    let from = 0
    const PAGE = 1000
    let fetchError: { message: string } | null = null
    while (true) {
      const { data, error } = await supabase
        .from('warehouse_components')
        .select('*')
        .eq('is_active', true)
        .order('code')
        .order('id')
        .range(from, from + PAGE - 1)
      if (error) { fetchError = error; break }
      if (!data || data.length === 0) break
      all.push(...(data as WarehouseComponent[]))
      if (data.length < PAGE) break
      from += PAGE
    }
    setWarehouseComponentsLoading(false)
    if (fetchError) {
      pushToast(`Błąd: ${fetchError.message}`, 'error')
      return
    }
    setWarehouseComponents(all)
  }, [pushToast, touchSession])

  const fetchWarehouseRecipes = useCallback(async () => {
    touchSession()
    setWarehouseRecipesLoading(true)
    let query = supabase
      .from('warehouse_recipes')
      .select(
        `
        *,
        components_count:warehouse_recipe_components(count)
      `,
      )
      .order('category')
      .order('part')
      .order('name', { nullsFirst: false })

    if (!showDeletedRecipes) {
      query = query.eq('is_active', true)
    }

    const { data, error } = await query
    setWarehouseRecipesLoading(false)
    if (error) {
      pushToast(`Błąd: ${error.message}`, 'error')
      return
    }
    const mapped = (data ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      components_count: (r.components_count as { count: number }[] | undefined)?.[0]?.count ?? 0,
    })) as WarehouseRecipe[]
    setWarehouseRecipes(mapped)
  }, [pushToast, showDeletedRecipes, touchSession])

  const fetchWarehouses = useCallback(async () => {
    touchSession()
    const { data, error } = await supabase.from('warehouses').select('*').eq('is_active', true).order('code')
    if (error) {
      pushToast(`Błąd: ${error.message}`, 'error')
      return
    }
    setWarehouses((data ?? []) as Warehouse[])
  }, [pushToast, touchSession])

  const fetchWarehouseStock = useCallback(async () => {
    touchSession()
    setWarehouseStockLoading(true)
    // Paginacja — stany = komponenty × magazyny, sufit 1000 pęka szybko
    const rows: Record<string, unknown>[] = []
    let from = 0
    const PAGE = 1000
    let fetchError: { message: string } | null = null
    while (true) {
      const { data, error } = await supabase
        .from('warehouse_stock')
        .select(
          `
          *,
          warehouses(code),
          warehouse_components(code, name, unit, min_stock_level, category)
        `,
        )
        .order('warehouse_id')
        .order('id')
        .range(from, from + PAGE - 1)
      if (error) { fetchError = error; break }
      if (!data || data.length === 0) break
      rows.push(...(data as Record<string, unknown>[]))
      if (data.length < PAGE) break
      from += PAGE
    }
    setWarehouseStockLoading(false)
    if (fetchError) {
      pushToast(`Błąd: ${fetchError.message}`, 'error')
      return
    }
    const mapped = rows.map((r: Record<string, unknown>) => {
      const wh = r.warehouses as { code?: string } | { code?: string }[] | null | undefined
      const wc = r.warehouse_components as
        | {
            code?: string
            name?: string
            unit?: string
            min_stock_level?: number | null
            category?: string | null
          }
        | Array<{
            code?: string
            name?: string
            unit?: string
            min_stock_level?: number | null
            category?: string | null
          }>
        | null
        | undefined
      const whObj = Array.isArray(wh) ? wh[0] : wh
      const wcObj = Array.isArray(wc) ? wc[0] : wc
      return {
        id: r.id as number,
        warehouse_id: r.warehouse_id as number,
        component_id: r.component_id as number,
        quantity: Number(r.quantity),
        updated_at: String(r.updated_at ?? ''),
        warehouse_code: whObj?.code,
        component_code: wcObj?.code,
        component_name: wcObj?.name,
        component_unit: wcObj?.unit,
        component_category: wcObj?.category ?? null,
        component_min_stock_level: wcObj?.min_stock_level ?? null,
      } as WarehouseStockRow
    })
    mapped.sort((a, b) => {
      const wa = (a.warehouse_code ?? '').localeCompare(b.warehouse_code ?? '')
      if (wa !== 0) return wa
      return (a.component_code ?? '').localeCompare(b.component_code ?? '')
    })
    setWarehouseStock(mapped)
  }, [pushToast, touchSession])

  const fetchWarehouseMovements = useCallback(async () => {
    touchSession()
    setWarehouseMovementsLoading(true)
    const { data, error } = await supabase
      .from('warehouse_movements')
      .select(
        `
      *,
      warehouse_from:warehouses!warehouse_from_id(code),
      warehouse_to:warehouses!warehouse_to_id(code),
      warehouse_components(code, name, unit),
      orders(order_number)
    `,
      )
      .order('created_at', { ascending: false })
      .limit(500)
    setWarehouseMovementsLoading(false)
    if (error) {
      pushToast(`Błąd: ${error.message}`, 'error')
      return
    }
    const pick = <T,>(x: T | T[] | null | undefined): T | undefined => {
      if (x == null) return undefined
      return Array.isArray(x) ? x[0] : x
    }
    const mapped = (data ?? []).map((r: Record<string, unknown>) => {
      const wf = pick(r.warehouse_from as { code?: string } | { code?: string }[] | null)
      const wt = pick(r.warehouse_to as { code?: string } | { code?: string }[] | null)
      const wc = pick(
        r.warehouse_components as
          | { code?: string; name?: string; unit?: string }
          | { code?: string; name?: string; unit?: string }[]
          | null,
      )
      const ord = pick(r.orders as { order_number?: string } | { order_number?: string }[] | null)
      return {
        id: r.id as number,
        movement_type: r.movement_type,
        warehouse_from_id: r.warehouse_from_id as number | null | undefined,
        warehouse_to_id: r.warehouse_to_id as number | null | undefined,
        component_id: r.component_id as number,
        quantity: Number(r.quantity),
        order_id: r.order_id as number | null | undefined,
        reference_doc: r.reference_doc as string | null | undefined,
        notes: r.notes as string | null | undefined,
        created_by: r.created_by as string | null | undefined,
        created_at: String(r.created_at ?? ''),
        warehouse_from_code: wf?.code ?? null,
        warehouse_to_code: wt?.code ?? null,
        component_code: wc?.code ?? null,
        component_name: wc?.name ?? null,
        component_unit: wc?.unit ?? null,
        order_number: ord?.order_number ?? null,
      } as WarehouseMovementRow
    })
    setWarehouseMovements(mapped)
  }, [pushToast, touchSession])

  const fetchPzGroups = useCallback(async () => {
    touchSession()
    setPzGroupsLoading(true)
    const { data, error } = await supabase
      .from('warehouse_movements')
      .select(
        `
      reference_doc, warehouse_to_id, created_at, created_by, quantity,
      warehouses!warehouse_to_id(code)
    `,
      )
      .eq('movement_type', 'PZ')
      .order('created_at', { ascending: false })
      .limit(1000)
    setPzGroupsLoading(false)
    if (error) {
      pushToast(`Błąd: ${error.message}`, 'error')
      return
    }
    const pick = <T,>(x: T | T[] | null | undefined): T | undefined => {
      if (x == null) return undefined
      return Array.isArray(x) ? x[0] : x
    }
    const map = new Map<string, PzGroupRow>()
    for (const r of data ?? []) {
      const row = r as Record<string, unknown>
      const wh = pick(row.warehouses as { code?: string } | { code?: string }[] | null)
      const ref = (row.reference_doc as string | null) ?? '(bez dokumentu)'
      const existing = map.get(ref)
      if (existing) {
        existing.items_count += 1
        existing.total_quantity += Number(row.quantity)
      } else {
        map.set(ref, {
          reference_doc: ref,
          warehouse_id: row.warehouse_to_id as number,
          warehouse_code: wh?.code ?? '',
          created_at: String(row.created_at ?? ''),
          created_by: (row.created_by as string | null) ?? null,
          items_count: 1,
          total_quantity: Number(row.quantity),
        })
      }
    }
    setPzGroups(Array.from(map.values()))
  }, [pushToast, touchSession])

  const fetchMmGroups = useCallback(async () => {
    touchSession()
    setMmGroupsLoading(true)
    const { data, error } = await supabase
      .from('warehouse_movements')
      .select(
        `
      reference_doc, warehouse_from_id, warehouse_to_id,
      created_at, created_by, quantity,
      warehouse_from:warehouses!warehouse_from_id(code),
      warehouse_to:warehouses!warehouse_to_id(code)
    `,
      )
      .eq('movement_type', 'MM')
      .order('created_at', { ascending: false })
      .limit(1000)
    setMmGroupsLoading(false)
    if (error) {
      pushToast(`Błąd: ${error.message}`, 'error')
      return
    }
    const pick = <T,>(x: T | T[] | null | undefined): T | undefined => {
      if (x == null) return undefined
      return Array.isArray(x) ? x[0] : x
    }
    const map = new Map<string, MmGroupRow>()
    for (const r of data ?? []) {
      const row = r as Record<string, unknown>
      const wf = pick(row.warehouse_from as { code?: string } | { code?: string }[] | null)
      const wt = pick(row.warehouse_to as { code?: string } | { code?: string }[] | null)
      const ref = (row.reference_doc as string | null) ?? '(bez dokumentu)'
      const existing = map.get(ref)
      if (existing) {
        existing.items_count += 1
        existing.total_quantity += Number(row.quantity)
      } else {
        map.set(ref, {
          reference_doc: ref,
          warehouse_from_id: row.warehouse_from_id as number,
          warehouse_from_code: wf?.code ?? '',
          warehouse_to_id: row.warehouse_to_id as number,
          warehouse_to_code: wt?.code ?? '',
          created_at: String(row.created_at ?? ''),
          created_by: (row.created_by as string | null) ?? null,
          items_count: 1,
          total_quantity: Number(row.quantity),
        })
      }
    }
    setMmGroups(Array.from(map.values()))
  }, [pushToast, touchSession])

  const fetchMonthlyConsumption = useCallback(async (months: number) => {
    touchSession()
    setMonthlyConsumptionLoading(true)
    const { data, error } = await supabase.rpc('monthly_consumption_report', {
      p_months: months,
    })
    setMonthlyConsumptionLoading(false)
    if (error) {
      pushToast(`Błąd: ${error.message}`, 'error')
      return
    }

    const rows = (data ?? []) as MonthlyConsumptionRow[]
    const monthSet = new Set<string>()
    for (const row of rows) {
      const m = row.r_month
      if (typeof m === 'string' && m.length >= 7) {
        monthSet.add(m.substring(0, 7))
      }
    }
    const monthsList = Array.from(monthSet).sort()

    const pivot = new Map<number, MonthlyConsumptionPivot>()
    for (const row of rows) {
      const monthKey =
        typeof row.r_month === 'string' && row.r_month.length >= 7
          ? row.r_month.substring(0, 7)
          : ''
      if (!monthKey) continue
      const qty = Number(row.r_net_consumption) || 0
      const existing = pivot.get(row.r_component_id)
      if (existing) {
        existing.byMonth[monthKey] = (existing.byMonth[monthKey] ?? 0) + qty
        existing.total += qty
      } else {
        pivot.set(row.r_component_id, {
          component_id: row.r_component_id,
          component_code: row.r_component_code,
          component_name: row.r_component_name,
          component_unit: row.r_component_unit,
          component_category: row.r_component_category,
          byMonth: { [monthKey]: qty },
          total: qty,
          average: 0,
        })
      }
    }

    const pivotList = Array.from(pivot.values()).map((p) => ({
      ...p,
      average: monthsList.length > 0 ? p.total / monthsList.length : 0,
    }))

    const filtered = pivotList.filter((p) => p.total !== 0)

    setMonthlyConsumption(filtered)
    setMonthlyConsumptionMonths(monthsList)
  }, [pushToast, touchSession])

  const fetchSuppliers = useCallback(async () => {
    touchSession()
    setSuppliersLoading(true)
    const { data, error } = await supabase.from('suppliers').select('*').order('name', { ascending: true })
    setSuppliersLoading(false)
    if (error) {
      pushToast(`Błąd pobierania dostawców: ${error.message}`, 'error')
      return
    }
    setSuppliers((data ?? []) as Supplier[])
  }, [pushToast, touchSession])

  const fetchCompanySettings = useCallback(async () => {
    setCompanySettingsLoading(true)
    const { data, error } = await supabase.from('company_settings').select('*').eq('id', 1).single()
    setCompanySettingsLoading(false)
    if (error) {
      pushToast(`Błąd pobierania danych firmy: ${error.message}`, 'error')
      return
    }
    setCompanySettings(data as CompanySettings)
  }, [pushToast])

  const fetchPurchaseOrders = useCallback(async () => {
    setPurchaseOrdersLoading(true)
    const [poRes, itemsRes] = await Promise.all([
      supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }),
      supabase.from('purchase_order_items').select('*').order('id', { ascending: true }),
    ])
    setPurchaseOrdersLoading(false)
    if (poRes.error) {
      pushToast(`Błąd: ${poRes.error.message}`, 'error')
      return
    }
    if (itemsRes.error) {
      pushToast(`Błąd: ${itemsRes.error.message}`, 'error')
      return
    }
    setPurchaseOrders((poRes.data ?? []) as PurchaseOrder[])
    setPurchaseOrderItems((itemsRes.data ?? []) as PurchaseOrderItem[])
  }, [pushToast])

  const fetchSmartRop = useCallback(async () => {
    setSmartRopLoading(true)
    const { data, error } = await supabase.rpc('get_all_smart_rop')
    setSmartRopLoading(false)
    if (error) {
      pushToast(`Błąd smart ROP: ${error.message}`, 'error')
      return
    }
    setSmartRopData((data ?? []) as SmartRopRow[])
  }, [pushToast])

  const fetchOrdersNeedingReviewInternal = useCallback(async () => {
    setReviewLoading(true)
    const { data, error } = await supabase.rpc('get_orders_needing_review')
    setReviewLoading(false)
    if (error) {
      pushToast(`Błąd: ${error.message}`, 'error')
      return
    }
    const mapped: OrderNeedingReview[] = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: Number(row.id ?? 0),
      order_number: String(row.order_number ?? ''),
      category: String(row.category ?? ''),
      client_order_number: row.client_order_number == null ? null : String(row.client_order_number),
      company: row.company == null ? null : String(row.company),
      model: row.model == null ? null : String(row.model),
      bot_received_at: row.bot_received_at == null ? null : String(row.bot_received_at),
      warnings: Array.isArray(row.warnings) ? row.warnings.map((w) => String(w)) : [],
      api_key_id: row.api_key_id == null ? null : Number(row.api_key_id),
      raw_payload:
        row.raw_payload && typeof row.raw_payload === 'object'
          ? (row.raw_payload as Record<string, unknown>)
          : null,
    }))
    setOrdersNeedingReview(mapped)
  }, [pushToast])

  // ---------------------------------------------------------------------------
  // Component CRUD
  // ---------------------------------------------------------------------------

  const handleCreateWarehouseComponent = useCallback(
    async (data: WarehouseComponentCreateInput, warehouseIds?: number[]) => {
      const { data: created, error } = await supabase
        .from('warehouse_components')
        .insert([data])
        .select('id')
        .single()
      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }
      if (created?.id) {
        // Półki zakładamy tylko w wybranych magazynach; brak wyboru => wszystkie aktywne (zgodność wstecz)
        let targetIds = warehouseIds ?? []
        if (targetIds.length === 0) {
          const { data: warehousesData } = await supabase
            .from('warehouses')
            .select('id')
            .eq('is_active', true)
          targetIds = (warehousesData ?? []).map((w) => w.id as number)
        }

        if (targetIds.length > 0) {
          const stockRows = targetIds.map((id) => ({
            warehouse_id: id,
            component_id: created.id,
            quantity: 0,
          }))
          const { error: stockError } = await supabase.from('warehouse_stock').insert(stockRows)
          if (stockError) {
            pushToast(`Błąd zapisu stanów: ${stockError.message}`, 'error')
          }
        }
      }
      pushToast('Komponent dodany', 'success')
      await fetchWarehouseComponents()
      await fetchWarehouseStock()
    },
    [pushToast, fetchWarehouseComponents, fetchWarehouseStock],
  )

  // Ustaw przynależność komponentu do magazynów (edycja): dodaj brakujące półki,
  // usuń odznaczone — ale tylko jeśli mają stan 0 (nie kasujemy realnych zapasów).
  const handleSetComponentWarehouses = useCallback(
    async (componentId: number, warehouseIds: number[]) => {
      const { data: existing, error: exErr } = await supabase
        .from('warehouse_stock')
        .select('id, warehouse_id, quantity')
        .eq('component_id', componentId)
      if (exErr) {
        pushToast(`Błąd: ${exErr.message}`, 'error')
        return
      }
      const existingRows = (existing ?? []) as Array<{ id: number; warehouse_id: number; quantity: number }>
      const existingIds = new Set(existingRows.map((r) => r.warehouse_id))
      const target = new Set(warehouseIds)

      const toAdd = warehouseIds.filter((id) => !existingIds.has(id))
      const toRemove = existingRows.filter((r) => !target.has(r.warehouse_id))
      const removable = toRemove.filter((r) => Number(r.quantity) === 0)
      const blocked = toRemove.filter((r) => Number(r.quantity) !== 0)

      if (toAdd.length > 0) {
        const rows = toAdd.map((id) => ({ warehouse_id: id, component_id: componentId, quantity: 0 }))
        const { error } = await supabase.from('warehouse_stock').insert(rows)
        if (error) {
          pushToast(`Błąd dodawania półek: ${error.message}`, 'error')
          return
        }
      }
      if (removable.length > 0) {
        const { error } = await supabase
          .from('warehouse_stock')
          .delete()
          .in('id', removable.map((r) => r.id))
        if (error) {
          pushToast(`Błąd usuwania półek: ${error.message}`, 'error')
          return
        }
      }
      if (blocked.length > 0) {
        pushToast(
          `Pominięto ${blocked.length} magazyn(y) z niezerowym stanem — najpierw wyzeruj stan.`,
          'error',
        )
      }
      await fetchWarehouseStock()
    },
    [pushToast, fetchWarehouseStock],
  )

  // Masowe czyszczenie: usuń zerowe półki tam, gdzie komponent nie pasuje do magazynu.
  // Reguła: magazyny wewnętrzne (WEW*) trzymają tylko drzwi wewnętrzne (door_*), pozostałe tylko surowce (raw/null).
  const handleCleanupOrphanStock = useCallback(async () => {
    const { data: whData, error: whErr } = await supabase.from('warehouses').select('id, code')
    if (whErr) {
      pushToast(`Błąd: ${whErr.message}`, 'error')
      return
    }
    const internalIds = new Set(
      (whData ?? []).filter((w) => isInternalWarehouseCode(String(w.code))).map((w) => w.id as number),
    )

    const { data: stockData, error: stErr } = await supabase
      .from('warehouse_stock')
      .select('id, warehouse_id, quantity, warehouse_components(product_category)')
    if (stErr) {
      pushToast(`Błąd: ${stErr.message}`, 'error')
      return
    }
    const toDelete: number[] = []
    for (const r of (stockData ?? []) as Array<Record<string, unknown>>) {
      if (Number(r.quantity) !== 0) continue
      const wc = r.warehouse_components as { product_category?: string | null } | { product_category?: string | null }[] | null
      const wcObj = Array.isArray(wc) ? wc[0] : wc
      const cat = wcObj?.product_category ?? 'raw'
      const isDoor = cat !== 'raw'
      const isInternalWh = internalIds.has(r.warehouse_id as number)
      // niedopasowanie: drzwi poza WEWNETRZNE lub surowiec w WEWNETRZNE
      if ((isDoor && !isInternalWh) || (!isDoor && isInternalWh)) {
        toDelete.push(r.id as number)
      }
    }

    if (toDelete.length === 0) {
      pushToast('Brak błędnych półek do usunięcia', 'success')
      return
    }
    // usuwamy partiami po 200 id
    for (let i = 0; i < toDelete.length; i += 200) {
      const batch = toDelete.slice(i, i + 200)
      const { error } = await supabase.from('warehouse_stock').delete().in('id', batch)
      if (error) {
        pushToast(`Błąd usuwania: ${error.message}`, 'error')
        return
      }
    }
    pushToast(`Usunięto ${toDelete.length} błędnych półek`, 'success')
    await fetchWarehouseStock()
  }, [pushToast, fetchWarehouseStock])

  const handleUpdateWarehouseComponent = useCallback(
    async (id: number, data: WarehouseComponentUpdateInput) => {
      const { error } = await supabase
        .from('warehouse_components')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }
      pushToast('Komponent zaktualizowany', 'success')
      await fetchWarehouseComponents()
    },
    [pushToast, fetchWarehouseComponents],
  )

  // ---------------------------------------------------------------------------
  // Alert badge count
  // ---------------------------------------------------------------------------

  const fetchAlertsBadgeCount = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_stock_alerts')
    if (error) {
      console.warn('[Alerts] badge count fetch error:', error.message)
      return
    }
    const count = (data ?? []).filter(
      (r: Record<string, unknown>) =>
        r.r_alert_level === 'critical' || r.r_alert_level === 'warning',
    ).length
    setAlertsBadgeCount(count)
  }, [setAlertsBadgeCount])

  // ---------------------------------------------------------------------------
  // Stock operations
  // ---------------------------------------------------------------------------

  const consumeStockForOrderWithToasts = useCallback(
    async (insertedOrderId: number | null | undefined) => {
      if (!insertedOrderId) return
      try {
        const { data: consumeResult, error: consumeError } = await supabase.rpc('consume_stock_for_order', {
          p_order_id: insertedOrderId,
        })

        if (consumeError) {
          pushToast(`Ostrzeżenie: błąd pobrania z magazynu: ${consumeError.message}`, 'error')
        } else if (consumeResult && Array.isArray(consumeResult) && consumeResult.length > 0) {
          const noRecipe = consumeResult.some((r: { r_status?: string }) => r.r_status === 'no_recipe')
          const insufficient = consumeResult.filter((r: { r_status?: string }) => r.r_status === 'insufficient')
          const ok = consumeResult.filter((r: { r_status?: string }) => r.r_status === 'ok')

          if (noRecipe) {
            pushToast('Brak receptur dla tego zamówienia — nic nie pobrano z magazynu', 'info')
          } else if (insufficient.length > 0) {
            pushToast(
              `Pobrano z magazynu (${ok.length} pozycji OK, ${insufficient.length} na minus)`,
              'info',
            )
          } else {
            pushToast(`Pobrano z magazynu ${ok.length} pozycji`, 'success')
          }
        }

        if (!consumeError) {
          const orderId = insertedOrderId
          const { data: updatedOrder } = await supabase.from('orders').select('*').eq('id', orderId).single()
          if (updatedOrder) {
            setOrders((prev) =>
              prev.map((o) => (o.id === orderId ? { ...o, ...(updatedOrder as Order) } : o)),
            )
          }
        }
      } catch (err) {
        console.error('consume_stock_for_order error:', err)
        pushToast('Ostrzeżenie: nie udało się pobrać z magazynu', 'error')
      }
      if (activeTab === 'Magazyn') {
        await fetchWarehouseStock()
      }
      void fetchAlertsBadgeCount()
    },
    [activeTab, fetchWarehouseStock, fetchAlertsBadgeCount, pushToast, setOrders],
  )

  const syncWarehouseStockAfterOrderEdit = useCallback(
    async (orderId: number, baseline: Order | null, newData: Partial<Order>) => {
      if (!baseline) return

      const relevantFields: (keyof Order)[] = [
        'quantity',
        'category',
        'system',
        'model',
        'wing_color',
        'frame_color',
        'width',
        'glazing',
        'direction',
        'decorative_panel',
        'hardware',
        'handle',
        'peephole',
        'electric_strike',
      ]

      const changed = relevantFields.some((field) => {
        const oldVal = baseline[field] ?? null
        const newVal = newData[field] ?? null
        return String(oldVal) !== String(newVal)
      })

      if (!changed) return

      await supabase.rpc('return_stock_for_order', {
        p_order_id: orderId,
      })
      await consumeStockForOrderWithToasts(orderId)
    },
    [consumeStockForOrderWithToasts],
  )

  // ---------------------------------------------------------------------------
  // Recipe operations
  // ---------------------------------------------------------------------------

  const handleDeleteRecipe = useCallback(
    async (id: number) => {
      touchSession()
      const recipe = warehouseRecipes.find((r) => r.id === id)
      const recipeName = recipe?.name || `#${id}`

      setDeleteConfirm({
        title: 'Usuń recepturę',
        confirmLabel: 'Usuń',
        cancelLabel: 'Anuluj',
        message: `Czy na pewno chcesz usunąć recepturę "${recipeName}"?`,
        runDelete: async () => {
          touchSession()
          const { error } = await supabase.from('warehouse_recipes').update({ is_active: false }).eq('id', id)
          if (error) {
            pushToast(`Błąd: ${error.message}`, 'error')
            return
          }
          pushToast('Receptura usunięta', 'success')
          await fetchWarehouseRecipes()
        },
      })
    },
    [pushToast, fetchWarehouseRecipes, warehouseRecipes, setDeleteConfirm, touchSession],
  )

  const handleToggleRecipeActive = useCallback(
    async (id: number, active: boolean) => {
      const { error } = await supabase.from('warehouse_recipes').update({ is_active: active }).eq('id', id)
      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }
      await fetchWarehouseRecipes()
    },
    [pushToast, fetchWarehouseRecipes],
  )

  const handleRestoreRecipe = useCallback(
    async (id: number) => {
      const { error } = await supabase.from('warehouse_recipes').update({ is_active: true }).eq('id', id)
      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }
      pushToast('Receptura przywrócona', 'success')
      await fetchWarehouseRecipes()
    },
    [pushToast, fetchWarehouseRecipes],
  )

  const handleOpenRecipeEditor = useCallback(() => {
    setRecipeEditorMode('create')
    setRecipeFormData({ ...INITIAL_RECIPE_FORM })
    setRecipeEditorOpen(true)
  }, [])

  const handleEditRecipe = useCallback(
    async (recipe: WarehouseRecipe) => {
      const [{ data: components, error }, { data: criteriaRows, error: critError }] = await Promise.all([
        supabase.from('warehouse_recipe_components').select('*').eq('recipe_id', recipe.id),
        supabase.from('warehouse_recipe_criteria').select('*').eq('recipe_id', recipe.id).order('id'),
      ])
      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }
      if (critError) {
        pushToast(`Błąd kryteriów: ${critError.message}`, 'error')
        return
      }
      setRecipeEditorMode('edit')
      setRecipeFormData({
        id: recipe.id,
        name: recipe.name ?? '',
        category: recipe.category,
        part: recipe.part,
        criteria: ((criteriaRows ?? []) as Array<{ field: string; allowed_values: string[] }>).map((c) => ({
          field: c.field,
          values: Array.isArray(c.allowed_values) ? c.allowed_values : [],
        })),
        system: recipe.system ?? '',
        model: recipe.model ?? '',
        wing_color: recipe.wing_color ?? '',
        frame_color: recipe.frame_color ?? '',
        width: recipe.width ?? '',
        glazing: recipe.glazing ?? '',
        direction: recipe.direction ?? '',
        decorative_panel: recipe.decorative_panel ?? '',
        hardware: recipe.hardware ?? '',
        handle: recipe.handle ?? '',
        peephole: recipe.peephole ?? '',
        electric_strike: recipe.electric_strike ?? '',
        is_active: recipe.is_active,
        notes: recipe.notes ?? '',
        components: (components ?? []) as WarehouseRecipeComponent[],
      })
      setRecipeEditorOpen(true)
    },
    [pushToast],
  )

  const handleRecipeFormChange = useCallback((field: keyof RecipeFormState, value: unknown) => {
    setRecipeFormData((prev) => ({ ...prev, [field]: value }))
  }, [])

  const handleRecipeComponentChange = useCallback(
    (index: number, field: keyof WarehouseRecipeComponent, value: unknown) => {
      setRecipeFormData((prev) => ({
        ...prev,
        components: prev.components.map((c, i) => (i === index ? { ...c, [field]: value } : c)),
      }))
    },
    [],
  )

  const handleAddRecipeComponent = useCallback(() => {
    setRecipeFormData((prev) => ({
      ...prev,
      components: [...prev.components, { component_id: 0, quantity: 1, notes: '' }],
    }))
  }, [])

  const handleRemoveRecipeComponent = useCallback((index: number) => {
    setRecipeFormData((prev) => ({
      ...prev,
      components: prev.components.filter((_, i) => i !== index),
    }))
  }, [])

  const handleSaveRecipe = useCallback(async () => {
    touchSession()
    setRecipeSaving(true)
    try {
      // Kryteria dopasowania żyją teraz w warehouse_recipe_criteria (dynamiczne);
      // starych kolumn atrybutów już nie zapisujemy.
      const payload = {
        name: buildRecipeAutoName(recipeFormData).trim() || null,
        category: recipeFormData.category,
        part: recipeFormData.part,
        is_active: recipeFormData.is_active,
        notes: recipeFormData.notes.trim() || null,
        updated_at: new Date().toISOString(),
      }

      let recipeId = recipeFormData.id

      if (recipeEditorMode === 'create') {
        const { data, error } = await supabase.from('warehouse_recipes').insert(payload).select('id').single()
        if (error) {
          pushToast(`Błąd: ${error.message}`, 'error')
          return
        }
        recipeId = data?.id as number
      } else {
        const { error } = await supabase.from('warehouse_recipes').update(payload).eq('id', recipeFormData.id!)
        if (error) {
          pushToast(`Błąd: ${error.message}`, 'error')
          return
        }
        await supabase.from('warehouse_recipe_components').delete().eq('recipe_id', recipeId!)
      }

      // Kryteria dopasowania (pole + wartości; puste pomijamy).
      // ODPORNOŚĆ NA BŁĄD W POŁOWIE (np. zanik internetu): receptura bez kryteriów
      // pasuje do CAŁEJ kategorii i zjada magazyn — nie wolno zostawić sieroty.
      const validCriteria = (recipeFormData.criteria ?? []).filter(
        (c) => c.field.trim() && c.values.some((v) => v.trim()),
      )
      if (validCriteria.length > 0) {
        // upsert: przy edycji stare kryteria zostają nietknięte, jeśli zapis padnie
        const { error: critErr } = await supabase.from('warehouse_recipe_criteria').upsert(
          validCriteria.map((c) => ({
            recipe_id: recipeId,
            field: c.field.trim(),
            allowed_values: c.values.map((v) => v.trim()).filter(Boolean),
          })),
          { onConflict: 'recipe_id,field' },
        )
        if (critErr) {
          if (recipeEditorMode === 'create') {
            // wycofaj świeżo utworzoną recepturę — bez kryteriów łapałaby wszystko
            await supabase.from('warehouse_recipes').delete().eq('id', recipeId!)
          }
          pushToast(`Błąd zapisu kryteriów — receptura NIE została zapisana: ${critErr.message}`, 'error')
          return
        }
        // dopiero po udanym zapisie sprzątamy kryteria usunięte w edytorze
        const keepFields = validCriteria.map((c) => c.field.trim())
        await supabase
          .from('warehouse_recipe_criteria')
          .delete()
          .eq('recipe_id', recipeId!)
          .not('field', 'in', `(${keepFields.join(',')})`)
      } else if (recipeEditorMode === 'edit') {
        // świadome wyczyszczenie wszystkich kryteriów (receptura na całą kategorię)
        await supabase.from('warehouse_recipe_criteria').delete().eq('recipe_id', recipeId!)
      }

      const valid = recipeFormData.components.filter((c) => c.component_id > 0 && c.quantity > 0)
      if (valid.length > 0) {
        const { error } = await supabase.from('warehouse_recipe_components').insert(
          valid.map((c) => ({
            recipe_id: recipeId,
            component_id: c.component_id,
            quantity: c.quantity,
            notes: c.notes?.trim() || null,
          })),
        )
        if (error) {
          pushToast(`Błąd zapisu pozycji: ${error.message}`, 'error')
          return
        }
      }

      pushToast(
        recipeEditorMode === 'create' ? 'Receptura utworzona' : 'Receptura zaktualizowana',
        'success',
      )
      setRecipeEditorOpen(false)
      await fetchWarehouseRecipes()
    } finally {
      setRecipeSaving(false)
    }
  }, [recipeFormData, recipeEditorMode, pushToast, fetchWarehouseRecipes, touchSession])

  // ---------------------------------------------------------------------------
  // Door component modals
  // ---------------------------------------------------------------------------

  const openAddDoorComponent = useCallback(() => {
    setDoorComponentModal({ open: true, mode: 'add', component: null })
  }, [])

  const openEditDoorComponent = useCallback((c: WarehouseComponent) => {
    setDoorComponentModal({ open: true, mode: 'edit', component: c })
  }, [])

  const openComponentHistory = useCallback((component: WarehouseComponent) => {
    setComponentHistoryModal({ open: true, component })
  }, [])

  const closeComponentHistory = useCallback(() => {
    setComponentHistoryModal({ open: false, component: null })
  }, [])

  // ---------------------------------------------------------------------------
  // PZ (goods received)
  // ---------------------------------------------------------------------------

  const handleOpenPzForm = useCallback((warehouseId?: number) => {
    setPzFormData({
      ...INITIAL_PZ_FORM,
      warehouse_id: warehouseId ?? null,
    })
    setPzFormOpen(true)
  }, [])

  const handlePzFormChange = useCallback((field: keyof PzFormState, value: unknown) => {
    setPzFormData((prev) => ({ ...prev, [field]: value }))
  }, [])

  const handlePzItemChange = useCallback((index: number, field: keyof PzItem, value: unknown) => {
    setPzFormData((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === index ? { ...it, [field]: value } : it)),
    }))
  }, [])

  const handleAddPzItem = useCallback(() => {
    setPzFormData((prev) => ({
      ...prev,
      items: [...prev.items, { component_id: 0, quantity: 0, notes: '' }],
    }))
  }, [])

  const handleRemovePzItem = useCallback((index: number) => {
    setPzFormData((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }))
  }, [])

  const handleSavePz = useCallback(async () => {
    touchSession()
    if (!pzFormData.warehouse_id) {
      pushToast('Wybierz magazyn', 'error')
      return
    }
    const validItems = pzFormData.items.filter((it) => it.component_id > 0 && it.quantity > 0)
    if (validItems.length === 0) {
      pushToast('Dodaj co najmniej jedną pozycję', 'error')
      return
    }

    setPzSaving(true)
    try {
      const { data, error } = await supabase.rpc('create_pz_document', {
        p_warehouse_id: pzFormData.warehouse_id,
        p_items: validItems,
        p_reference_doc: pzFormData.reference_doc.trim() || null,
        p_notes: pzFormData.notes.trim() || null,
      })
      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }
      const rows = Array.isArray(data) ? data : data != null ? [data as Record<string, unknown>] : []
      const totalRevalidated = rows.reduce(
        (sum: number, r: Record<string, unknown>) => sum + Number(r.r_revalidated_orders ?? 0),
        0,
      )
      if (totalRevalidated > 0) {
        pushToast(
          `Przyjęcie zapisane (${validItems.length} poz.) — zaktualizowano ${totalRevalidated} zamówień`,
          'success',
        )
      } else {
        pushToast(`Przyjęcie zapisane (${validItems.length} poz.)`, 'success')
      }
      setPzFormOpen(false)
      await fetchPzGroups()
      await fetchWarehouseStock()
      await fetchOrders()
      await fetchOrdersNeedingReviewInternal()
      void fetchAlertsBadgeCount()
    } finally {
      setPzSaving(false)
    }
  }, [pzFormData, pushToast, fetchPzGroups, fetchWarehouseStock, fetchOrders, fetchOrdersNeedingReviewInternal, fetchAlertsBadgeCount, touchSession])

  const handlePzPreview = useCallback((referenceDoc: string) => {
    setDocDetailsModal({ open: true, referenceDoc, movementType: 'PZ' })
  }, [])

  const handleCloseDocDetails = useCallback(() => {
    setDocDetailsModal({ open: false, referenceDoc: null, movementType: null })
  }, [])

  // ---------------------------------------------------------------------------
  // MM (warehouse transfers)
  // ---------------------------------------------------------------------------

  const handleOpenMmForm = useCallback(() => {
    setMmFormData(INITIAL_MM_FORM)
    setMmFormOpen(true)
  }, [])

  const handleMmFormChange = useCallback((field: keyof MmFormState, value: unknown) => {
    setMmFormData((prev) => ({ ...prev, [field]: value }))
  }, [])

  const handleMmItemChange = useCallback((index: number, field: keyof MmItem, value: unknown) => {
    setMmFormData((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === index ? { ...it, [field]: value } : it)),
    }))
  }, [])

  const handleAddMmItem = useCallback(() => {
    setMmFormData((prev) => ({
      ...prev,
      items: [...prev.items, { component_id: 0, quantity: 0, notes: '' }],
    }))
  }, [])

  const handleRemoveMmItem = useCallback((index: number) => {
    setMmFormData((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }))
  }, [])

  const handleSaveMm = useCallback(async () => {
    touchSession()
    if (!mmFormData.warehouse_from_id || !mmFormData.warehouse_to_id) {
      pushToast('Wybierz oba magazyny', 'error')
      return
    }
    if (mmFormData.warehouse_from_id === mmFormData.warehouse_to_id) {
      pushToast('Magazyny muszą być różne', 'error')
      return
    }
    const validItems = mmFormData.items.filter((it) => it.component_id > 0 && it.quantity > 0)
    if (validItems.length === 0) {
      pushToast('Dodaj co najmniej jedną pozycję', 'error')
      return
    }

    setMmSaving(true)
    try {
      const { data, error } = await supabase.rpc('create_mm_document', {
        p_warehouse_from_id: mmFormData.warehouse_from_id,
        p_warehouse_to_id: mmFormData.warehouse_to_id,
        p_items: validItems,
        p_reference_doc: mmFormData.reference_doc.trim() || null,
        p_notes: mmFormData.notes.trim() || null,
      })
      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }
      const rows = Array.isArray(data) ? data : data != null ? [data as Record<string, unknown>] : []
      const totalRevalidated = rows.reduce(
        (sum: number, r: Record<string, unknown>) => sum + Number(r.r_revalidated_orders ?? 0),
        0,
      )
      if (totalRevalidated > 0) {
        pushToast(
          `Przesunięcie zapisane (${validItems.length} poz.) — zaktualizowano ${totalRevalidated} zamówień`,
          'success',
        )
      } else {
        pushToast(`Przesunięcie zapisane (${validItems.length} poz.)`, 'success')
      }
      setMmFormOpen(false)
      await fetchMmGroups()
      await fetchWarehouseStock()
      await fetchOrders()
      void fetchAlertsBadgeCount()
    } finally {
      setMmSaving(false)
    }
  }, [mmFormData, pushToast, fetchMmGroups, fetchWarehouseStock, fetchOrders, fetchAlertsBadgeCount, touchSession])

  const handleMmPreview = useCallback((referenceDoc: string) => {
    setDocDetailsModal({ open: true, referenceDoc, movementType: 'MM' })
  }, [])

  // ---------------------------------------------------------------------------
  // Supplier
  // ---------------------------------------------------------------------------

  const openCreateSupplier = useCallback(() => {
    setSupplierModal({ open: true, mode: 'add', supplier: null })
  }, [])

  const openEditSupplier = useCallback((supplier: Supplier) => {
    setSupplierModal({ open: true, mode: 'edit', supplier })
  }, [])

  const closeSupplierModal = useCallback(() => {
    setSupplierModal((prev) => ({ ...prev, open: false }))
  }, [])

  const toggleSupplierActive = useCallback(
    async (supplier: Supplier) => {
      const { error } = await supabase
        .from('suppliers')
        .update({ is_active: !supplier.is_active, updated_at: new Date().toISOString() })
        .eq('id', supplier.id)
      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }
      pushToast(supplier.is_active ? 'Dostawca dezaktywowany' : 'Dostawca aktywowany', 'success')
      await fetchSuppliers()
    },
    [fetchSuppliers, pushToast],
  )

  // ---------------------------------------------------------------------------
  // Shopping list
  // ---------------------------------------------------------------------------

  const handleAddToShoppingList = useCallback(
    (item: ShoppingListItem) => {
      setShoppingList((prev) => {
        if (prev.some((p) => p.component_id === item.component_id)) return prev
        pushToast(`Dodano do listy zakupowej: ${item.component_name}`, 'success')
        return [...prev, item]
      })
    },
    [pushToast],
  )

  const handleRemoveFromShoppingList = useCallback((componentId: number) => {
    setShoppingList((prev) => prev.filter((p) => p.component_id !== componentId))
  }, [])

  const handleUpdateShoppingListQuantity = useCallback((componentId: number, newQty: number) => {
    if (newQty < 1) return
    setShoppingList((prev) =>
      prev.map((item) => (item.component_id === componentId ? { ...item, quantity: newQty } : item)),
    )
  }, [])

  const handleClearShoppingList = useCallback(() => {
    setShoppingList([])
    pushToast('Lista wyczyszczona', 'info')
  }, [pushToast])

  // ---------------------------------------------------------------------------
  // Purchase order modals
  // ---------------------------------------------------------------------------

  const openPoDetails = useCallback((po: PurchaseOrder) => {
    setPoDetailsModal({ open: true, po })
  }, [])

  const closePoDetails = useCallback(() => {
    setPoDetailsModal({ open: false, po: null })
  }, [])

  const openPoReceive = useCallback((po: PurchaseOrder) => {
    setPoDetailsModal({ open: false, po: null })
    setPoReceiveModal({ open: true, po })
  }, [])

  const closePoReceive = useCallback(() => {
    setPoReceiveModal({ open: false, po: null })
  }, [])

  const onPoAfterAction = useCallback(async () => {
    await fetchPurchaseOrders()
    await fetchWarehouseStock()
    await fetchWarehouseMovements()
    await fetchSmartRop()
  }, [fetchPurchaseOrders, fetchWarehouseStock, fetchWarehouseMovements, fetchSmartRop])

  // ---------------------------------------------------------------------------
  // Other
  // ---------------------------------------------------------------------------

  const openComponentEditFromDashboard = useCallback(
    (component: WarehouseComponent) => {
      if (component.product_category === 'raw' || component.product_category == null) {
        setActiveWarehouseSubTab('Komponenty')
        setWarehouseEditRequestComponent(component)
      } else {
        setDoorComponentModal({ open: true, mode: 'edit', component })
      }
    },
    [setActiveWarehouseSubTab],
  )

  // ---------------------------------------------------------------------------
  // useEffect triggers
  // ---------------------------------------------------------------------------

  // Odśwież badge przy starcie (niezależnie od aktywnej zakładki)
  useEffect(() => {
    void fetchAlertsBadgeCount()
  }, [fetchAlertsBadgeCount])

  useEffect(() => {
    if (!isWarehouseTab) return
    void fetchWarehouseComponents()
  }, [isWarehouseTab, fetchWarehouseComponents])

  useEffect(() => {
    if (isWarehouseTab) {
      void fetchWarehouses()
    }
  }, [isWarehouseTab, fetchWarehouses])

  useEffect(() => {
    if (isWarehouseTab) {
      void fetchWarehouseStock()
    }
  }, [isWarehouseTab, fetchWarehouseStock])

  useEffect(() => {
    if (isWarehouseTab) {
      void fetchSmartRop()
    }
  }, [isWarehouseTab, fetchSmartRop])

  useEffect(() => {
    if (isWarehouseTab) {
      void fetchPurchaseOrders()
    }
  }, [isWarehouseTab, fetchPurchaseOrders])

  useEffect(() => {
    if (isWarehouseTab && activeWarehouseSubTab === 'Receptury') {
      void fetchWarehouseRecipes()
    }
  }, [isWarehouseTab, activeWarehouseSubTab, fetchWarehouseRecipes, showDeletedRecipes])

  useEffect(() => {
    if (isWarehouseTab) {
      void fetchWarehouseMovements()
    }
  }, [isWarehouseTab, fetchWarehouseMovements])

  useEffect(() => {
    if (isWarehouseTab && activeWarehouseSubTab === 'Przyjęcia') {
      void fetchPzGroups()
    }
  }, [isWarehouseTab, activeWarehouseSubTab, fetchPzGroups])

  useEffect(() => {
    if (isWarehouseTab && activeWarehouseSubTab === 'Przesunięcia') {
      void fetchMmGroups()
    }
  }, [isWarehouseTab, activeWarehouseSubTab, fetchMmGroups])

  useEffect(() => {
    if (isWarehouseTab && activeWarehouseSubTab === 'Miesięczne zużycie') {
      void fetchMonthlyConsumption(monthlyConsumptionRange)
    }
  }, [isWarehouseTab, activeWarehouseSubTab, monthlyConsumptionRange, fetchMonthlyConsumption])

  useEffect(() => {
    if (isWarehouseTab && activeWarehouseSubTab === 'Komponenty') {
      void fetchWarehouseComponents()
    }
  }, [isWarehouseTab, activeWarehouseSubTab, fetchWarehouseComponents])

  // ---------------------------------------------------------------------------
  // Realtime — magazyn
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!isWarehouseTab) return

    // warehouse_stock → odśwież stany + alerty
    const stockChannel = supabase
      .channel('warehouse:stock:realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'warehouse_stock' },
        () => {
          void fetchWarehouseStock()
          void fetchAlertsBadgeCount()
        },
      )
      .subscribe()

    // warehouse_movements → odśwież ruchy + stany
    const movChannel = supabase
      .channel('warehouse:movements:realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'warehouse_movements' },
        () => {
          void fetchWarehouseMovements()
          void fetchWarehouseStock()
          void fetchAlertsBadgeCount()
          if (activeWarehouseSubTab === 'Przyjęcia') void fetchPzGroups()
          if (activeWarehouseSubTab === 'Przesunięcia') void fetchMmGroups()
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(stockChannel)
      void supabase.removeChannel(movChannel)
    }
  }, [
    isWarehouseTab,
    activeWarehouseSubTab,
    fetchWarehouseStock,
    fetchWarehouseMovements,
    fetchAlertsBadgeCount,
    fetchPzGroups,
    fetchMmGroups,
  ])

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    // State
    warehouseComponents,
    setWarehouseComponents,
    warehouseComponentsLoading,
    warehouseRecipes,
    warehouseRecipesLoading,
    showDeletedRecipes,
    setShowDeletedRecipes,
    warehouses,
    warehouseStock,
    warehouseStockLoading,
    warehouseMovements,
    warehouseMovementsLoading,
    pzGroups,
    pzGroupsLoading,
    pzFormOpen,
    setPzFormOpen,
    pzFormData,
    pzSaving,
    mmGroups,
    mmGroupsLoading,
    mmFormOpen,
    setMmFormOpen,
    mmFormData,
    mmSaving,
    monthlyConsumption,
    monthlyConsumptionMonths,
    monthlyConsumptionLoading,
    monthlyConsumptionRange,
    setMonthlyConsumptionRange,
    doorComponentModal,
    setDoorComponentModal,
    componentHistoryModal,
    docDetailsModal,
    recipeEditorOpen,
    setRecipeEditorOpen,
    recipeEditorMode,
    recipeFormData,
    recipeSaving,
    suppliers,
    suppliersLoading,
    supplierModal,
    setSupplierModal,
    shoppingList,
    shoppingListModalOpen,
    setShoppingListModalOpen,
    smartRopData,
    smartRopLoading,
    purchaseOrders,
    purchaseOrderItems,
    purchaseOrdersLoading,
    poDetailsModal,
    poReceiveModal,
    companySettings,
    companySettingsLoading,
    warehouseEditRequestComponent,
    setWarehouseEditRequestComponent,
    ordersNeedingReview,
    setOrdersNeedingReview,
    reviewLoading,
    // Fetch functions
    fetchWarehouseComponents,
    fetchWarehouseRecipes,
    fetchWarehouses,
    fetchWarehouseStock,
    fetchWarehouseMovements,
    fetchPzGroups,
    fetchMmGroups,
    fetchMonthlyConsumption,
    fetchSuppliers,
    fetchCompanySettings,
    fetchPurchaseOrders,
    fetchSmartRop,
    fetchOrdersNeedingReview: fetchOrdersNeedingReviewInternal,
    // Component CRUD
    handleCreateWarehouseComponent,
    handleUpdateWarehouseComponent,
    handleSetComponentWarehouses,
    handleCleanupOrphanStock,
    // Stock operations
    consumeStockForOrderWithToasts,
    syncWarehouseStockAfterOrderEdit,
    // Recipe operations
    handleDeleteRecipe,
    handleToggleRecipeActive,
    handleRestoreRecipe,
    handleOpenRecipeEditor,
    handleEditRecipe,
    handleRecipeFormChange,
    handleRecipeComponentChange,
    handleAddRecipeComponent,
    handleRemoveRecipeComponent,
    handleSaveRecipe,
    // Door component modals
    openAddDoorComponent,
    openEditDoorComponent,
    openComponentHistory,
    closeComponentHistory,
    // PZ
    handleOpenPzForm,
    handlePzFormChange,
    handlePzItemChange,
    handleAddPzItem,
    handleRemovePzItem,
    handleSavePz,
    handlePzPreview,
    handleCloseDocDetails,
    // MM
    handleOpenMmForm,
    handleMmFormChange,
    handleMmItemChange,
    handleAddMmItem,
    handleRemoveMmItem,
    handleSaveMm,
    handleMmPreview,
    // Supplier
    openCreateSupplier,
    openEditSupplier,
    closeSupplierModal,
    toggleSupplierActive,
    // Shopping list
    handleAddToShoppingList,
    handleRemoveFromShoppingList,
    handleUpdateShoppingListQuantity,
    handleClearShoppingList,
    // Purchase order modals
    openPoDetails,
    closePoDetails,
    openPoReceive,
    closePoReceive,
    onPoAfterAction,
    // Other
    openComponentEditFromDashboard,
  }
}
