export type Order = {
  id?: number
  order_number: string
  company: string
  order_date: string
  production_day: string
  quantity: number
  sequence: string
  system: string
  model: string
  wing_color: string
  frame_color: string
  threshold_color: string
  width: string
  direction: string
  opening: string
  height: string
  glazing: string
  decorative_panel: string
  hardware: string
  handle: string
  electric_strike: string
  peephole: string
  top_light: string
  top_light_glazing: string
  side_panel: string
  side_panel_glazing: string
  side_panel_a?: string
  side_panel_b?: string
  side_panel_a_glazing?: string
  side_panel_b_glazing?: string
  extension: string
  extension_qtys?: Record<string, Record<string, number>>
  extension_a_qty?: number
  extension_b_qty?: number
  extension_top_qty?: number
  extension_a_qty_3cm?: number
  extension_a_qty_5cm?: number
  extension_b_qty_3cm?: number
  extension_b_qty_5cm?: number
  extension_top_qty_3cm?: number
  extension_top_qty_5cm?: number
  extension_a_dim?: string
  extension_b_dim?: string
  extension_top_dim?: string
  extension_profile_width?: string
  glass_order_date?: string | null
  glass_received?: boolean
  glass_received_date?: string | null
  release_date?: string | null
  disting_sheet: string
  notes: string
  client_order_number: string
  defects: string
  entered_by: string
  configurator_value: string
  info: string
  airtable_id: string
  label: string
  category: string
  source?: 'manual' | 'bot' | 'api' | null
  source_metadata?:
    | {
        received_at?: string
        ip_address?: string
        user_agent?: string
      }
    | Record<string, unknown>
    | null
  production_stages?: unknown
  linked_order_id?: number | null
  sta_sheet?: string
  oslonki?: string
  zaczep?: string
  podwalina_1?: string
  podwalina_1_qty?: number | null
  podwalina_2?: string
  podwalina_2_qty?: number | null
  extra_fields?: unknown
  sta_ref?: string | null
  st_sheet?: string | null
  stock_status?: 'ok' | 'insufficient' | 'no_recipe' | 'partial_recipe' | null
  stock_issues?: Array<{
    type?: 'shortage' | 'missing_recipe' | 'glass_not_received'
    component_code?: string
    component_name?: string
    shortage?: number
    warehouse?: string
    part: string
    message?: string
    glazing?: string
    raw_dim?: string
  }> | null
}

export type Complaint = {
  id?: number
  complaint_number: string
  complaint_date: string
  category: string
  order_id: number | null
  order_number: string
  company: string
  what_complained: string
  reason: string
  created_by: string
  created_at?: string
  production_stages?: unknown
  order_date: string
  production_day: string
  quantity: number
  sequence: string
  system: string
  model: string
  wing_color: string
  frame_color: string
  threshold_color: string
  width: string
  direction: string
  opening: string
  height: string
  glazing: string
  decorative_panel: string
  hardware: string
  handle: string
  electric_strike: string
  peephole: string
  top_light: string
  top_light_glazing: string
  side_panel: string
  side_panel_glazing: string
  extension: string
  release_date?: string | null
  disting_sheet: string
  sta_sheet: string
  notes: string
  client_order_number: string
  defects: string
  configurator_value: string
  info: string
  airtable_id: string
  label: string
  is_rush: boolean
  linked_complaint_id?: number | null
  extra_fields?: unknown
}

export type OrderNeedingReview = {
  id: number
  order_number: string
  category: string
  client_order_number: string | null
  company: string | null
  model: string | null
  bot_received_at: string | null
  warnings: string[]
  api_key_id: number | null
  raw_payload: Record<string, unknown> | null
}

export type ComplaintFormData = {
  order_id: number | null
  order_number: string
  company: string
  what_complained: string
  reason: string
  order_date: string
  production_day: string
  quantity: number
  sequence: string
  system: string
  model: string
  wing_color: string
  frame_color: string
  threshold_color: string
  width: string
  direction: string
  opening: string
  height: string
  glazing: string
  decorative_panel: string
  hardware: string
  handle: string
  electric_strike: string
  peephole: string
  top_light: string
  top_light_glazing: string
  side_panel: string
  side_panel_glazing: string
  extension: string
  release_date: string | null
  disting_sheet: string
  sta_sheet: string
  notes: string
  client_order_number: string
  defects: string
  configurator_value: string
  info: string
  airtable_id: string
  label: string
  is_rush: boolean
  linked_complaint_id: number | null
}

