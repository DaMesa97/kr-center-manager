import { useCallback, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { supabase } from '../supabaseClient'
import {
  EDITABLE_CATEGORIES,
  INITIAL_BASTION_ORDER_FORM,
  INITIAL_FORM_DATA,
  INITIAL_STA_ORDER_FORM,
  INITIAL_ST_ORDER_FORM,
  INITIAL_TECHNICZNE_ORDER_FORM,
  TABS,
} from '../constants'
import {
  applyDefaultConfigValues,
  calcExtensionDims,
  calcGlassDim,
  calcSidePanelHeight,
  calcTopLightWidth,
  createEmptyProductionStages,
  getGlassAllowance,
  getProfileWidth,
  isExtSideActive,
  isReleaseDateEmpty,
  isRushOrderSequence,
  isStaTitanLinked,
  isStTitanSystemLabel,
  isTitanSystem,
  mergeOrderExtraFields,
  orderMetaForUpdate,
  orderToBastionForm,
  orderToLegacyForm,
  orderToStForm,
  orderToStaForm,
  orderToTechniczneForm,
  parseProductionStages,
  productionStagesFromLegacyStageFormFields,
  sanitizeOrderPayloadForDb,
  splitWxH,
  validateOrderForm,
} from '../utils'
import { isBotOrder } from '../utils/botOrder'
import type {
  BastionOrderFormData,
  Company,
  ConfigOptionRecord,
  DeleteConfirmState,
  DimensionMap,
  GlassAllowance,
  InternalDoorItem,
  NewOrderFormData,
  Order,
  OrderNeedingReview,
  StaConfigRow,
  StaOrderFormData,
  StOrderFormData,
  SubTab,
  TechniczneOrderFormData,
  ToastVariant,
  WarehouseMovementRow,
} from '../types'
import type React from 'react'

const emptyOrderMeta = {
  disting_sheet: '',
  sta_sheet: '',
  sta_ref: '',
  st_sheet: '',
  linked_order_id: null as number | null,
  defects: '',
  entered_by: '',
  configurator_value: null as number | null,
  info: '',
  airtable_id: '',
  label: '',
  electric_strike: '',
}

type CurrentUser = {
  id: string
  email: string
  initials: string
  full_name: string
  role: string
  department: string
}

type UseOrdersParams = {
  pushToast: (msg: string, variant: ToastVariant) => void
  touchSession: () => void
  activeTab: (typeof TABS)[number]
  isManager: boolean
  currentUser: CurrentUser | null
  companies: Company[]
  // z useConfig:
  allConfigDefaults: ConfigOptionRecord[]
  bastionFrameOptions: ConfigOptionRecord[]
  dimensionMap: DimensionMap[]
  glassAllowances: GlassAllowance[]
  extensionProfileWidths: { category: string; profile_width_mm: number }[]
  // z useWarehouse:
  consumeStockForOrderWithToasts: (orderId: number, category?: string) => Promise<void>
  syncWarehouseStockAfterOrderEdit: (orderId: number, oldOrder: Order, newData: Record<string, unknown>) => Promise<void>
  fetchOrdersNeedingReview: () => Promise<void>
  setOrdersNeedingReview: React.Dispatch<React.SetStateAction<OrderNeedingReview[]>>
  fetchWarehouseStock: () => Promise<void>
  fetchSmartRop: () => Promise<void>
  // z useCompanies:
  setShowCompanyDropdown: React.Dispatch<React.SetStateAction<boolean>>
  setHighlightedIndex: React.Dispatch<React.SetStateAction<number>>
  highlightedIndex: number
  // globalne:
  setDeleteConfirm: (v: DeleteConfirmState | null) => void
  setActiveTab: React.Dispatch<React.SetStateAction<(typeof TABS)[number]>>
  setActiveSubTab: React.Dispatch<React.SetStateAction<SubTab>>
}

export function useOrders({
  pushToast,
  touchSession,
  activeTab,
  isManager,
  currentUser,
  companies,
  allConfigDefaults,
  bastionFrameOptions: _bastionFrameOptions,
  dimensionMap,
  glassAllowances,
  extensionProfileWidths,
  consumeStockForOrderWithToasts,
  syncWarehouseStockAfterOrderEdit,
  fetchOrdersNeedingReview,
  setOrdersNeedingReview: _setOrdersNeedingReview,
  fetchWarehouseStock,
  fetchSmartRop,
  setShowCompanyDropdown,
  setHighlightedIndex,
  highlightedIndex,
  setDeleteConfirm,
  setActiveTab,
  setActiveSubTab,
}: UseOrdersParams) {
  void _bastionFrameOptions
  void extensionProfileWidths
  void _setOrdersNeedingReview

  const [alertsBadgeCount, setAlertsBadgeCount] = useState(0)
  const [orders, setOrders] = useState<Order[]>([])
  // Najnowsza żądana kategoria — chroni fetchOrders przed race przy przełączaniu zakładek
  const latestFetchTabRef = useRef(activeTab)
  // Guard przeciw podwójnemu zapisowi zamówienia (double-click zanim isSaving zadziała)
  const isSavingRef = useRef(false)
  const [internalDoorItems, setInternalDoorItems] = useState<InternalDoorItem[]>([])
  const [linkedOrders, setLinkedOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [internalDoorOrderModal, setInternalDoorOrderModal] = useState<{
    open: boolean
    mode: 'create' | 'edit'
    order: Order | null
  }>({ open: false, mode: 'create', order: null })
  const [internalDoorDetailsModal, setInternalDoorDetailsModal] = useState<{
    open: boolean
    order: Order | null
  }>({ open: false, order: null })
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null)
  const [editingOrderBaseline, setEditingOrderBaseline] = useState<Order | null>(null)
  const [orderFormOpenSnapshot, setOrderFormOpenSnapshot] = useState<Record<string, unknown> | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [formData, setFormData] = useState<NewOrderFormData>(INITIAL_FORM_DATA)
  const [staFormData, setStaFormData] = useState<StaOrderFormData>(INITIAL_STA_ORDER_FORM)
  const [stFormData, setStFormData] = useState<StOrderFormData>(INITIAL_ST_ORDER_FORM)
  const [bastionFormData, setBastionFormData] = useState<BastionOrderFormData>(INITIAL_BASTION_ORDER_FORM)
  const [techniczneFormData, setTechniczneFormData] = useState<TechniczneOrderFormData>(INITIAL_TECHNICZNE_ORDER_FORM)
  const [orderFormErrors, setOrderFormErrors] = useState<string[]>([])
  const [orderModalConfigRows, setOrderModalConfigRows] = useState<StaConfigRow[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedProductionDay, setSelectedProductionDay] = useState('Wszystkie dni')
  const [hideCompletedOrders, setHideCompletedOrders] = useState(true)
  const [showCancelledOrders, setShowCancelledOrders] = useState(false)
  const [sourceFilter, setSourceFilter] = useState<'all' | 'manual' | 'bot'>('all')
  const [stageRevertTarget, setStageRevertTarget] = useState<{
    orderId: number
    stageKey: string
  } | null>(null)
  const [productionStageUpdating, setProductionStageUpdating] = useState<string | null>(null)
  const [releaseClearTarget, setReleaseClearTarget] = useState<{ orderId: number } | null>(null)
  const [releaseDateUpdating, setReleaseDateUpdating] = useState<number | null>(null)
  const [rushUpdatingOrderId, setRushUpdatingOrderId] = useState<number | null>(null)
  const [historyModal, setHistoryModal] = useState<{
    open: boolean
    orderId: number | null
    orderNumber: string | null
  }>({ open: false, orderId: null, orderNumber: null })

  const fetchAlertsBadgeCount = useCallback(async () => {
    if (!isManager) return
    const { data, error } = await supabase.rpc('get_stock_alerts_summary')
    if (error) {
      console.error(error)
      return
    }
    const arr = Array.isArray(data) ? data : data != null ? [data] : []
    const row = arr[0] as Record<string, unknown> | undefined
    setAlertsBadgeCount(Number(row?.r_total_needs_attention ?? 0))
  }, [isManager])

  const submitOnEnterInInput = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>, action: () => void) => {
      if (e.key !== 'Enter') return
      const target = e.target
      if (!(target instanceof HTMLInputElement)) return
      if (target.classList.contains('search-input')) return
      const inputType = target.type.toLowerCase()
      if (
        inputType !== 'text' &&
        inputType !== 'number' &&
        inputType !== 'email' &&
        inputType !== 'password'
      ) {
        return
      }
      e.preventDefault()
      action()
    },
    [],
  )

  const applyProductionStagesUpdate = useCallback(
    async (orderId: number, stageKey: string, stageValue: string) => {
      setProductionStageUpdating(String(orderId))
      const { error } = await supabase.rpc('update_order_stage', {
        p_order_id: orderId,
        p_stage_key: stageKey,
        p_stage_value: stageValue,
      })
      if (error) {
        pushToast(`Wystąpił błąd: ${error.message}`, 'error')
        setProductionStageUpdating(null)
        return
      }
      setOrders((prev) =>
        prev.map((o) => {
          if (o.id !== orderId) return o
          const current = parseProductionStages(o.production_stages, o.category)
          return { ...o, production_stages: { ...current, [stageKey]: stageValue } }
        }),
      )
      setProductionStageUpdating(null)
    },
    [pushToast],
  )

  const syncMirrorStagesToLinkedOrder = useCallback(
    async (sourceOrder: Order, stageKey: string, value: string) => {
      const linkedId = sourceOrder.linked_order_id
      if (linkedId == null) return

      if (sourceOrder.category === 'STA' && stageKey === 'e5') {
        const { error: upErr } = await supabase.rpc('update_order_stage', {
          p_order_id: linkedId,
          p_stage_key: 'sta_e5',
          p_stage_value: value,
        })
        if (upErr) {
          pushToast(`Błąd synchronizacji etapu: ${upErr.message}`, 'error')
          return
        }
        const applySta = (o: Order) => {
          if (o.id !== linkedId) return o
          const current = parseProductionStages(o.production_stages, o.category)
          return { ...o, production_stages: { ...current, sta_e5: value } }
        }
        setOrders((prev) => prev.map(applySta))
        setLinkedOrders((prev) => prev.map(applySta))
        return
      }

      let mirrorKey: string | null = null
      if (sourceOrder.category === 'STA') {
        if (stageKey === 'e3') mirrorKey = 'sta_e3'
        else if (stageKey === 'e4') mirrorKey = 'sta_e4'
      } else if (sourceOrder.category === 'Disting') {
        if (stageKey === 'e1') mirrorKey = 'dist_e1'
        else if (stageKey === 'e2_1') mirrorKey = 'dist_e2_1'
        else if (stageKey === 'e2_2') mirrorKey = 'dist_e2_2'
        else if (stageKey === 'e5') mirrorKey = 'dist_e5'
      }
      if (!mirrorKey) return

      const { error: upErr } = await supabase.rpc('update_order_stage', {
        p_order_id: linkedId,
        p_stage_key: mirrorKey,
        p_stage_value: value,
      })
      if (upErr) {
        pushToast(`Błąd synchronizacji etapu: ${upErr.message}`, 'error')
        return
      }
      const applyMirror = (o: Order) => {
        if (o.id !== linkedId) return o
        const current = parseProductionStages(o.production_stages, o.category)
        return { ...o, production_stages: { ...current, [mirrorKey]: value } }
      }
      setOrders((prev) => prev.map(applyMirror))
      setLinkedOrders((prev) => prev.map(applyMirror))
    },
    [pushToast],
  )

  const applyReleaseDateUpdate = useCallback(
    async (orderId: number, value: string | null) => {
      setReleaseDateUpdating(orderId)
      const { error } = await supabase
        .from('orders')
        .update({ release_date: value })
        .eq('id', orderId)
      if (error) {
        pushToast(`Wystąpił błąd: ${error.message}`, 'error')
        setReleaseDateUpdating(null)
        return
      }
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId ? { ...o, release_date: value === null ? null : value } : o,
        ),
      )
      setReleaseDateUpdating(null)
    },
    [pushToast],
  )

  // Ręczny znacznik odbioru ościeżnicy na Marklowickiej (Disting Plus) — niezależny od etapów.
  // Kierownik (Paweł) klika sam, na wypadek błędów komunikacji. Trzymany w extra_fields.osc_received (inicjały).
  const toggleOscReceived = useCallback(
    async (order: Order) => {
      const id = order.id
      if (id == null) return
      const ef = (order.extra_fields as Record<string, unknown>) ?? {}
      const isSet = Boolean(ef.osc_received)
      const initials = (currentUser?.initials ?? '').trim() || 'T'
      const newExtra = {
        ...ef,
        osc_received: isSet ? '' : initials,
        osc_received_at: isSet ? '' : new Date().toISOString(),
      }
      const { error } = await supabase.from('orders').update({ extra_fields: newExtra }).eq('id', id)
      if (error) {
        pushToast(`Wystąpił błąd: ${error.message}`, 'error')
        return
      }
      setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, extra_fields: newExtra } : o)))
    },
    [pushToast, currentUser?.initials],
  )

  const fetchNextOrderNumber = useCallback(
    async (category: string): Promise<string> => {
      touchSession()
      const { data, error } = await supabase
        .from('orders')
        .select('order_number')
        .eq('category', category)
      if (error) {
        console.error(error)
        pushToast(`Nie udało się pobrać numeru zlecenia: ${error.message}`, 'error')
        return '1'
      }
      const numbers = (data ?? [])
        .map((row) => Number(row.order_number))
        .filter((n) => Number.isFinite(n))
      const maxNumber = numbers.length > 0 ? Math.max(...numbers) : 0
      return String(maxNumber + 1)
    },
    [pushToast, touchSession],
  )

  const fetchInternalDoorItemsForVisibleOrders = useCallback(async (visibleOrders: Order[]) => {
    const orderIds = visibleOrders
      .map((order) => order.id)
      .filter((id): id is number => id !== undefined)
    if (orderIds.length === 0) {
      setInternalDoorItems([])
      return
    }
    const { data: itemsData, error: itemsError } = await supabase
      .from('order_internal_door_items')
      .select(
        '*, warehouse_components(name, product_category, door_model, door_size, door_direction, door_color, door_frame_type, door_frame_code, door_handle_shield)',
      )
      .in('order_id', orderIds)
    if (itemsError) {
      console.error(itemsError)
      setInternalDoorItems([])
      return
    }
    const mapped = ((itemsData ?? []) as Array<Record<string, unknown>>).map((row) => {
      const warehouseComponent = row.warehouse_components as
        | {
            name?: string | null
            product_category?: string | null
            door_model?: string | null
            door_size?: string | null
            door_direction?: string | null
            door_color?: string | null
            door_frame_type?: string | null
            door_frame_code?: string | null
            door_handle_shield?: string | null
          }
        | undefined
      return {
        ...(row as unknown as InternalDoorItem),
        component_name: warehouseComponent?.name ?? null,
        component_category: warehouseComponent?.product_category ?? null,
        component_door_model: warehouseComponent?.door_model ?? null,
        component_door_size: warehouseComponent?.door_size ?? null,
        component_door_direction: warehouseComponent?.door_direction ?? null,
        component_door_color: warehouseComponent?.door_color ?? null,
        component_door_frame_type: warehouseComponent?.door_frame_type ?? null,
        component_door_frame_code: warehouseComponent?.door_frame_code ?? null,
        component_door_handle_shield: warehouseComponent?.door_handle_shield ?? null,
      }
    })
    setInternalDoorItems(mapped)
  }, [])

  const fetchOrders = useCallback(async () => {
    touchSession()
    setLoading(true)
    // Snapshot kategorii — chroni przed race przy szybkim przełączaniu zakładek
    const fetchTab = activeTab
    latestFetchTabRef.current = fetchTab
    // Paginacja — pobieramy partiami po 1000 żeby ominąć limit PostgREST
    const allOrders: Order[] = []
    let from = 0
    const PAGE = 1000
    let fetchError = null
    while (true) {
      const { data, error: pageError } = await supabase
        .from('orders')
        .select('*')
        .eq('category', fetchTab)
        .order('id', { ascending: false })
        .range(from, from + PAGE - 1)
      if (pageError) { fetchError = pageError; break }
      if (!data || data.length === 0) break
      allOrders.push(...(data as Order[]))
      if (data.length < PAGE) break
      from += PAGE
    }
    // Jeśli w międzyczasie user przełączył kategorię — porzuć wynik (nie nadpisuj)
    if (latestFetchTabRef.current !== fetchTab) {
      return
    }
    const error = fetchError
    const ordersData = allOrders
    if (error) {
      console.error(error)
    } else {
      const loaded = ordersData as Order[]
      // Sortuj: data malejąco, potem numer zlecenia malejąco (numerycznie)
      loaded.sort((a, b) => {
        const dateA = a.order_date ?? ''
        const dateB = b.order_date ?? ''
        if (dateA !== dateB) return dateB.localeCompare(dateA)
        const numA = parseInt(String(a.order_number ?? '0'), 10) || 0
        const numB = parseInt(String(b.order_number ?? '0'), 10) || 0
        return numB - numA
      })
      setOrders(loaded)

      if (activeTab === 'DrzwiWewnetrzne') {
        await fetchInternalDoorItemsForVisibleOrders(loaded)
      } else {
        setInternalDoorItems([])
      }

      if (activeTab === 'STA') {
        const linkedIds = loaded
          .map((o) => o.linked_order_id)
          .filter((id): id is number => id != null)
        if (linkedIds.length > 0) {
          const { data: linkedData } = await supabase
            .from('orders')
            .select('*')
            .in('id', linkedIds)
          setLinkedOrders((linkedData || []) as Order[])
        } else {
          setLinkedOrders([])
        }
      } else if (activeTab === 'Bastion') {
        // Titan: Bastion potrzebuje statusu rodzeństwa — STA (skrzydło, id = titan_group)
        // oraz ST (ościeżnica, linked_order_id = titan_group). Czytamy ich wydanie.
        const groupIds = Array.from(
          new Set(
            loaded
              .map((o) => Number((o.extra_fields as Record<string, unknown> | null)?.titan_group))
              .filter((n) => Number.isFinite(n) && n > 0),
          ),
        )
        if (groupIds.length > 0) {
          const [staRes, stRes] = await Promise.all([
            supabase.from('orders').select('id, order_number, category, release_date, extra_fields').in('id', groupIds),
            supabase.from('orders').select('id, order_number, category, release_date, linked_order_id, extra_fields').in('linked_order_id', groupIds).eq('category', 'ST'),
          ])
          setLinkedOrders([...((staRes.data || []) as Order[]), ...((stRes.data || []) as Order[])])
        } else {
          setLinkedOrders([])
        }
      } else {
        setLinkedOrders([])
      }
    }
    setLoading(false)
  }, [activeTab, fetchInternalDoorItemsForVisibleOrders, touchSession])

  const markProductionStageWithProfileInitials = useCallback(
    async (orderId: number, stageKey: string) => {
      const initials = (currentUser?.initials ?? '').trim()
      if (!initials) {
        pushToast('Brak inicjałów w profilu. Skontaktuj się z administratorem.', 'error')
        return
      }
      const order = orders.find((o) => o.id === orderId)
      if (!order) return
      await applyProductionStagesUpdate(orderId, stageKey, initials)
      await syncMirrorStagesToLinkedOrder(order, stageKey, initials)
    },
    [currentUser?.initials, orders, applyProductionStagesUpdate, syncMirrorStagesToLinkedOrder, pushToast],
  )

  const handleFormChange = (field: keyof NewOrderFormData, value: string) => {
    if (field === 'quantity') {
      setFormData((prev) => ({ ...prev, quantity: Number(value) || 1 }))
      return
    }
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleCompanySelect = (item: Company) => {
    setHighlightedIndex(-1)
    setFormData((prev) => ({
      ...prev,
      company: item.name,
      production_day: item.production_day || prev.production_day,
    }))
    setShowCompanyDropdown(false)
  }

  const handleStaCompanySelect = (item: Company) => {
    setHighlightedIndex(-1)
    setOrderFormErrors((prev) => prev.filter((e) => e !== 'company'))
    setStaFormData((prev) => ({
      ...prev,
      company: item.name,
      production_day: item.production_day || prev.production_day,
    }))
    setShowCompanyDropdown(false)
  }

  const handleStaFormChange = <K extends keyof StaOrderFormData>(field: K, value: StaOrderFormData[K]) => {
    setStaFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleStFormChange = <K extends keyof StOrderFormData>(field: K, value: StOrderFormData[K]) => {
    setStFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleBastionFormChange = <K extends keyof BastionOrderFormData>(
    field: K,
    value: BastionOrderFormData[K],
  ) => {
    setBastionFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleStCompanySelect = (item: Company) => {
    setHighlightedIndex(-1)
    setOrderFormErrors((prev) => prev.filter((e) => e !== 'company'))
    setStFormData((prev) => ({
      ...prev,
      company: item.name,
      production_day: item.production_day || prev.production_day,
    }))
    setShowCompanyDropdown(false)
  }

  const handleBastionCompanySelect = (item: Company) => {
    setHighlightedIndex(-1)
    setOrderFormErrors((prev) => prev.filter((e) => e !== 'company'))
    setBastionFormData((prev) => ({
      ...prev,
      company: item.name,
      production_day: item.production_day || prev.production_day,
    }))
    setShowCompanyDropdown(false)
  }

  const handleTechniczneFormChange = <K extends keyof TechniczneOrderFormData>(
    field: K,
    value: TechniczneOrderFormData[K],
  ) => {
    setTechniczneFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleTechniczneCompanySelect = (item: Company) => {
    setHighlightedIndex(-1)
    setOrderFormErrors((prev) => prev.filter((e) => e !== 'company'))
    setTechniczneFormData((prev) => ({
      ...prev,
      company: item.name,
      production_day: item.production_day || prev.production_day,
    }))
    setShowCompanyDropdown(false)
  }

  const handleCompanyAutocompleteKeyDown = useCallback(
    (suggestions: Company[], onSelect: (item: Company) => void) =>
      (e: ReactKeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown') {
          if (suggestions.length === 0) return
          e.preventDefault()
          setHighlightedIndex((prev) => Math.min(prev + 1, suggestions.length - 1))
          return
        }
        if (e.key === 'ArrowUp') {
          if (suggestions.length === 0) return
          e.preventDefault()
          setHighlightedIndex((prev) => Math.max(prev - 1, -1))
          return
        }
        if (e.key === 'Escape') {
          setShowCompanyDropdown(false)
          setHighlightedIndex(-1)
          return
        }
        if (e.key === 'Enter') {
          // Zawsze zatrzymaj Enter w polu firmy — nie pozwól na przedwczesny zapis formularza
          e.preventDefault()
          e.stopPropagation()
          if (suggestions.length === 0) return
          const pickIndex =
            highlightedIndex >= 0 ? Math.min(highlightedIndex, suggestions.length - 1) : 0
          onSelect(suggestions[pickIndex])
          setHighlightedIndex(-1)
        }
      },
    [highlightedIndex, setHighlightedIndex, setShowCompanyDropdown],
  )

  const filteredCompanies = (() => {
    const query = formData.company.trim().toLowerCase()
    if (query.length < 2) return []
    return companies.filter((item) => item.name.toLowerCase().includes(query)).slice(0, 10)
  })()

  const filteredStaCompanies = (() => {
    const query = staFormData.company.trim().toLowerCase()
    if (query.length < 2) return []
    return companies.filter((item) => item.name.toLowerCase().includes(query)).slice(0, 10)
  })()

  const filteredStCompanies = (() => {
    const query = stFormData.company.trim().toLowerCase()
    if (query.length < 2) return []
    return companies.filter((item) => item.name.toLowerCase().includes(query)).slice(0, 10)
  })()

  const filteredBastionCompanies = (() => {
    const query = bastionFormData.company.trim().toLowerCase()
    if (query.length < 2) return []
    return companies.filter((item) => item.name.toLowerCase().includes(query)).slice(0, 10)
  })()

  const filteredTechniczneCompanies = (() => {
    const query = techniczneFormData.company.trim().toLowerCase()
    if (query.length < 2) return []
    return companies.filter((item) => item.name.toLowerCase().includes(query)).slice(0, 10)
  })()

  const sendGlassOrderWebhook = useCallback(
    async (order: Order) => {
      const topAllowance = getGlassAllowance(glassAllowances, order.category, 'top_light')
      const sideAllowance = getGlassAllowance(glassAllowances, order.category, 'side_panel')
      const top = splitWxH(order.top_light)
      const sideA = splitWxH(order.side_panel_a || order.side_panel)
      const sideB = splitWxH(order.side_panel_b || '')
      const topGlassDim = calcGlassDim(
        Number(top.w) || 0,
        Number(top.h) || 0,
        topAllowance.w,
        topAllowance.h,
      )
      const sideAGlassDim = calcGlassDim(
        Number(sideA.w) || 0,
        Number(sideA.h) || 0,
        sideAllowance.w,
        sideAllowance.h,
      )
      const sideBGlassDim = calcGlassDim(
        Number(sideB.w) || 0,
        Number(sideB.h) || 0,
        sideAllowance.w,
        sideAllowance.h,
      )
      if (order.id === undefined) {
        pushToast('Błąd: brak identyfikatora zamówienia', 'error')
        return
      }

      const payload = {
        order_number: order.order_number,
        company: order.company,
        production_day: order.production_day,
        system: order.system,
        model: order.model,
        wing_color: order.wing_color,
        frame_color: order.frame_color,
        threshold_color: order.threshold_color,
        width: order.width,
        direction: order.direction,
        height: order.height,
        opening: order.opening,
        glazing: order.glazing,
        decorative_panel: order.decorative_panel,
        top_light: order.top_light,
        top_light_glazing: order.top_light_glazing,
        // Obliczone wymiary szyb z naddatkami (do zamówienia u dostawcy szkła)
        top_light_glass_dim: topGlassDim,
        side_panel_a_glass_dim: sideAGlassDim,
        side_panel_b_glass_dim: sideBGlassDim,
        side_panel_a: order.side_panel_a || order.side_panel,
        side_panel_b: order.side_panel_b,
        side_panel_a_glazing: order.side_panel_a_glazing || order.side_panel_glazing,
        side_panel_b_glazing: order.side_panel_b_glazing,
        peephole: order.peephole,
        hardware: order.hardware,
        handle: order.handle,
        electric_strike: order.electric_strike,
        oslonki: order.oslonki,
        quantity: order.quantity,
        notes: order.notes,
        client_order_number: order.client_order_number,
      }

      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000)
        const response = await fetch('https://hook.eu2.make.com/tzy1k1wrzpkbwv32sa57sprtkv5vnogx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        clearTimeout(timeoutId)
        if (response.ok) {
          const today = new Date().toISOString().split('T')[0]
          await supabase.from('orders').update({ glass_order_date: today }).eq('id', order.id)
          setOrders((prev) =>
            prev.map((o) => (o.id === order.id ? { ...o, glass_order_date: today } : o)),
          )
          pushToast('Zamówienie szyby wysłane', 'success')
        } else {
          pushToast('Błąd wysyłania zamówienia szyby', 'error')
        }
      } catch (error) {
        console.error(error)
        const isTimeout = error instanceof Error && error.name === 'AbortError'
        pushToast(isTimeout ? 'Przekroczono czas połączenia z Make.com (10s)' : 'Błąd połączenia z Make.com', 'error')
      }
    },
    [pushToast, glassAllowances],
  )

  // #23 — Disting Plus (STA↔Disting) oraz Titan (STA↔ST): edycja jednego rekordu
  // przenosi wspólne pola produktowe na powiązany rekord (kolor, wymiar, model itd.).
  // NIE rusza pól strukturalnych: numer, kategoria, linki, arkusze, etapy, wydanie, extra_fields.
  const SHARED_LINKED_FIELDS = [
    'company', 'production_day', 'quantity', 'system', 'model',
    'wing_color', 'frame_color', 'threshold_color', 'width', 'direction', 'opening', 'height',
    'glazing', 'decorative_panel', 'hardware', 'handle', 'peephole',
    'top_light', 'top_light_glazing',
    'side_panel', 'side_panel_glazing', 'side_panel_a', 'side_panel_b',
    'side_panel_a_glazing', 'side_panel_b_glazing',
    'extension', 'extension_a_dim', 'extension_b_dim', 'extension_top_dim', 'extension_qtys',
    'notes', 'client_order_number', 'oslonki', 'zaczep',
  ] as const

  const syncSharedFieldsToLinkedPartner = async (
    baseline: Order,
    mapped: Record<string, unknown>,
  ): Promise<void> => {
    const partnerId = baseline.linked_order_id
    if (partnerId == null) return
    const partnerPayload: Record<string, unknown> = {}
    for (const k of SHARED_LINKED_FIELDS) {
      if (k in mapped && mapped[k] !== undefined) partnerPayload[k] = mapped[k]
    }
    if (Object.keys(partnerPayload).length === 0) return
    const { error } = await supabase.from('orders').update(partnerPayload).eq('id', partnerId)
    if (error) {
      pushToast(`Powiązany rekord nie zsynchronizowany: ${error.message}`, 'error')
      return
    }
    setOrders((prev) => prev.map((o) => (o.id === partnerId ? ({ ...o, ...partnerPayload } as Order) : o)))
  }

  const handleSaveOrderImpl = async () => {
    setIsSaving(true)

    const isEditing = editingOrderId !== null && editingOrderBaseline !== null
    if (isEditing && !isManager) {
      pushToast('Brak uprawnień do edycji zamówień', 'error')
      setIsSaving(false)
      return
    }
    const editId = editingOrderId!

    if (activeTab === 'STA' || activeTab === 'Disting') {
      const errors = validateOrderForm(activeTab, {
        company: staFormData.company,
        system: staFormData.system,
        model: staFormData.model,
        wing_color: staFormData.wing_color,
        frame_color: staFormData.frame_color,
        threshold_color: staFormData.threshold_color,
        width: staFormData.width,
        direction: staFormData.direction,
        opening: staFormData.opening,
        height: staFormData.height,
        glazing: staFormData.glazing,
        hardware: staFormData.hardware,
        handle: staFormData.handle,
      })
      if (errors.length > 0) {
        setOrderFormErrors(errors)
        pushToast('Uzupełnij wszystkie wymagane pola', 'error')
        setIsSaving(false)
        return
      }
      setOrderFormErrors([])

      const topLight =
        staFormData.top_light_h_mm.trim()
          ? `${staFormData.top_light_w_mm.trim()}×${staFormData.top_light_h_mm.trim()}`
          : ''
      const sidePanelA =
        staFormData.side_panel_a_w_mm.trim()
          ? `${staFormData.side_panel_a_w_mm.trim()}×${staFormData.side_panel_h_mm.trim()}`
          : ''
      const sidePanelB =
        staFormData.side_panel_b_w_mm.trim()
          ? `${staFormData.side_panel_b_w_mm.trim()}×${staFormData.side_panel_h_mm.trim()}`
          : ''
      const { sideDim, topDim } = calcExtensionDims(
        staFormData.width,
        staFormData.height,
        activeTab,
        dimensionMap,
      )
      const profileWidth = getProfileWidth(extensionProfileWidths, activeTab)
      void profileWidth

      const buildExtLabel = (side: string) => {
        const sideQtys = staFormData.extension_qtys[side] ?? {}
        return Object.entries(sideQtys)
          .filter(([, qty]) => qty > 0)
          .map(([w, qty]) => `${qty}×${w}mm`)
          .join('+')
      }

      const extALabel = buildExtLabel('a')
      const extBLabel = buildExtLabel('b')
      const extTopLabel = buildExtLabel('top')

      const mapped = {
        order_number: staFormData.order_number,
        company: staFormData.company,
        order_date: isEditing
          ? editingOrderBaseline.order_date
          : new Date().toISOString().split('T')[0],
        production_day: staFormData.production_day,
        quantity: staFormData.quantity,
        sequence: isEditing ? editingOrderBaseline.sequence : '',
        system: staFormData.system,
        model: staFormData.model,
        wing_color: staFormData.wing_color,
        frame_color: staFormData.frame_color,
        threshold_color: staFormData.threshold_color,
        width: staFormData.width,
        direction: staFormData.direction,
        opening: staFormData.opening,
        height: staFormData.height,
        glazing: staFormData.glazing,
        decorative_panel: staFormData.decorative_panel,
        hardware: staFormData.hardware,
        handle: staFormData.handle,
        peephole: staFormData.peephole,
        top_light: topLight,
        top_light_glazing: staFormData.top_light_glazing,
        side_panel: sidePanelA,
        side_panel_glazing: staFormData.side_panel_a_glazing,
        side_panel_a: sidePanelA,
        side_panel_b: sidePanelB,
        side_panel_a_glazing: staFormData.side_panel_a_glazing,
        side_panel_b_glazing: staFormData.side_panel_b_glazing,
        extension_qtys: staFormData.extension_qtys,
        extension_a_dim: isExtSideActive(staFormData.extension_qtys, 'a') ? sideDim : '',
        extension_b_dim: isExtSideActive(staFormData.extension_qtys, 'b') ? sideDim : '',
        extension_top_dim: isExtSideActive(staFormData.extension_qtys, 'top') ? topDim : '',
        extension:
          [
            extALabel ? `A:${extALabel}(${sideDim}mm)` : '',
            extBLabel ? `B:${extBLabel}(${sideDim}mm)` : '',
            extTopLabel ? `G:${extTopLabel}(${topDim}mm)` : '',
          ]
            .filter(Boolean)
            .join(' / ') || '',
        notes: staFormData.notes,
        client_order_number: staFormData.client_order_number,
        category: staFormData.category || activeTab,
        oslonki: staFormData.oslonki,
        zaczep: staFormData.zaczep,
        extra_fields: mergeOrderExtraFields(
          isEditing ? editingOrderBaseline.extra_fields : null,
          { wykonawca: staFormData.wykonawca || '' },
        ),
        production_stages: productionStagesFromLegacyStageFormFields(
          activeTab,
          {
            stage1: staFormData.stage1,
            stage2_1: staFormData.stage2_1,
            stage2_2: staFormData.stage2_2,
            stage3: staFormData.stage3,
            stage4: staFormData.stage4,
            stage5: staFormData.stage5,
          },
          isEditing
            ? parseProductionStages(
                editingOrderBaseline.production_stages,
                editingOrderBaseline.category,
              )
            : null,
        ),
      }

      if (isEditing) {
        const payload = sanitizeOrderPayloadForDb({
          ...orderMetaForUpdate(editingOrderBaseline),
          ...mapped,
        })
        const { error } = await supabase.from('orders').update(payload).eq('id', editId)
        if (error) {
          pushToast(`Wystąpił błąd: ${error.message}`, 'error')
          setIsSaving(false)
          return
        }
        const merged = { ...editingOrderBaseline, ...payload } as Order
        setOrders((prev) => prev.map((o) => (o.id === editId ? merged : o)))
        await syncSharedFieldsToLinkedPartner(editingOrderBaseline, mapped)
        await syncWarehouseStockAfterOrderEdit(editId, editingOrderBaseline, mapped)
        if (isBotOrder(editingOrderBaseline)) {
          await supabase.rpc('revalidate_bot_order', { p_order_id: editId })
          await fetchOrdersNeedingReview()
          const nextCategory = String(mapped.category ?? activeTab)
          pushToast(`Zamówienie przeniesione do ${nextCategory}`, 'info')
          if ((EDITABLE_CATEGORIES as readonly string[]).includes(nextCategory)) {
            setActiveTab(nextCategory as (typeof TABS)[number])
          }
        }
        pushToast('Zamówienie zaktualizowane', 'success')
        setIsModalOpen(false)
        setEditingOrderId(null)
        setEditingOrderBaseline(null)
        setStaFormData(INITIAL_STA_ORDER_FORM)
        setIsSaving(false)
        return
      }

      const payload = sanitizeOrderPayloadForDb({
        ...emptyOrderMeta,
        ...mapped,
      })

      // ── STA TITAN (CORE/GUARD) → trójka rekordów ────────────────────────────
      // Skrzydło frezowane = STA (bazowy), ościeżnica = ST, skrzydło okuwane = Bastion.
      // MVP: trzy rekordy, każdy w swojej zakładce. Grupę trzymamy w extra_fields.titan_group.
      // STA↔ST łączymy też przez linked_order_id (istniejące wyświetlanie pary). Mirror — później.
      const isStaTitanNew = activeTab === 'STA' && isTitanSystem(staFormData.system)
      if (isStaTitanNew) {
        // 1) STA bazowy
        const { data: staRow, error: staErr } = await supabase
          .from('orders').insert([payload]).select('id, order_number').single()
        if (staErr || !staRow) {
          pushToast(`Wystąpił błąd: ${staErr?.message ?? 'brak danych'}`, 'error')
          setIsSaving(false)
          return
        }
        const staId = Number((staRow as { id: number }).id)
        const staNr = String((staRow as { order_number: string }).order_number ?? '')
        const group = staId
        const groupExtra = (cat: string) =>
          mergeOrderExtraFields(payload.extra_fields, { titan_group: group, titan_role: cat })

        // 2) ST (ościeżnica)
        const stNrNext = await fetchNextOrderNumber('ST')
        const stPayload = sanitizeOrderPayloadForDb({
          ...emptyOrderMeta, ...mapped,
          order_number: stNrNext,
          category: 'ST' as const,
          linked_order_id: staId,
          sta_ref: staNr,
          st_sheet: '',
          production_stages: createEmptyProductionStages('ST'),
          extra_fields: groupExtra('ST'),
        })
        const { data: stRow, error: stErr } = await supabase
          .from('orders').insert([stPayload]).select('id, order_number').single()
        if (stErr || !stRow) {
          await supabase.from('orders').delete().eq('id', staId)
          pushToast(`Nie udało się utworzyć powiązanego ST: ${stErr?.message ?? 'błąd'}`, 'error')
          setIsSaving(false)
          return
        }
        const stId = Number((stRow as { id: number }).id)
        const stNr = String((stRow as { order_number: string }).order_number ?? '')

        // 3) Bastion (skrzydło do okuwania)
        const bastionNrNext = await fetchNextOrderNumber('Bastion')
        const bastionPayload = sanitizeOrderPayloadForDb({
          ...emptyOrderMeta, ...mapped,
          order_number: bastionNrNext,
          category: 'Bastion' as const,
          linked_order_id: null,
          production_stages: createEmptyProductionStages('Bastion'),
          extra_fields: groupExtra('Bastion'),
        })
        const { error: bastionErr } = await supabase.from('orders').insert([bastionPayload])
        if (bastionErr) {
          pushToast(`ST i STA zapisane, ale Bastion nie: ${bastionErr.message}`, 'error')
        }

        // 4) Dopnij linki na STA (partner ST + grupa)
        const { error: linkErr } = await supabase
          .from('orders')
          .update({ linked_order_id: stId, st_sheet: stNr, extra_fields: groupExtra('STA') })
          .eq('id', staId)
        if (linkErr) pushToast(`Powiązanie STA↔ST nie zapisane: ${linkErr.message}`, 'error')

        await consumeStockForOrderWithToasts(staId)
        await consumeStockForOrderWithToasts(stId)

        pushToast(`Utworzono Titan: STA ${staNr} + ST ${stNr} + Bastion ${bastionNrNext}`, 'success')
        setIsModalOpen(false)
        setStaFormData(INITIAL_STA_ORDER_FORM)
        await fetchOrders()
        setIsSaving(false)
        return
      }

      // Normalizujemy porównanie — wartość systemu pochodzi ze słownika konfiguracji
      // i drobny rozjazd (spacja/wielkość liter) nie może po cichu zerwać parowania.
      const isDistingPlusPair =
        activeTab === 'Disting' &&
        staFormData.system.trim().toUpperCase().replace(/\s+/g, ' ') === 'DISTING PLUS'

      if (isDistingPlusPair) {
        const distNrNext = await fetchNextOrderNumber('Disting')
        const staNrNext = await fetchNextOrderNumber('STA')
        const distMapped = { ...mapped, order_number: distNrNext }
        const distPayload = sanitizeOrderPayloadForDb({ ...emptyOrderMeta, ...distMapped })

        const { data: distRow, error: distErr } = await supabase
          .from('orders')
          .insert([distPayload])
          .select('*')
          .single()

        if (distErr || !distRow) {
          pushToast(`Wystąpił błąd: ${distErr?.message ?? 'brak danych'}`, 'error')
          setIsSaving(false)
          return
        }

        const distId = Number((distRow as { id: number }).id)
        const distNr = String((distRow as { order_number: string }).order_number ?? '')

        const staMapped = {
          ...mapped,
          order_number: staNrNext,
          category: 'STA' as const,
          disting_sheet: distNr,
          linked_order_id: distId,
          production_stages: createEmptyProductionStages('STA'),
        }
        const staPayload = sanitizeOrderPayloadForDb({ ...emptyOrderMeta, ...staMapped })

        const { data: staRow, error: staErr } = await supabase
          .from('orders')
          .insert([staPayload])
          .select('*')
          .single()

        if (staErr || !staRow) {
          await supabase.from('orders').delete().eq('id', distId)
          pushToast(
            `Zamówienie Disting zapisano, ale utworzenie STA nie powiodło się: ${staErr?.message ?? 'błąd'}`,
            'error',
          )
          setIsSaving(false)
          return
        }

        const staId = Number((staRow as { id: number }).id)
        const staNr = String((staRow as { order_number: string }).order_number ?? '')

        const hasDistGlass = !!(distMapped.top_light || distMapped.side_panel_a || distMapped.side_panel_b)
        if (hasDistGlass && distRow) {
          void sendGlassOrderWebhook(distRow as Order)
        }
        const hasStaGlass = !!(staMapped.top_light || staMapped.side_panel_a || staMapped.side_panel_b)
        if (hasStaGlass && staRow) {
          void sendGlassOrderWebhook(staRow as Order)
        }

        const { error: linkErr } = await supabase
          .from('orders')
          .update({ linked_order_id: staId, sta_sheet: staNr })
          .eq('id', distId)

        if (linkErr) {
          pushToast(`Powiązanie zamówień nie zostało zapisane: ${linkErr.message}`, 'error')
        }

        await consumeStockForOrderWithToasts(distId)
        await consumeStockForOrderWithToasts(staId)

        pushToast(`Utworzono powiązane zamówienie w STA nr ${staNr}`, 'success')
        setIsModalOpen(false)
        setStaFormData(INITIAL_STA_ORDER_FORM)
        await fetchOrders()
        setIsSaving(false)
        return
      }

      const { data: savedOrder, error } = await supabase
        .from('orders')
        .insert([payload])
        .select('*')
        .single()

      if (error) {
        pushToast(`Wystąpił błąd: ${error.message}`, 'error')
        setIsSaving(false)
        return
      }

      pushToast('Zamówienie dodane', 'success')

      const savedId = (savedOrder as Order).id
      await consumeStockForOrderWithToasts(savedId!)

      const hasRealDim = (val: string | null | undefined) => {
        if (!val) return false
        const parts = val.split('×')
        return parts[0]?.trim() !== '' || parts[1]?.trim() !== ''
      }

      const hasGlass =
        hasRealDim(mapped.top_light) ||
        hasRealDim(mapped.side_panel_a) ||
        hasRealDim(mapped.side_panel_b)
      if (hasGlass && savedOrder) {
        void sendGlassOrderWebhook(savedOrder as Order)
      }

      setIsModalOpen(false)
      setStaFormData(INITIAL_STA_ORDER_FORM)
      await fetchOrders()
      setIsSaving(false)
      return
    }

    if (activeTab === 'ST') {
      const errors = validateOrderForm('ST', {
        company: stFormData.company,
        system: stFormData.system,
        model: stFormData.model,
        wing_color: stFormData.wing_color,
        frame_color: '',
        threshold_color: stFormData.threshold_color,
        width: stFormData.width,
        direction: stFormData.direction,
        opening: stFormData.opening,
        height: stFormData.height,
        glazing: stFormData.glazing,
        hardware: stFormData.hardware,
        handle: stFormData.handle,
      })
      if (errors.length > 0) {
        setOrderFormErrors(errors)
        pushToast('Uzupełnij wszystkie wymagane pola', 'error')
        setIsSaving(false)
        return
      }
      setOrderFormErrors([])

      const isTitanNew = !isEditing && isStTitanSystemLabel(stFormData.system)
      const mapped = {
        order_number: stFormData.order_number,
        company: stFormData.company,
        order_date: isEditing
          ? editingOrderBaseline.order_date
          : new Date().toISOString().split('T')[0],
        production_day: stFormData.production_day,
        quantity: stFormData.quantity,
        sequence: isEditing ? editingOrderBaseline.sequence : '',
        system: stFormData.system,
        model: stFormData.model,
        wing_color: stFormData.wing_color,
        frame_color: '',
        threshold_color: stFormData.threshold_color,
        width: stFormData.width,
        direction: stFormData.direction,
        opening: stFormData.opening,
        height: stFormData.height,
        glazing: stFormData.glazing,
        decorative_panel: '',
        hardware: stFormData.hardware,
        handle: stFormData.handle,
        peephole: stFormData.peephole,
        top_light: '',
        top_light_glazing: '',
        side_panel: '',
        side_panel_glazing: '',
        extension: stFormData.extension,
        notes: stFormData.notes,
        client_order_number: stFormData.client_order_number,
        category: stFormData.category || 'ST',
        linked_order_id: isEditing ? editingOrderBaseline.linked_order_id ?? null : null,
        sta_ref: isEditing ? String(editingOrderBaseline.sta_ref ?? '').trim() : '',
        st_sheet: isEditing ? String(editingOrderBaseline.st_sheet ?? '').trim() : '',
        production_stages: isEditing
          ? editingOrderBaseline.production_stages
          : createEmptyProductionStages('ST'),
      }

      if (isEditing) {
        const payload = sanitizeOrderPayloadForDb({
          ...orderMetaForUpdate(editingOrderBaseline),
          ...mapped,
        })
        const { error } = await supabase.from('orders').update(payload).eq('id', editId)
        if (error) {
          pushToast(`Wystąpił błąd: ${error.message}`, 'error')
          setIsSaving(false)
          return
        }
        const merged = { ...editingOrderBaseline, ...payload } as Order
        setOrders((prev) => prev.map((o) => (o.id === editId ? merged : o)))
        await syncSharedFieldsToLinkedPartner(editingOrderBaseline, mapped)
        await syncWarehouseStockAfterOrderEdit(editId, editingOrderBaseline, mapped)
        if (isBotOrder(editingOrderBaseline)) {
          await supabase.rpc('revalidate_bot_order', { p_order_id: editId })
          await fetchOrdersNeedingReview()
          const nextCategory = String(mapped.category ?? activeTab)
          pushToast(`Zamówienie przeniesione do ${nextCategory}`, 'info')
          if ((EDITABLE_CATEGORIES as readonly string[]).includes(nextCategory)) {
            setActiveTab(nextCategory as (typeof TABS)[number])
          }
        }
        pushToast('Zamówienie zaktualizowane', 'success')
        setIsModalOpen(false)
        setEditingOrderId(null)
        setEditingOrderBaseline(null)
        setStFormData(INITIAL_ST_ORDER_FORM)
        setIsSaving(false)
        return
      }

      if (isTitanNew) {
        const staNrNext = await fetchNextOrderNumber('STA')
        const stInsertPayload = sanitizeOrderPayloadForDb({
          ...emptyOrderMeta,
          ...mapped,
          linked_order_id: null,
          sta_ref: '',
          st_sheet: '',
        })
        const { data: stRow, error: stErr } = await supabase
          .from('orders')
          .insert([stInsertPayload])
          .select('id, order_number')
          .single()

        if (stErr || !stRow) {
          pushToast(`Wystąpił błąd: ${stErr?.message ?? 'brak danych'}`, 'error')
          setIsSaving(false)
          return
        }
        const stId = Number((stRow as { id: number }).id)
        const stNr = String((stRow as { order_number: string }).order_number ?? '')

        const staMapped = sanitizeOrderPayloadForDb({
          ...emptyOrderMeta,
          ...mapped,
          order_number: staNrNext,
          category: 'STA' as const,
          frame_color: '',
          decorative_panel: '',
          top_light: '',
          top_light_glazing: '',
          side_panel: '',
          side_panel_glazing: '',
          extension: '',
          electric_strike: '',
          oslonki: '',
          zaczep: '',
          linked_order_id: stId,
          st_sheet: stNr,
          disting_sheet: '',
          sta_sheet: '',
          production_stages: createEmptyProductionStages('STA'),
        })

        const { data: staRow, error: staErr } = await supabase
          .from('orders')
          .insert([staMapped])
          .select('id, order_number')
          .single()

        if (staErr || !staRow) {
          await supabase.from('orders').delete().eq('id', stId)
          pushToast(
            `Zapisano ST, lecz utworzenie powiązanej STA nie powiodło się: ${staErr?.message ?? 'błąd'}`,
            'error',
          )
          setIsSaving(false)
          return
        }
        const staId = Number((staRow as { id: number }).id)
        const staNr = String((staRow as { order_number: string }).order_number ?? '')

        const { error: linkErr } = await supabase
          .from('orders')
          .update({ linked_order_id: staId, sta_ref: staNr })
          .eq('id', stId)

        if (linkErr) {
          pushToast(`Powiązanie ST↔STA nie zostało zapisane: ${linkErr.message}`, 'error')
        }

        await consumeStockForOrderWithToasts(stId)
        await consumeStockForOrderWithToasts(staId)

        pushToast(`Utworzono ST nr ${stNr} oraz powiązaną STA nr ${staNr}`, 'success')
        setIsModalOpen(false)
        setStFormData(INITIAL_ST_ORDER_FORM)
        await fetchOrders()
        setIsSaving(false)
        return
      }

      const payload = sanitizeOrderPayloadForDb({ ...emptyOrderMeta, ...mapped })
      const { data: stInserted, error } = await supabase.from('orders').insert([payload]).select('id').single()

      if (error) {
        pushToast(`Wystąpił błąd: ${error.message}`, 'error')
        setIsSaving(false)
        return
      }

      await consumeStockForOrderWithToasts(Number((stInserted as { id: number }).id))

      setIsModalOpen(false)
      setStFormData(INITIAL_ST_ORDER_FORM)
      await fetchOrders()
      setIsSaving(false)
      return
    }

    if (activeTab === 'Techniczne') {
      const errors = validateOrderForm('Techniczne', {
        company: techniczneFormData.company,
        system: techniczneFormData.system,
        model: techniczneFormData.model,
        wing_color: techniczneFormData.wing_color,
        frame_color: '',
        threshold_color: techniczneFormData.threshold_color,
        width: techniczneFormData.width,
        direction: techniczneFormData.direction,
        opening: techniczneFormData.opening,
        height: techniczneFormData.height,
        glazing: techniczneFormData.glazing,
        hardware: techniczneFormData.hardware,
        handle: techniczneFormData.handle,
      })
      if (errors.length > 0) {
        setOrderFormErrors(errors)
        pushToast('Uzupełnij wszystkie wymagane pola', 'error')
        setIsSaving(false)
        return
      }
      setOrderFormErrors([])

      const mapped = {
        order_number: techniczneFormData.order_number,
        company: techniczneFormData.company,
        order_date: isEditing
          ? editingOrderBaseline.order_date
          : new Date().toISOString().split('T')[0],
        production_day: techniczneFormData.production_day,
        quantity: techniczneFormData.quantity,
        sequence: isEditing ? editingOrderBaseline.sequence : '',
        system: techniczneFormData.system,
        model: techniczneFormData.model,
        wing_color: techniczneFormData.wing_color,
        frame_color: '',
        threshold_color: techniczneFormData.threshold_color,
        width: techniczneFormData.width,
        direction: techniczneFormData.direction,
        opening: techniczneFormData.opening,
        height: techniczneFormData.height,
        glazing: techniczneFormData.glazing,
        decorative_panel: '',
        hardware: techniczneFormData.hardware,
        handle: techniczneFormData.handle,
        peephole: techniczneFormData.peephole,
        top_light: '',
        top_light_glazing: '',
        side_panel: '',
        side_panel_glazing: '',
        extension: '',
        notes: techniczneFormData.notes,
        client_order_number: techniczneFormData.client_order_number,
        info: '',
        category: techniczneFormData.category || 'Techniczne',
        production_stages: createEmptyProductionStages('Techniczne'),
      }

      if (isEditing) {
        const payload = sanitizeOrderPayloadForDb({
          ...orderMetaForUpdate(editingOrderBaseline),
          ...mapped,
        })
        const { error } = await supabase.from('orders').update(payload).eq('id', editId)
        if (error) {
          pushToast(`Wystąpił błąd: ${error.message}`, 'error')
          setIsSaving(false)
          return
        }
        const merged = { ...editingOrderBaseline, ...payload } as Order
        setOrders((prev) => prev.map((o) => (o.id === editId ? merged : o)))
        await syncSharedFieldsToLinkedPartner(editingOrderBaseline, mapped)
        await syncWarehouseStockAfterOrderEdit(editId, editingOrderBaseline, mapped)
        if (isBotOrder(editingOrderBaseline)) {
          await supabase.rpc('revalidate_bot_order', { p_order_id: editId })
          await fetchOrdersNeedingReview()
          const nextCategory = String(mapped.category ?? activeTab)
          pushToast(`Zamówienie przeniesione do ${nextCategory}`, 'info')
          if ((EDITABLE_CATEGORIES as readonly string[]).includes(nextCategory)) {
            setActiveTab(nextCategory as (typeof TABS)[number])
          }
        }
        pushToast('Zamówienie zaktualizowane', 'success')
        setIsModalOpen(false)
        setEditingOrderId(null)
        setEditingOrderBaseline(null)
        setTechniczneFormData(INITIAL_TECHNICZNE_ORDER_FORM)
        setIsSaving(false)
        return
      }

      const payload = sanitizeOrderPayloadForDb({ ...emptyOrderMeta, ...mapped })
      const { data: techInserted, error } = await supabase.from('orders').insert([payload]).select('id').single()

      if (error) {
        pushToast(`Wystąpił błąd: ${error.message}`, 'error')
        setIsSaving(false)
        return
      }

      await consumeStockForOrderWithToasts(Number((techInserted as { id: number }).id))

      setIsModalOpen(false)
      setTechniczneFormData(INITIAL_TECHNICZNE_ORDER_FORM)
      await fetchOrders()
      setIsSaving(false)
      return
    }

    if (activeTab === 'Bastion') {
      const errors = validateOrderForm('Bastion', {
        company: bastionFormData.company,
        system: bastionFormData.system,
        model: bastionFormData.model,
        wing_color: bastionFormData.wing_color,
        frame_color: bastionFormData.frame_color,
        threshold_color: bastionFormData.threshold_color,
        width: bastionFormData.width,
        direction: bastionFormData.direction,
        opening: bastionFormData.opening,
        height: bastionFormData.height,
        glazing: bastionFormData.glazing,
        hardware: bastionFormData.hardware,
        handle: 'ok',
      })
      if (errors.length > 0) {
        setOrderFormErrors(errors)
        pushToast('Uzupełnij wszystkie wymagane pola', 'error')
        setIsSaving(false)
        return
      }
      setOrderFormErrors([])

      const mapped = {
        order_number: bastionFormData.order_number,
        company: bastionFormData.company,
        order_date: isEditing
          ? editingOrderBaseline.order_date
          : new Date().toISOString().split('T')[0],
        production_day: bastionFormData.production_day,
        quantity: bastionFormData.quantity,
        sequence: isEditing ? editingOrderBaseline.sequence : '',
        system: bastionFormData.system,
        model: bastionFormData.model,
        wing_color: bastionFormData.wing_color,
        frame_color: bastionFormData.frame_color,
        threshold_color: bastionFormData.threshold_color,
        width: bastionFormData.width,
        direction: bastionFormData.direction,
        opening: bastionFormData.opening,
        height: bastionFormData.height,
        glazing: bastionFormData.glazing,
        decorative_panel: bastionFormData.frame_type,
        hardware: bastionFormData.hardware,
        handle: '',
        peephole: bastionFormData.peephole,
        top_light: '',
        top_light_glazing: '',
        side_panel: '',
        side_panel_glazing: '',
        extension: bastionFormData.frame_range,
        notes: bastionFormData.notes,
        client_order_number: bastionFormData.client_order_number,
        info: bastionFormData.notes_2,
        bastion_collection: bastionFormData.collection,
        bastion_frame_type: bastionFormData.frame_type,
        bastion_frame_range: bastionFormData.frame_range,
        bastion_sales_changes: bastionFormData.sales_changes,
        bastion_rush_date: bastionFormData.rush_date,
        bastion_day_of_week: bastionFormData.day_of_week,
        bastion_is_promo: bastionFormData.is_promo,
        bastion_is_production_rush: bastionFormData.is_production_rush,
        bastion_production_priority: bastionFormData.production_priority,
        bastion_label_qty: bastionFormData.label_qty,
        bastion_notes_2: bastionFormData.notes_2,
        category: bastionFormData.category || 'Bastion',
        production_stages: isEditing
          ? editingOrderBaseline.production_stages
          : createEmptyProductionStages('Bastion'),
      }

      if (isEditing) {
        const payload = sanitizeOrderPayloadForDb({
          ...orderMetaForUpdate(editingOrderBaseline),
          ...mapped,
        })
        const { error } = await supabase.from('orders').update(payload).eq('id', editId)
        if (error) {
          pushToast(`Wystąpił błąd: ${error.message}`, 'error')
          setIsSaving(false)
          return
        }
        const merged = { ...editingOrderBaseline, ...payload } as Order
        setOrders((prev) => prev.map((o) => (o.id === editId ? merged : o)))
        await syncSharedFieldsToLinkedPartner(editingOrderBaseline, mapped)
        await syncWarehouseStockAfterOrderEdit(editId, editingOrderBaseline, mapped)
        if (isBotOrder(editingOrderBaseline)) {
          await supabase.rpc('revalidate_bot_order', { p_order_id: editId })
          await fetchOrdersNeedingReview()
          const nextCategory = String(mapped.category ?? activeTab)
          pushToast(`Zamówienie przeniesione do ${nextCategory}`, 'info')
          if ((EDITABLE_CATEGORIES as readonly string[]).includes(nextCategory)) {
            setActiveTab(nextCategory as (typeof TABS)[number])
          }
        }
        pushToast('Zamówienie zaktualizowane', 'success')
        setIsModalOpen(false)
        setEditingOrderId(null)
        setEditingOrderBaseline(null)
        setBastionFormData(INITIAL_BASTION_ORDER_FORM)
        setIsSaving(false)
        return
      }

      const payload = sanitizeOrderPayloadForDb({ ...emptyOrderMeta, ...mapped })
      const { data: bastionInserted, error } = await supabase.from('orders').insert([payload]).select('id').single()

      if (error) {
        pushToast(`Wystąpił błąd: ${error.message}`, 'error')
        setIsSaving(false)
        return
      }

      await consumeStockForOrderWithToasts(Number((bastionInserted as { id: number }).id))

      setIsModalOpen(false)
      setBastionFormData(INITIAL_BASTION_ORDER_FORM)
      await fetchOrders()
      setIsSaving(false)
      return
    }

    if (isEditing && editingOrderBaseline) {
      const mapped = {
        ...formData,
        category: formData.category || activeTab,
        order_date: formData.order_date || editingOrderBaseline.order_date,
        production_stages: editingOrderBaseline.production_stages,
      }
      const payload = sanitizeOrderPayloadForDb({
        ...orderMetaForUpdate(editingOrderBaseline),
        ...mapped,
      })
      const { error } = await supabase.from('orders').update(payload).eq('id', editId)
      if (error) {
        pushToast(`Wystąpił błąd: ${error.message}`, 'error')
        setIsSaving(false)
        return
      }
      const merged = { ...editingOrderBaseline, ...payload } as Order
      setOrders((prev) => prev.map((o) => (o.id === editId ? merged : o)))
      await syncWarehouseStockAfterOrderEdit(editId, editingOrderBaseline, mapped)
      if (isBotOrder(editingOrderBaseline)) {
        await supabase.rpc('revalidate_bot_order', { p_order_id: editId })
        await fetchOrdersNeedingReview()
        const nextCategory = String(mapped.category ?? activeTab)
        pushToast(`Zamówienie przeniesione do ${nextCategory}`, 'info')
        if ((EDITABLE_CATEGORIES as readonly string[]).includes(nextCategory)) {
          setActiveTab(nextCategory as (typeof TABS)[number])
        }
      }
      pushToast('Zamówienie zaktualizowane', 'success')
      setIsModalOpen(false)
      setEditingOrderId(null)
      setEditingOrderBaseline(null)
      setFormData(INITIAL_FORM_DATA)
      setIsSaving(false)
      return
    }

    const { data: genericInserted, error } = await supabase
      .from('orders')
      .insert([
        sanitizeOrderPayloadForDb({
          ...formData,
          ...emptyOrderMeta,
          category: formData.category || activeTab,
          order_date: formData.order_date || new Date().toISOString().split('T')[0],
          production_stages: createEmptyProductionStages(activeTab),
        } as Record<string, unknown>),
      ])
      .select('id')
      .single()

    if (error) {
      pushToast(`Wystąpił błąd: ${error.message}`, 'error')
      setIsSaving(false)
      return
    }

    await consumeStockForOrderWithToasts(Number((genericInserted as { id: number }).id))

    setIsModalOpen(false)
    setFormData(INITIAL_FORM_DATA)
    await fetchOrders()
    setIsSaving(false)
  }

  // Wrapper — blokuje równoległe wywołania (double-click na „Zapisz")
  const handleSaveOrder = async () => {
    if (isSavingRef.current) return
    isSavingRef.current = true
    try {
      await handleSaveOrderImpl()
    } finally {
      isSavingRef.current = false
    }
  }

  const openNewOrderModal = async () => {
    setEditingOrderId(null)
    setEditingOrderBaseline(null)
    setOrderFormErrors([])
    const nextNr = await fetchNextOrderNumber(activeTab)
    if (activeTab === 'STA' || activeTab === 'Disting') {
      setStaFormData(
        applyDefaultConfigValues(
          { ...INITIAL_STA_ORDER_FORM, order_number: nextNr, category: activeTab },
          activeTab,
          allConfigDefaults,
        ),
      )
    } else if (activeTab === 'ST') {
      setStFormData(
        applyDefaultConfigValues(
          { ...INITIAL_ST_ORDER_FORM, order_number: nextNr, category: activeTab },
          activeTab,
          allConfigDefaults,
        ),
      )
    } else if (activeTab === 'Techniczne') {
      setTechniczneFormData(
        applyDefaultConfigValues(
          { ...INITIAL_TECHNICZNE_ORDER_FORM, order_number: nextNr, category: activeTab },
          activeTab,
          allConfigDefaults,
        ),
      )
    } else if (activeTab === 'Bastion') {
      setBastionFormData(
        applyDefaultConfigValues(
          { ...INITIAL_BASTION_ORDER_FORM, order_number: nextNr, category: activeTab },
          activeTab,
          allConfigDefaults,
        ),
      )
    } else {
      setFormData(
        applyDefaultConfigValues(
          { ...INITIAL_FORM_DATA, order_number: nextNr, category: activeTab },
          activeTab,
          allConfigDefaults,
        ),
      )
    }
    const snapshot =
      activeTab === 'STA' || activeTab === 'Disting'
        ? applyDefaultConfigValues(
            { ...INITIAL_STA_ORDER_FORM, order_number: nextNr, category: activeTab },
            activeTab,
            allConfigDefaults,
          )
        : activeTab === 'ST'
          ? applyDefaultConfigValues(
              { ...INITIAL_ST_ORDER_FORM, order_number: nextNr, category: activeTab },
              activeTab,
              allConfigDefaults,
            )
          : activeTab === 'Techniczne'
            ? applyDefaultConfigValues(
                { ...INITIAL_TECHNICZNE_ORDER_FORM, order_number: nextNr, category: activeTab },
                activeTab,
                allConfigDefaults,
              )
            : activeTab === 'Bastion'
              ? applyDefaultConfigValues(
                  { ...INITIAL_BASTION_ORDER_FORM, order_number: nextNr, category: activeTab },
                  activeTab,
                  allConfigDefaults,
                )
              : applyDefaultConfigValues(
                  { ...INITIAL_FORM_DATA, order_number: nextNr, category: activeTab },
                  activeTab,
                  allConfigDefaults,
                )
    setOrderFormOpenSnapshot(snapshot as Record<string, unknown>)
    setShowCompanyDropdown(false)
    setIsModalOpen(true)
  }

  const openCreateInternalDoorOrder = () => {
    setInternalDoorOrderModal({ open: true, mode: 'create', order: null })
  }

  const openEditInternalDoorOrder = (order: Order) => {
    if (!isManager) return
    setInternalDoorOrderModal({ open: true, mode: 'edit', order })
  }

  const openInternalDoorDetails = useCallback((order: Order) => {
    setInternalDoorDetailsModal({ open: true, order })
  }, [])

  const closeInternalDoorDetails = () => {
    setInternalDoorDetailsModal({ open: false, order: null })
  }

  const handleRushToggle = useCallback(
    async (order: Order, checked: boolean) => {
      if (!isManager) return
      const id = order.id
      if (id === undefined) {
        pushToast('Brak identyfikatora zamówienia', 'error')
        return
      }
      const nextSeq = checked ? 'X' : ''
      const wasRush = isRushOrderSequence(order.sequence)
      if (wasRush === checked) return
      setRushUpdatingOrderId(id)
      const { error } = await supabase.from('orders').update({ sequence: nextSeq }).eq('id', id)
      setRushUpdatingOrderId(null)
      if (error) {
        pushToast(`Wystąpił błąd: ${error.message}`, 'error')
        return
      }
      setOrders((prev) =>
        prev.map((o) => (o.id === id ? { ...o, sequence: nextSeq } : o)),
      )
    },
    [isManager, pushToast],
  )

  const handleBastionSalesChangesUpdate = useCallback(
    async (orderId: number, value: string) => {
      const { error } = await supabase
        .from('orders')
        .update({ bastion_sales_changes: value })
        .eq('id', orderId)
      if (error) {
        pushToast(`Wystąpił błąd: ${error.message}`, 'error')
        return
      }
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId ? ({ ...o, bastion_sales_changes: value } as Order) : o,
        ),
      )
    },
    [pushToast],
  )

  const handleBastionProductionPriorityUpdate = useCallback(
    async (orderId: number, value: string) => {
      if (!isManager) return
      const { error } = await supabase
        .from('orders')
        .update({ bastion_production_priority: value })
        .eq('id', orderId)
      if (error) {
        pushToast(`Wystąpił błąd: ${error.message}`, 'error')
        return
      }
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId ? ({ ...o, bastion_production_priority: value } as Order) : o,
        ),
      )
    },
    [isManager, pushToast],
  )

  const handleBastionLabelToggle = async (orderId: number, current: string) => {
    const newValue = current ? '' : new Date().toISOString().split('T')[0]
    const { error } = await supabase
      .from('orders')
      .update({ label: newValue })
      .eq('id', orderId)
    if (error) {
      pushToast(`Błąd: ${error.message}`, 'error')
      return
    }
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, label: newValue } : o)))
  }

  const handleRestoreOrder = useCallback(
    async (order: Order) => {
      if (!isManager) return
      const id = order.id
      if (id === undefined) {
        pushToast('Brak identyfikatora zamówienia', 'error')
        return
      }
      const linkedId = order.linked_order_id
      const isTitanLinked = isStaTitanLinked(order, [...orders, ...linkedOrders])
      const isDistingPlusLink =
        linkedId != null &&
        (order.category === 'Disting' || (order.category === 'STA' && !isTitanLinked))
      const isTitanLink =
        linkedId != null && (order.category === 'ST' || isTitanLinked)

      const currentExtra = mergeOrderExtraFields(order.extra_fields, {
        cancelled: false,
        cancelled_at: '',
        cancelled_by: '',
      })
      const { error: upErr } = await supabase.from('orders').update({ extra_fields: currentExtra }).eq('id', id)
      if (upErr) {
        pushToast(`Wystąpił błąd: ${upErr.message}`, 'error')
        return
      }

      await consumeStockForOrderWithToasts(id)

      if ((isDistingPlusLink || isTitanLink) && linkedId != null) {
        const { data: linkedRow, error: fetchErr } = await supabase
          .from('orders')
          .select('extra_fields')
          .eq('id', linkedId)
          .single()
        if (fetchErr) {
          pushToast(`Nie udało się odczytać powiązanego zamówienia: ${fetchErr.message}`, 'error')
          void fetchOrders()
          return
        }
        const linkedExtra = mergeOrderExtraFields(
          (linkedRow as { extra_fields?: unknown })?.extra_fields,
          { cancelled: false, cancelled_at: '', cancelled_by: '' },
        )
        const { error: linkErr } = await supabase
          .from('orders')
          .update({ extra_fields: linkedExtra })
          .eq('id', linkedId)
        if (linkErr) {
          pushToast(`Nie udało się przywrócić powiązania: ${linkErr.message}`, 'error')
          void fetchOrders()
          return
        }
      }

      if ((isDistingPlusLink || isTitanLink) && linkedId != null) {
        await consumeStockForOrderWithToasts(linkedId)
      }

      await fetchWarehouseStock()
      void fetchOrders()
    },
    [isManager, orders, linkedOrders, fetchOrders, pushToast, consumeStockForOrderWithToasts, fetchWarehouseStock],
  )

  const handleCancelOrderClick = useCallback((order: Order) => {
    if (!isManager) return
    const id = order.id
    if (id === undefined) {
      pushToast('Brak identyfikatora zamówienia', 'error')
      return
    }
    const linkedId = order.linked_order_id
    const isTitanLinked = isStaTitanLinked(order, [...orders, ...linkedOrders])
    const isDistingPlusLink =
      linkedId != null &&
      (order.category === 'Disting' || (order.category === 'STA' && !isTitanLinked))

    const isTitanLink =
      linkedId != null && (order.category === 'ST' || isTitanLinked)

    const linkedTabLabel = order.category === 'Disting' ? 'STA' : 'Disting'
    const linkedOrderNr =
      order.category === 'Disting'
        ? String(order.sta_sheet ?? '').trim()
        : order.category === 'STA' && isTitanLink
          ? String(order.st_sheet ?? '').trim()
          : order.category === 'ST'
            ? String(order.sta_ref ?? '').trim()
            : String(order.disting_sheet ?? '').trim()
    const linkedNrDisplay = linkedOrderNr || '—'
    const baseMsg = `Czy na pewno chcesz anulować zamówienie nr ${order.order_number}?`
    const message = isDistingPlusLink
      ? `To zamówienie jest powiązane z zamówieniem nr ${linkedNrDisplay} w ${linkedTabLabel}. Zamówienie powiązane zostanie oznaczone jako anulowane. ${baseMsg}`
      : isTitanLink && order.category === 'STA'
        ? `To zamówienie jest powiązane z zamówieniem Titan nr ${linkedNrDisplay} w ST. Zamówienie powiązane zostanie oznaczone jako anulowane. ${baseMsg}`
        : isTitanLink && order.category === 'ST'
          ? `To zamówienie jest powiązane z zamówieniem STA nr ${linkedNrDisplay}. Zamówienie powiązane zostanie oznaczone jako anulowane. ${baseMsg}`
          : baseMsg

    setDeleteConfirm({
      title: 'Anuluj zamówienie',
      confirmLabel: 'Anuluj zamówienie',
      cancelLabel: 'Wróć',
      message,
      runDelete: async () => {
        const cancelledAt = new Date().toISOString()
        const cancelledBy = currentUser?.initials ?? ''
        const currentExtra = mergeOrderExtraFields(order.extra_fields, {
          cancelled: true,
          cancelled_at: cancelledAt,
          cancelled_by: cancelledBy,
        })

        const { error } = await supabase.from('orders').update({ extra_fields: currentExtra }).eq('id', id)
        if (error) {
          pushToast(`Wystąpił błąd: ${error.message}`, 'error')
          return
        }

        const { error: clearStockErr } = await supabase
          .from('orders')
          .update({ stock_status: null, stock_issues: null })
          .eq('id', id)
        if (clearStockErr) {
          pushToast(`Wystąpił błąd: ${clearStockErr.message}`, 'error')
          return
        }

        if ((isDistingPlusLink || isTitanLink) && linkedId != null) {
          const { data: linkedRow, error: fetchErr } = await supabase
            .from('orders')
            .select('extra_fields')
            .eq('id', linkedId)
            .single()
          if (fetchErr) {
            pushToast(`Nie udało się odczytać powiązanego zamówienia: ${fetchErr.message}`, 'error')
            // Główne zamówienie jest już anulowane — zwróć przynajmniej jego stock
            try { await supabase.rpc('return_stock_for_order', { p_order_id: id }) } catch (e) { console.error(e) }
            await fetchWarehouseStock()
            void fetchOrders()
            return
          }
          const linkedExtra = mergeOrderExtraFields(
            (linkedRow as { extra_fields?: unknown }).extra_fields,
            { cancelled: true },
          )
          const { error: linkUpErr } = await supabase
            .from('orders')
            .update({ extra_fields: linkedExtra })
            .eq('id', linkedId)
          if (linkUpErr) {
            pushToast(`Nie udało się oznaczyć powiązania: ${linkUpErr.message}`, 'error')
            try { await supabase.rpc('return_stock_for_order', { p_order_id: id }) } catch (e) { console.error(e) }
            await fetchWarehouseStock()
            void fetchOrders()
            return
          }

          const { error: clearLinkedStockErr } = await supabase
            .from('orders')
            .update({ stock_status: null, stock_issues: null })
            .eq('id', linkedId)
          if (clearLinkedStockErr) {
            pushToast(`Wystąpił błąd: ${clearLinkedStockErr.message}`, 'error')
            return
          }
        }

        try {
          const { error: retErr } = await supabase.rpc('return_stock_for_order', { p_order_id: id })
          if (retErr) {
            pushToast(`Ostrzeżenie: błąd zwrotu do magazynu: ${retErr.message}`, 'error')
          }
        } catch (err) {
          console.error('return_stock_for_order error:', err)
          pushToast('Ostrzeżenie: nie udało się zwrócić stanów do magazynu', 'error')
        }
        if ((isDistingPlusLink || isTitanLink) && linkedId != null) {
          try {
            const { error: retErr2 } = await supabase.rpc('return_stock_for_order', { p_order_id: linkedId })
            if (retErr2) {
              pushToast(`Ostrzeżenie: błąd zwrotu do magazynu (powiązane): ${retErr2.message}`, 'error')
            }
          } catch (err) {
            console.error('return_stock_for_order error (linked):', err)
            pushToast('Ostrzeżenie: nie udało się zwrócić stanów do magazynu (powiązane)', 'error')
          }
        }
        await fetchWarehouseStock()
        await fetchSmartRop()
        await fetchOrders()

        pushToast('Zamówienie zostało anulowane', 'success')
        setOrders((prev) =>
          prev.map((o) => {
            if (o.id === id) {
              return {
                ...o,
                extra_fields: currentExtra,
                stock_status: null,
                stock_issues: null,
              }
            }
            if (linkedId != null && o.id === linkedId && (isDistingPlusLink || isTitanLink)) {
              return {
                ...o,
                extra_fields: mergeOrderExtraFields(o.extra_fields, { cancelled: true }),
                stock_status: null,
                stock_issues: null,
              }
            }
            return o
          }),
        )
      },
    })
  }, [isManager, orders, linkedOrders, fetchOrders, fetchWarehouseStock, fetchSmartRop, pushToast, currentUser, setDeleteConfirm])

  const openEditOrderModal = useCallback((order: Order) => {
    if (!isManager) return
    if (order.id === undefined) {
      pushToast('Brak identyfikatora zamówienia — nie można edytować', 'error')
      return
    }
    setEditingOrderId(order.id)
    setEditingOrderBaseline(order)
    setShowCompanyDropdown(false)
    const rawCategory = String(order.category ?? '')
    const isKnownCategory = (TABS as readonly string[]).includes(rawCategory)
    const resolvedCategory =
      isKnownCategory
        ? rawCategory
        : rawCategory.toLowerCase().includes('bastion')
          ? 'Bastion'
          : 'Disting'
    if (resolvedCategory === 'STA' || resolvedCategory === 'Disting') {
      setStaFormData(orderToStaForm(order))
    } else if (resolvedCategory === 'ST') {
      setStFormData(orderToStForm(order))
    } else if (resolvedCategory === 'Techniczne') {
      setTechniczneFormData(orderToTechniczneForm(order))
    } else if (resolvedCategory === 'Bastion') {
      setBastionFormData(orderToBastionForm(order))
    } else {
      setFormData(orderToLegacyForm(order))
    }
    setOrderFormOpenSnapshot(null)
    setIsModalOpen(true)
  }, [isManager, pushToast, setShowCompanyDropdown])

  const handleDuplicateOrder = useCallback(async (order: Order) => {
    if (!isManager) return
    const rawCategory = String(order.category ?? '')
    const isKnownCategory = (TABS as readonly string[]).includes(rawCategory)
    const resolvedCategory = isKnownCategory
      ? rawCategory
      : rawCategory.toLowerCase().includes('bastion')
        ? 'Bastion'
        : 'Disting'

    const newNr = await fetchNextOrderNumber(resolvedCategory)

    setEditingOrderId(null)
    setEditingOrderBaseline(null)
    setShowCompanyDropdown(false)

    if (resolvedCategory === 'STA' || resolvedCategory === 'Disting') {
      setStaFormData({
        ...orderToStaForm(order),
        order_number: newNr,
        // Wyczyść etapy produkcji — nowe zamówienie zaczyna od zera
        stage1: '', stage2_1: '', stage2_2: '', stage3: '', stage4: '', stage5: '',
      })
    } else if (resolvedCategory === 'ST') {
      setStFormData({ ...orderToStForm(order), order_number: newNr })
    } else if (resolvedCategory === 'Techniczne') {
      setTechniczneFormData({ ...orderToTechniczneForm(order), order_number: newNr })
    } else if (resolvedCategory === 'Bastion') {
      setBastionFormData({ ...orderToBastionForm(order), order_number: newNr })
    } else {
      setFormData({ ...orderToLegacyForm(order), order_number: newNr })
    }

    setOrderFormOpenSnapshot(null)
    setIsModalOpen(true)
    pushToast(`Duplikowanie zamówienia — nowy nr ${newNr}`, 'info')
  }, [isManager, fetchNextOrderNumber, pushToast, setShowCompanyDropdown])

  const closeNewOrderModal = useCallback(() => {
    if (isSaving) {
      return
    }
    setOrderFormErrors([])
    setIsModalOpen(false)
    setEditingOrderId(null)
    setEditingOrderBaseline(null)
  }, [isSaving])

  const handleRequestCloseOrderModal = useCallback(() => {
    if (isSaving) return
    const isDirty = (() => {
      const active =
        activeTab === 'STA' || activeTab === 'Disting'
          ? staFormData
          : activeTab === 'ST'
            ? stFormData
            : activeTab === 'Techniczne'
              ? techniczneFormData
              : activeTab === 'Bastion'
                ? bastionFormData
                : formData

      const baseline: Record<string, unknown> | null =
        editingOrderId !== null && editingOrderBaseline
          ? (editingOrderBaseline as Record<string, unknown>)
          : orderFormOpenSnapshot

      if (!baseline) return false

      const fieldsToCompare = [
        'company',
        'system',
        'model',
        'wing_color',
        'frame_color',
        'width',
        'height',
        'direction',
        'glazing',
        'hardware',
        'handle',
        'peephole',
        'quantity',
        'notes',
        'client_order_number',
        'threshold_color',
        'decorative_panel',
      ] as const

      const activeRec = active as Record<string, unknown>
      return fieldsToCompare.some((field) => {
        const oldVal = baseline[field] ?? ''
        const newVal = activeRec[field] ?? ''
        return String(oldVal).trim() !== String(newVal).trim()
      })
    })()

    if (!isDirty) {
      closeNewOrderModal()
      return
    }

    setDeleteConfirm({
      title: 'Zamknij formularz',
      confirmLabel: 'Zamknij bez zapisu',
      cancelLabel: 'Wróć do formularza',
      message: 'Formularz zawiera niezapisane dane. Czy na pewno chcesz go zamknąć?',
      runDelete: async () => {
        closeNewOrderModal()
      },
    })
  }, [
    isSaving,
    editingOrderId,
    editingOrderBaseline,
    activeTab,
    orderFormOpenSnapshot,
    staFormData,
    stFormData,
    techniczneFormData,
    bastionFormData,
    formData,
    closeNewOrderModal,
    setDeleteConfirm,
  ])

  const handleOpenReviewOrder = useCallback(
    async (orderId: number) => {
      let order = orders.find((o) => o.id === orderId)
      if (!order) {
        const { data, error } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle()
        if (error || !data) {
          console.error('handleOpenReviewOrder fetch failed', error)
          pushToast('Nie znaleziono zamówienia w bazie', 'error')
          return
        }
        order = data as Order
      }

      const category = String(order.category ?? '')
      if ((EDITABLE_CATEGORIES as readonly string[]).includes(category)) {
        setActiveTab(category as (typeof TABS)[number])
      } else {
        pushToast(
          `Zamówienie ma fikcyjną kategorię "${category}". Otwieram modal w Bastion — wybierz poprawną kategorię i zapisz.`,
          'info',
        )
        setActiveTab('Bastion')
      }
      setActiveSubTab('Zamówienia')
      setTimeout(() => openEditOrderModal(order!), 100)
    },
    [orders, pushToast, openEditOrderModal, setActiveTab, setActiveSubTab],
  )

  const handleMarkVerified = useCallback(
    async (orderId: number) => {
      const confirmed = window.confirm(
        'Czy na pewno oznaczyć zamówienie jako zweryfikowane? Zniknie z listy weryfikacji.',
      )
      if (!confirmed) return
      const { error } = await supabase.rpc('mark_bot_order_verified', { p_order_id: orderId })
      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }
      pushToast('Zamówienie oznaczone jako zweryfikowane', 'success')
      await fetchOrdersNeedingReview()
      await fetchOrders()
    },
    [fetchOrders, fetchOrdersNeedingReview, pushToast],
  )

  const handleCancelReviewOrder = useCallback(
    async (orderId: number) => {
      const order = orders.find((o) => o.id === orderId)
      if (!order) {
        pushToast('Nie znaleziono zamówienia', 'error')
        return
      }
      handleCancelOrderClick(order)
    },
    [orders, pushToast, handleCancelOrderClick],
  )

  const openOrderFromWarehouseMovement = useCallback(
    async (movement: WarehouseMovementRow) => {
      if (!movement.order_id) return
      const { data, error } = await supabase.from('orders').select('*').eq('id', movement.order_id).single()
      if (error || !data) {
        pushToast(`Nie udało się otworzyć zamówienia: ${error?.message ?? 'brak danych'}`, 'error')
        return
      }
      const order = data as Order
      const category = order.category as (typeof TABS)[number]
      setActiveTab(category)
      setActiveSubTab('Zamówienia')

      if (category === 'DrzwiWewnetrzne') {
        const { data: itemsData, error: itemsError } = await supabase
          .from('order_internal_door_items')
          .select(
            '*, warehouse_components(name, product_category, door_model, door_size, door_direction, door_color, door_frame_type, door_frame_code, door_handle_shield)',
          )
          .eq('order_id', movement.order_id)
        if (!itemsError) {
          const mapped = ((itemsData ?? []) as Array<Record<string, unknown>>).map((row) => {
            const warehouseComponent = row.warehouse_components as
              | {
                  name?: string | null
                  product_category?: string | null
                  door_model?: string | null
                  door_size?: string | null
                  door_direction?: string | null
                  door_color?: string | null
                  door_frame_type?: string | null
                  door_frame_code?: string | null
                  door_handle_shield?: string | null
                }
              | undefined
            return {
              ...(row as unknown as InternalDoorItem),
              component_name: warehouseComponent?.name ?? null,
              component_category: warehouseComponent?.product_category ?? null,
              component_door_model: warehouseComponent?.door_model ?? null,
              component_door_size: warehouseComponent?.door_size ?? null,
              component_door_direction: warehouseComponent?.door_direction ?? null,
              component_door_color: warehouseComponent?.door_color ?? null,
              component_door_frame_type: warehouseComponent?.door_frame_type ?? null,
              component_door_frame_code: warehouseComponent?.door_frame_code ?? null,
              component_door_handle_shield: warehouseComponent?.door_handle_shield ?? null,
            } as InternalDoorItem
          })
          setInternalDoorItems(mapped)
        }
        openInternalDoorDetails(order)
        return
      }

      if (!isManager) return
      if (order.id === undefined) return
      setEditingOrderId(order.id)
      setEditingOrderBaseline(order)
      setShowCompanyDropdown(false)
      if (category === 'STA' || category === 'Disting') {
        setStaFormData(orderToStaForm(order))
      } else if (category === 'ST') {
        setStFormData(orderToStForm(order))
      } else if (category === 'Techniczne') {
        setTechniczneFormData(orderToTechniczneForm(order))
      } else if (category === 'Bastion') {
        setBastionFormData(orderToBastionForm(order))
      } else {
        setFormData(orderToLegacyForm(order))
      }
      setOrderFormOpenSnapshot(null)
      setIsModalOpen(true)
    },
    [isManager, openInternalDoorDetails, pushToast, setActiveTab, setActiveSubTab, setShowCompanyDropdown],
  )

  const handleShowOrderHistory = (order: Order) => {
    setHistoryModal({
      open: true,
      orderId: order.id ?? null,
      orderNumber: order.order_number ?? null,
    })
  }

  const handleGlassReceived = useCallback(
    async (orderId: number) => {
      const today = new Date().toISOString().split('T')[0]
      const { error } = await supabase
        .from('orders')
        .update({ glass_received: true, glass_received_date: today })
        .eq('id', orderId)
      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId ? { ...o, glass_received: true, glass_received_date: today } : o,
        ),
      )
      pushToast('Szyba oznaczona jako odebrana', 'success')
    },
    [pushToast],
  )

  const confirmProductionStageRevert = useCallback(async () => {
    if (!stageRevertTarget) return
    const order = orders.find((o) => o.id === stageRevertTarget.orderId)
    if (!order || order.id === undefined) {
      // Zamówienie zniknęło (np. odświeżenie/usunięcie) — zamknij popup, nie zostawiaj go wiszącego
      setStageRevertTarget(null)
      return
    }
    await applyProductionStagesUpdate(order.id, stageRevertTarget.stageKey, '')
    await syncMirrorStagesToLinkedOrder(order, stageRevertTarget.stageKey, '')
    setStageRevertTarget(null)
  }, [stageRevertTarget, orders, applyProductionStagesUpdate, syncMirrorStagesToLinkedOrder])

  const confirmReleaseClear = useCallback(async () => {
    if (!releaseClearTarget) return
    await applyReleaseDateUpdate(releaseClearTarget.orderId, null)
    setReleaseClearTarget(null)
  }, [releaseClearTarget, applyReleaseDateUpdate])

  // Computed values used in App.tsx as memos
  const topLightDimsFilled =
    staFormData.top_light_w_mm.trim() !== '' || staFormData.top_light_h_mm.trim() !== ''
  const sidePanelAFilled = staFormData.side_panel_a_w_mm.trim() !== ''
  const sidePanelBFilled = staFormData.side_panel_b_w_mm.trim() !== ''

  const autoTopLightWidth = (() => {
    if (activeTab !== 'STA' && activeTab !== 'Disting') return ''
    return calcTopLightWidth(staFormData, activeTab, dimensionMap)
  })()

  const autoSidePanelHeight = (() => {
    if (activeTab !== 'STA' && activeTab !== 'Disting') return ''
    return calcSidePanelHeight(staFormData, activeTab, dimensionMap)
  })()

  const isReleaseDateEmptyFn = isReleaseDateEmpty

  return {
    // state
    alertsBadgeCount,
    setAlertsBadgeCount,
    orders,
    setOrders,
    internalDoorItems,
    setInternalDoorItems,
    linkedOrders,
    setLinkedOrders,
    loading,
    setLoading,
    isModalOpen,
    setIsModalOpen,
    internalDoorOrderModal,
    setInternalDoorOrderModal,
    internalDoorDetailsModal,
    setInternalDoorDetailsModal,
    editingOrderId,
    setEditingOrderId,
    editingOrderBaseline,
    setEditingOrderBaseline,
    orderFormOpenSnapshot,
    setOrderFormOpenSnapshot,
    isSaving,
    setIsSaving,
    formData,
    setFormData,
    staFormData,
    setStaFormData,
    stFormData,
    setStFormData,
    bastionFormData,
    setBastionFormData,
    techniczneFormData,
    setTechniczneFormData,
    orderFormErrors,
    setOrderFormErrors,
    orderModalConfigRows,
    setOrderModalConfigRows,
    searchTerm,
    setSearchTerm,
    selectedProductionDay,
    setSelectedProductionDay,
    hideCompletedOrders,
    setHideCompletedOrders,
    showCancelledOrders,
    setShowCancelledOrders,
    sourceFilter,
    setSourceFilter,
    stageRevertTarget,
    setStageRevertTarget,
    productionStageUpdating,
    setProductionStageUpdating,
    releaseClearTarget,
    setReleaseClearTarget,
    releaseDateUpdating,
    setReleaseDateUpdating,
    rushUpdatingOrderId,
    setRushUpdatingOrderId,
    historyModal,
    setHistoryModal,
    // computed
    topLightDimsFilled,
    sidePanelAFilled,
    sidePanelBFilled,
    autoTopLightWidth,
    autoSidePanelHeight,
    filteredCompanies,
    filteredStaCompanies,
    filteredStCompanies,
    filteredBastionCompanies,
    filteredTechniczneCompanies,
    isReleaseDateEmptyFn,
    // functions
    fetchAlertsBadgeCount,
    submitOnEnterInInput,
    applyProductionStagesUpdate,
    syncMirrorStagesToLinkedOrder,
    applyReleaseDateUpdate,
    toggleOscReceived,
    fetchNextOrderNumber,
    markProductionStageWithProfileInitials,
    fetchInternalDoorItemsForVisibleOrders,
    fetchOrders,
    handleFormChange,
    handleCompanySelect,
    handleStaCompanySelect,
    handleStaFormChange,
    handleStFormChange,
    handleStCompanySelect,
    handleBastionFormChange,
    handleBastionCompanySelect,
    handleTechniczneFormChange,
    handleTechniczneCompanySelect,
    handleCompanyAutocompleteKeyDown,
    sendGlassOrderWebhook,
    handleSaveOrder,
    openNewOrderModal,
    openCreateInternalDoorOrder,
    openEditInternalDoorOrder,
    openInternalDoorDetails,
    closeInternalDoorDetails,
    handleRushToggle,
    handleBastionSalesChangesUpdate,
    handleBastionProductionPriorityUpdate,
    handleBastionLabelToggle,
    handleRestoreOrder,
    handleCancelOrderClick,
    openEditOrderModal,
    handleDuplicateOrder,
    closeNewOrderModal,
    handleRequestCloseOrderModal,
    handleOpenReviewOrder,
    handleMarkVerified,
    handleCancelReviewOrder,
    openOrderFromWarehouseMovement,
    handleShowOrderHistory,
    handleGlassReceived,
    confirmProductionStageRevert,
    confirmReleaseClear,
  }
}