export type SubTab = 'Zamówienia' | 'Reklamacje' | 'Naświetla' | 'Ościeżnice regulowane'

export type OrderCategory =
  | 'STA'
  | 'Disting'
  | 'ST'
  | 'Techniczne'
  | 'Bastion'
  | 'DrzwiWewnetrzne'

export type InternalDoorItem = {
  id: number
  order_id: number
  component_id: number
  quantity: number
  shorten_enabled: boolean
  shorten_target_height: number | null
  notes: string | null
  created_at: string
  component_name?: string | null
  component_category?: string | null
}

export type ProfileDepartment = 'all' | 'bastion' | 'stalowe' | 'magazyn'

export type DbProfileRow = {
  id: string
  first_name?: string
  last_name?: string
  email?: string
  user_email?: string
  full_name: string
  initials: string
  role: string
  department: string
  categories?: string[]
}

export type Profile = DbProfileRow

export type WorkerStage = {
  id: number
  worker_id: string
  category: string
  stage_key: string
  created_at: string
  created_by: string | null
}

export type OrderComment = {
  id: number
  order_id: number
  author_id: string
  author_name?: string
  author_role?: string
  content: string
  created_at: string
  updated_at: string
  edited: boolean
}

export type UserFormState = {
  username: string
  full_name: string
  initials: string
  password: string
  role: string
  department: 'all' | 'bastion' | 'stalowe' | 'magazyn'
  categories: string[]
}

export type CurrentUser = {
  id: string
  email: string
  initials: string
  full_name: string
  role: string
  department: ProfileDepartment
  categories?: string[]
}

export type ConfigFormCategory = 'STA' | 'Disting' | 'ST' | 'Techniczne' | 'Bastion' | 'Wewnetrzne'

export type ConfigDictionaryDef = {
  key: string
  label: string
  category: ConfigFormCategory
  type: string
}

export type ConfigSubTab =
  | 'Słowniki'
  | 'Wykluczenia'
  | 'Słownik wymiarów'
  | 'Naddatki szyb (naświetla)'
  | 'Dostawcy'
  | 'Dane firmy'
  | 'Terminy realizacji'

export type LeadTimeRule = {
  id: number
  name: string
  match_category: string | null
  match_has_glass_extra: boolean | null
  match_bastion_frame_type: string | null
  warning_days: number
  overdue_days: number
  priority: number
  is_active: boolean
}

export type OrderAgeStatus = 'ok' | 'warning' | 'overdue'

export type CompanySettings = {
  id: number
  company_name: string
  address_line1: string | null
  address_line2: string | null
  city: string | null
  postal_code: string | null
  country: string | null
  nip: string | null
  regon: string | null
  phone: string | null
  email: string | null
  bank_account: string | null
  logo_url: string | null
  notes: string | null
  updated_at: string
}

export type StageDef = { key: string; header: string; title?: string }

export type WhatComplained = 'Skrzydło' | 'Ościeżnica' | 'Komplet'

export type StStageLayoutMode = 'std' | 'titan' | 'mixed'

export type StStageCellKind =
  | { kind: 'click'; stageKey: string }
  | { kind: 'e2_sta'; stageKey: 'sta_e5' }
  | { kind: 'skr_badge' }
  | { kind: 'none' }

export type OrderExtraFields = {
  disting_cancelled?: boolean
  sta_cancelled?: boolean
  cancelled?: boolean
  cancelled_at?: string
  cancelled_by?: string
  wykonawca?: string
  ready_to_invoice?: boolean
  [key: string]: unknown
}

export type NewOrderFormData = {
  order_number: string
  category: string
  company: string
  order_date: string
  production_day: string
  quantity: number
  sequence: string
  system: string
  model: string
  wing_color: string
  frame_color: string
  threshold_color: string
  width: string
  direction: string
  opening: string
  height: string
  glazing: string
  hardware: string
  notes: string
  entered_by: string
}

export type Company = {
  id: number
  name: string
  city: string
  route_day: string
  production_day: string
}

export type Supplier = {
  id: number
  name: string
  email: string | null
  phone: string | null
  contact_person: string | null
  lead_time_days: number
  requires_full_tir: boolean
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type ContractorFormData = {
  name: string
  city: string
  route_day: string
  production_day: string
}

export type StaOrderFormData = {
  order_number: string
  category: string
  company: string
  production_day: string
  system: string
  model: string
  wing_color: string
  frame_color: string
  threshold_color: string
  width: string
  direction: string
  height: string
  opening: string
  glazing: string
  decorative_panel: string
  top_light_w_mm: string
  top_light_h_mm: string
  top_light_glazing: string
  side_panel_a_w_mm: string
  side_panel_b_w_mm: string
  side_panel_h_mm: string
  side_panel_a_glazing: string
  side_panel_b_glazing: string
  extension: string
  extension_qtys: Record<string, Record<string, number>>
  peephole: string
  hardware: string
  handle: string
  oslonki: string
  zaczep: string
  stage1: string
  stage2_1: string
  stage2_2: string
  stage3: string
  stage4: string
  stage5: string
  quantity: number
  notes: string
  client_order_number: string
  wykonawca: string
}

export type StaConfigRow = {
  type: string
  value: string
  sort_order: number
}

export type ConfigOptionRecord = {
  id: number | string
  category: string
  type: string
  value: string
  sort_order: number
  is_default?: boolean
  label_multiplier?: number | null
  add_to_batch?: boolean
}

export type ConfigExclusion = {
  id?: number
  category: string
  source_field: string
  source_value: string
  target_field: string
  target_value: string
  created_at?: string
}

export type DimensionMap = {
  id: number
  category: string
  dimension_code: string
  width_mm: number
  height_mm: number
}

export type GlassAllowance = {
  id: number
  category: string
  element: string
  allowance_w_mm: number
  allowance_h_mm: number
}

export type ExtensionProfileWidth = {
  category: string
  profile_width_mm: number
}

export type StOrderFormData = {
  order_number: string
  category: string
  company: string
  production_day: string
  system: string
  model: string
  wing_color: string
  threshold_color: string
  width: string
  direction: string
  height: string
  opening: string
  glazing: string
  peephole: string
  hardware: string
  extension: string
  handle: string
  quantity: number
  notes: string
  client_order_number: string
  sta_ref: string
}

export type TechniczneOrderFormData = {
  order_number: string
  category: string
  company: string
  production_day: string
  system: string
  model: string
  wing_color: string
  threshold_color: string
  width: string
  direction: string
  height: string
  opening: string
  glazing: string
  peephole: string
  hardware: string
  handle: string
  quantity: number
  notes: string
  client_order_number: string
}

export type BastionOrderFormData = {
  order_number: string
  category: string
  company: string
  production_day: string
  system: string
  model: string
  wing_color: string
  frame_color: string
  threshold_color: string
  width: string
  direction: string
  height: string
  opening: string
  glazing: string
  peephole: string
  hardware: string
  quantity: number
  notes: string
  notes_2: string
  client_order_number: string
  collection: string
  frame_type: string
  frame_range: string
  side_panel_k_w: string
  side_panel_p_w: string
  side_panel_h: string
  top_panel_w: string
  top_panel_h: string
  sales_changes: string
  rush_date: string
  day_of_week: string
  is_promo: boolean
  is_production_rush: boolean
  production_priority: string
  label_qty: number
}

export type ToastVariant = 'success' | 'error' | 'info'

export type ToastRecord = {
  id: string
  message: string
  variant: ToastVariant
}

export type ApiKey = {
  id: number
  name: string
  key_prefix: string | null
  is_active: boolean
  rate_limit_per_minute: number
  total_requests: number
  total_orders_created: number
  last_used_at: string | null
  created_at: string
}

export type DeleteConfirmState = {
  message: string
  runDelete: () => Promise<void>
  title?: string
  confirmLabel?: string
  cancelLabel?: string
}

export type Warehouse = {
  id: number
  code: string
  name: string
  is_active: boolean
}

export type WarehouseStockRow = {
  id: number
  warehouse_id: number
  component_id: number
  quantity: number
  updated_at: string
  warehouse_code?: string
  component_code?: string
  component_name?: string
  component_unit?: string
  component_category?: string | null
  component_min_stock_level?: number | null
}

export type WarehouseMovementRow = {
  id: number
  movement_type: 'WZ' | 'PZ' | 'MM' | 'ZWR'
  warehouse_from_id?: number | null
  warehouse_to_id?: number | null
  component_id: number
  quantity: number
  order_id?: number | null
  reference_doc?: string | null
  notes?: string | null
  created_by?: string | null
  created_at: string
  warehouse_from_code?: string | null
  warehouse_to_code?: string | null
  component_code?: string | null
  component_name?: string | null
  component_unit?: string | null
  order_number?: string | null
}

export type PzItem = {
  component_id: number
  quantity: number
  notes?: string
}

export type PzFormState = {
  warehouse_id: number | null
  reference_doc: string
  notes: string
  items: PzItem[]
}

export type PzGroupRow = {
  reference_doc: string
  warehouse_id: number
  warehouse_code: string
  created_at: string
  created_by: string | null
  items_count: number
  total_quantity: number
}

export type MmItem = {
  component_id: number
  quantity: number
  notes?: string
}

export type MmFormState = {
  warehouse_from_id: number | null
  warehouse_to_id: number | null
  reference_doc: string
  notes: string
  items: MmItem[]
}

export type MmGroupRow = {
  reference_doc: string
  warehouse_from_id: number
  warehouse_from_code: string
  warehouse_to_id: number
  warehouse_to_code: string
  created_at: string
  created_by: string | null
  items_count: number
  total_quantity: number
}

export type StatsSubTab =
  | 'STA'
  | 'Disting'
  | 'ST'
  | 'Techniczne'
  | 'Bastion'
  | 'DrzwiWewnetrzne'
  | 'Reklamacje'
  | 'Produktywność'
  | 'Czas realizacji'

export type OrderPhoto = {
  id: number
  order_id: number
  storage_path: string
  public_url: string
  uploaded_by: string | null
  uploaded_by_initials: string | null
  created_at: string
}

export type AppNotification = {
  id: number
  user_id: string
  type: string
  title: string
  body: string | null
  link_tab: string | null
  link_order_id: number | null
  is_read: boolean
  created_at: string
}

export type AuditLogRow = {
  id: number
  table_name: string
  record_id: string | null
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  user_id: string | null
  user_email: string | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  changed_fields: string[] | null
  created_at: string
}

export type AuditFilters = {
  table?: string
  operation?: string
  userId?: string
  searchQuery?: string
  dateFrom?: string
  dateTo?: string
}

export type ArchivedOrder = Order & {
  created_at?: string
  archived_at: string
  archived_by: string | null
  archive_reason: string
}

export type ArchiveRunLog = {
  id: number
  run_at: string
  archived_count: number
  oldest_archived: string | null
  newest_archived: string | null
  duration_ms: number | null
  status: 'success' | 'error'
  error_message: string | null
}

export type StockAlert = {
  component_id: number
  component_name: string
  component_code: string | null
  product_category?: string | null
  warehouse_id: number
  warehouse_code: string
  warehouse_name: string
  current_stock: number
  baseline_monthly: number
  seasonal_factor: number
  daily_consumption: number
  days_until_empty: number | null
  alert_level: 'critical' | 'warning' | 'observation' | 'ok' | 'no_data'
  suggested_order_qty: number
}

export type SmartRopRow = {
  component_id: number
  component_name: string
  smart_status: 'smart' | 'manual'
  recommended_min_stock: number | null
  recommended_target_stock: number | null
  manual_min_stock: number | null
  manual_target_stock: number | null
  effective_min_stock: number | null
  effective_target_stock: number | null
  daily_avg: number | null
  seasonal_factor: number | null
  weeks_of_history: number | null
  distinct_wz_days: number | null
}

export type AlertThresholds = {
  critical_days: number
  warning_days: number
  observation_days: number
}

export type WarehouseSubTab =
  | 'Komponenty'
  | 'Stany'
  | 'Receptury'
  | 'Ruchy'
  | 'Przyjęcia'
  | 'Przesunięcia'
  | 'Miesięczne zużycie'
  | 'Prognozy'
  | 'Alerty'
  | 'Zamówienia'
  | 'Zamawianie'
  | 'Inwentaryzacja'

export type InventorySession = {
  id: number
  status: 'open' | 'closed'
  counted_date: string
  notes: string | null
  created_by: string | null
  created_at: string
  closed_by: string | null
  closed_at: string | null
}

export type InventoryLine = {
  id: number
  session_id: number
  component_id: number
  system_qty: number
  counted_qty: number | null
  notes: string | null
  // joined from warehouse_components
  component_name?: string
  component_unit?: string
  component_code?: string | null
}

export type ShoppingListItem = {
  component_id: number
  component_name: string
  component_code: string
  supplier_id: number | null
  supplier_name: string | null
  quantity: number
  units_per_pallet: number | null
  pallets_per_full_tir: number | null
  current_stock: number
  min_stock_level: number | null
  target_stock_level: number | null
}

export type PurchaseOrder = {
  id: number
  zd_number: string
  supplier_id: number
  status: 'draft' | 'sent' | 'partial' | 'completed' | 'cancelled'
  expected_delivery_date: string | null
  sent_at: string | null
  sent_by: string | null
  received_at: string | null
  notes: string | null
  created_at: string
  created_by: string | null
}

export type PurchaseOrderItem = {
  id: number
  purchase_order_id: number
  component_id: number
  quantity_ordered: number
  quantity_received: number
  status_per_item: 'pending' | 'partial' | 'completed' | 'cancelled'
  notes: string | null
  created_at: string
}

export type ForecastRun = {
  id: number
  component_id: number
  run_at: string
  forecast_json: Array<{
    year: number
    month: number
    forecast_qty: number
    baseline: number
    seasonal_factor: number
    insufficient_data: boolean
  }>
  baseline_qty: number
  historical_months_used: number
  current_stock_total: number
}

export type ConsumptionHistoryPoint = {
  year: number
  month: number
  consumed: number
  returned: number
  received: number
  net_consumption: number
  outlier_removed: boolean
  insufficient_data: boolean
}

export type MonthlyConsumptionRow = {
  r_component_id: number
  r_component_code: string
  r_component_name: string
  r_component_unit: string
  r_component_category: string | null
  r_month: string
  r_net_consumption: number
}

export type MonthlyConsumptionPivot = {
  component_id: number
  component_code: string
  component_name: string
  component_unit: string
  component_category: string | null
  byMonth: Record<string, number>
  total: number
  average: number
}

export type WarehouseComponent = {
  id: number
  code: string | null
  name: string
  unit: string
  category?: string | null
  supplier_id?: number | null
  units_per_pallet?: number | null
  pallets_per_full_tir?: number | null
  min_stock_level?: number | null
  target_stock_level?: number | null
  notes?: string | null
  is_active: boolean
  product_category: 'raw' | 'door_wing' | 'door_frame' | 'door_handle' | 'door_hinge_cover'
  door_model?: string | null
  door_size?: string | null
  door_direction?: 'L' | 'P' | null
  door_color?: string | null
  door_frame_type?: 'simple' | 'adjustable' | null
  door_frame_code?: string | null
  door_handle_shield?: string | null
}

export type WarehouseComponentCreateInput = {
  code: string
  name: string
  unit: string
  category?: string | null
  supplier_id?: number | null
  units_per_pallet?: number | null
  pallets_per_full_tir?: number | null
  min_stock_level?: number | null
  target_stock_level?: number | null
  notes?: string | null
  is_active: boolean
}

export type WarehouseComponentUpdateInput = {
  code: string
  name: string
  unit: string
  category?: string | null
  supplier_id?: number | null
  units_per_pallet?: number | null
  pallets_per_full_tir?: number | null
  min_stock_level?: number | null
  target_stock_level?: number | null
  notes?: string | null
}

export type RecipePart =
  | 'wing'
  | 'frame'
  | 'hardware'
  | 'fittings'
  | 'handle'
  | 'peephole'
  | 'electric_strike'
  | 'glazing'
  | 'decorative_panel'
  | 'other'

export type WarehouseRecipeComponent = {
  id?: number
  recipe_id?: number
  component_id: number
  quantity: number
  notes?: string | null
}

export type RecipeFormState = {
  id?: number
  name: string
  category: string
  part: RecipePart
  system: string
  model: string
  wing_color: string
  frame_color: string
  width: string
  glazing: string
  direction: string
  decorative_panel: string
  hardware: string
  handle: string
  peephole: string
  electric_strike: string
  is_active: boolean
  notes: string
  components: WarehouseRecipeComponent[]
}

export type WarehouseRecipe = {
  id: number
  name: string | null
  category: string
  part: RecipePart
  system: string | null
  model: string | null
  wing_color: string | null
  frame_color: string | null
  width: string | null
  glazing: string | null
  direction: string | null
  decorative_panel: string | null
  hardware: string | null
  handle: string | null
  peephole: string | null
  electric_strike: string | null
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
  components_count?: number
}
