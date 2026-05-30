import {
  BASTION_STAGE_DEFS,
  DEPARTMENT_LABELS,
  DISTING_PLUS_MIRROR_KEYS,
  RECIPE_PARTS,
  STA_DISTING_PLUS_MIRROR_KEYS,
  STA_DISTING_STAGE_DEFS,
  ST_STAGE_DEFS,
  ST_TITAN_STAGE_DEFS,
  TABS,
} from './constants'
import { supabase } from './supabaseClient'
import type {
  BastionOrderFormData,
  Complaint,
  ConfigOptionRecord,
  ConfigExclusion,
  CurrentUser,
  DimensionMap,
  GlassAllowance,
  NewOrderFormData,
  Order,
  RecipeFormState,
  OrderExtraFields,
  ProfileDepartment,
  StageDef,
  StaOrderFormData,
  StOrderFormData,
  StStageCellKind,
  StStageLayoutMode,
  TechniczneOrderFormData,
  WhatComplained,
} from './types'

export function normalizeProfileDepartment(role: string, raw: unknown): ProfileDepartment {
  if (role === 'manager') return 'all'
  const s = String(raw ?? '').toLowerCase()
  if (s === 'bastion') return 'bastion'
  if (s === 'stalowe') return 'stalowe'
  if (s === 'magazyn') return 'magazyn'
  return 'all'
}

export const ROLE_LABELS: Record<string, string> = {
  manager: 'Kierownik',
  worker: 'Pracownik',
  sprzedawca: 'Sprzedawca',
}

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role
}

export function tabsForUserDepartment(
  dept: ProfileDepartment,
  isMgr: boolean,
  role?: string,
): (typeof TABS)[number][] {
  const roleNormalized = String(role ?? '').toLowerCase()
  const seesAllOrderCategories = isMgr || roleNormalized === 'manager' || roleNormalized === 'sprzedawca'
  let orderTabs: (typeof TABS)[number][]
  if (seesAllOrderCategories) {
    orderTabs = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne']
  } else if (dept === 'bastion') {
    orderTabs = ['Bastion']
  } else if (dept === 'stalowe') {
    orderTabs = ['STA', 'Disting', 'ST', 'Techniczne']
  } else if (dept === 'magazyn') {
    orderTabs = ['DrzwiWewnetrzne']
  } else if (dept === 'all') {
    orderTabs = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne']
  } else {
    orderTabs = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne']
  }
  const managerOnlyTabs = isMgr ? (['Statystyki', 'Weryfikacja', 'Audyt', 'Archiwum', 'Wysyłka'] as const) : []
  let result: (typeof TABS)[number][] = [...orderTabs, ...managerOnlyTabs, 'Magazyn']
  if (isMgr) {
    result = [...result, 'Kontrahenci', 'Konfiguracja', 'Użytkownicy', 'Klucze API']
  }
  if (role === 'worker' || role === 'manager') {
    result = ['Moje stanowisko', ...result]
  }
  return result
}

export function profileRoleLabel(role: string): string {
  return roleLabel(role)
}

export function canEditBastionSalesChanges(currentUser: CurrentUser | null): boolean {
  if (!currentUser) return false
  return currentUser.role === 'manager' || currentUser.role === 'sprzedawca'
}

export function profileDepartmentLabel(department: string, role: string): string {
  if (role === 'manager' || department === 'all') return 'Wszystkie'
  return DEPARTMENT_LABELS[department] ?? 'KR CENTER'
}

export function getComplaintBlockedStages(
  category: string,
  whatComplained: WhatComplained | '',
  linkedComplaintId?: number | null,
): string[] {
  if (linkedComplaintId != null) {
    if (category === 'STA') {
      return ['e1', 'e2_1', 'e2_2']
    }
    if (category === 'Disting') {
      return ['e3', 'e4', 'e5']
    }
  }

  if (whatComplained === 'Komplet' || whatComplained === '') return []

  const frameStageKeys: Record<string, string[]> = {
    STA: ['e1', 'e2_1', 'e2_2'],
    Disting: ['e1', 'e2_1', 'e2_2'],
    Bastion: ['e1', 'e2_1', 'e2_2'],
    ST: ['cnc', 'osc'],
    Techniczne: [],
  }
  const wingStageKeys: Record<string, string[]> = {
    STA: ['e3', 'e4', 'e5'],
    Disting: ['e3', 'e4', 'e5'],
    Bastion: ['e3', 'e4', 'e5'],
    ST: ['skr', 'mon', 'mag'],
    Techniczne: [],
  }

  if (whatComplained === 'Skrzydło') return frameStageKeys[category] ?? []
  if (whatComplained === 'Ościeżnica') return wingStageKeys[category] ?? []
  return []
}

export async function generateComplaintNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const { data } = await supabase
    .from('complaints')
    .select('complaint_number')
    .ilike('complaint_number', `RK/${year}/%`)
    .order('complaint_number', { ascending: false })
    .limit(1)
  const last = data?.[0]?.complaint_number
  const lastNum = last ? parseInt(last.split('/')[2] ?? '0', 10) : 0
  const next = String(lastNum + 1).padStart(3, '0')
  return `RK/${year}/${next}`
}

export function isStTitanOrder(order: Order): boolean {
  if (order.category !== 'ST') return false
  if (order.linked_order_id != null) return true
  const sys = String(order.system ?? '').toUpperCase()
  return sys.includes('CORE') || sys.includes('GUARD RC2') || sys.includes('GUARD RC3')
}

export function isStTitanComplaint(c: Complaint): boolean {
  if (c.category !== 'ST') return false
  const sys = String(c.system ?? '').toUpperCase()
  return sys.includes('CORE') || sys.includes('GUARD RC2') || sys.includes('GUARD RC3')
}

export function isStaTitanLinked(order: Order, allOrders: Order[]): boolean {
  if (order.category !== 'STA') return false
  if (order.linked_order_id == null) return false
  const partner = allOrders.find((o) => o.id === order.linked_order_id)
  if (!partner) return false
  return partner.category === 'ST'
}

export function isStTitanSystemLabel(system: string): boolean {
  return String(system ?? '').toUpperCase().includes('TITAN')
}

export function stStageCellKind(
  def: StageDef,
  isTitan: boolean,
  layoutMode: StStageLayoutMode,
): StStageCellKind {
  if (layoutMode === 'titan') {
    if (def.key === 'e2') return { kind: 'e2_sta', stageKey: 'sta_e5' }
    return { kind: 'click', stageKey: def.key }
  }
  if (layoutMode === 'std') {
    return { kind: 'click', stageKey: def.key }
  }
  switch (def.key) {
    case 'st_mix_0':
      return isTitan ? { kind: 'click', stageKey: 'e1' } : { kind: 'click', stageKey: 'cnc' }
    case 'st_mix_1':
      return isTitan ? { kind: 'e2_sta', stageKey: 'sta_e5' } : { kind: 'click', stageKey: 'osc' }
    case 'st_mix_2':
      return isTitan ? { kind: 'click', stageKey: 'e3' } : { kind: 'click', stageKey: 'skr' }
    case 'st_mix_3':
      return isTitan ? { kind: 'click', stageKey: 'e4' } : { kind: 'click', stageKey: 'mon' }
    case 'st_mix_4':
      return { kind: 'click', stageKey: 'mag' }
    default:
      return { kind: 'none' }
  }
}

export function getOrderStageDefinitions(tab: string): StageDef[] {
  if (tab === 'STA' || tab === 'Disting') return STA_DISTING_STAGE_DEFS
  if (tab === 'ST') return ST_STAGE_DEFS
  if (tab === 'Bastion') return BASTION_STAGE_DEFS
  if (tab === 'Techniczne' || tab === 'DrzwiWewnetrzne') return []
  return []
}

export function allProductionStageKeysForCategory(category: string): string[] {
  const base = getOrderStageDefinitions(category).map((d) => d.key)
  if (category === 'STA') return [...base, ...STA_DISTING_PLUS_MIRROR_KEYS]
  if (category === 'Disting') return [...base, ...DISTING_PLUS_MIRROR_KEYS]
  if (category === 'ST') {
    const std = ST_STAGE_DEFS.map((d) => d.key)
    const titan = ['e1', 'e2', 'e3', 'e4', 'sta_e5']
    return [...new Set([...std, ...titan])]
  }
  if (category === 'Techniczne' || category === 'DrzwiWewnetrzne') return []
  return base
}

export function getTableStageDefinitions(category: string): StageDef[] {
  if (category === 'Bastion') return BASTION_STAGE_DEFS
  return getOrderStageDefinitions(category)
}

export function staDistingPlusMirrorStorageKey(
  stageColKey: string,
): 'dist_e1' | 'dist_e2_1' | 'dist_e2_2' | null {
  if (stageColKey === 'e1') return 'dist_e1'
  if (stageColKey === 'e2_1') return 'dist_e2_1'
  if (stageColKey === 'e2_2') return 'dist_e2_2'
  return null
}

export function staDistingPlusMirrorTitle(stageColKey: string): string {
  if (stageColKey === 'e1') return 'Etap z arkusza Disting (E1)'
  if (stageColKey === 'e2_1') return 'Etap z arkusza Disting (E2.1)'
  if (stageColKey === 'e2_2') return 'Etap z arkusza Disting (E2.2)'
  return ''
}

export function staTitanMirrorStorageKey(stageColKey: string): 'e1' | 'e2' | null {
  if (stageColKey === 'e1') return 'e1'
  if (stageColKey === 'e2_1') return 'e2'
  return null
}

export function staTitanMirrorTitle(stageColKey: string): string {
  if (stageColKey === 'e1') return 'Etap z arkusza ST (E1 — ościeżnica)'
  if (stageColKey === 'e2_1') return 'Etap z arkusza ST (E2 — skrzydło odebrane)'
  return ''
}

export function distingPlusMirrorTitle(stageColKey: string): string {
  if (stageColKey === 'e3') return 'Etap z arkusza STA (E3)'
  if (stageColKey === 'e4') return 'Etap z arkusza STA (E4)'
  if (stageColKey === 'e5') return 'Etap z arkusza STA (E5)'
  return ''
}

export function orderAddonAbsentForE22Lock(value: unknown): boolean {
  if (value == null) return true
  const s = String(value).trim()
  return s === '' || s.toUpperCase() === 'NIE'
}

export function isE22StageLockedNoAddons(order: Order): boolean {
  if (order.category !== 'STA' && order.category !== 'Disting') return false
  return orderAddonAbsentForE22Lock(order.top_light) && orderAddonAbsentForE22Lock(order.side_panel)
}

export function createEmptyProductionStages(tab: string): Record<string, string> {
  const o: Record<string, string> = {}
  for (const k of allProductionStageKeysForCategory(tab)) {
    o[k] = ''
  }
  return o
}

export function productionStagesFromLegacyStageFormFields(
  category: 'STA' | 'Disting',
  fields: {
    stage1?: string
    stage2_1?: string
    stage2_2?: string
    stage3?: string
    stage4?: string
    stage5?: string
  },
  baseline: Record<string, string> | null,
): Record<string, string> {
  const base = baseline ?? createEmptyProductionStages(category)
  return {
    ...base,
    e1: fields.stage1 ?? '',
    e2_1: fields.stage2_1 ?? '',
    e2_2: fields.stage2_2 ?? '',
    e3: fields.stage3 ?? '',
    e4: fields.stage4 ?? '',
    e5: fields.stage5 ?? '',
  }
}

export function formatTodayDDMMYYYY(): string {
  const d = new Date()
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}.${mm}.${yyyy}`
}

export function isReleaseDateEmpty(value: string | null | undefined): boolean {
  return value == null || String(value).trim() === ''
}

export function orderCellTooltip(value: unknown): string | undefined {
  const s = value == null ? '' : String(value).trim()
  return s === '' ? undefined : s
}

export function orderNumberCellTooltip(
  order: Order,
  partnerCancelBadgeLabel: string | null,
  rowReleased: boolean,
): string | undefined {
  const parts: string[] = []
  if (partnerCancelBadgeLabel) parts.push(partnerCancelBadgeLabel)
  if (rowReleased) parts.push('ZREALIZOWANE')
  parts.push(`Nr zlecenia: ${order.order_number}`)
  return parts.join(' · ')
}

export function parseOrderExtraFields(raw: unknown): OrderExtraFields {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const o = raw as Record<string, unknown>
  return {
    disting_cancelled: Boolean(o.disting_cancelled),
    sta_cancelled: Boolean(o.sta_cancelled),
    cancelled: Boolean(o.cancelled),
    cancelled_at: typeof o.cancelled_at === 'string' ? o.cancelled_at : undefined,
    cancelled_by: typeof o.cancelled_by === 'string' ? o.cancelled_by : undefined,
  }
}

export function mergeOrderExtraFields(
  raw: unknown,
  patch: Partial<OrderExtraFields>,
): Record<string, unknown> {
  const base =
    raw != null && typeof raw === 'object' && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {}
  return { ...base, ...patch }
}

export function parseProductionStages(raw: unknown, tab: string): Record<string, string> {
  const merged = createEmptyProductionStages(tab)
  let parsed: Record<string, unknown> = {}
  if (raw == null) {
    return merged
  }
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return merged
    }
  } else if (typeof raw === 'object' && !Array.isArray(raw)) {
    parsed = raw as Record<string, unknown>
  }
  for (const key of Object.keys(merged)) {
    const v = parsed[key]
    merged[key] = typeof v === 'string' ? v : ''
  }
  if (tab === 'STA') {
    const legacy = parsed['dist_e2']
    if (typeof legacy === 'string' && legacy.trim() && !(merged.dist_e2_1 ?? '').trim()) {
      merged.dist_e2_1 = legacy
    }
  }
  return merged
}

export function countCompletedStages(order: Order): {
  completed: number
  total: number
  percent: number
  stages: Array<{ key: string; header: string; title: string; done: boolean }>
} {
  const category = order.category ?? ''

  if (category === 'Techniczne' || category === 'DrzwiWewnetrzne') {
    return { completed: 0, total: 0, percent: 0, stages: [] }
  }

  let defs: StageDef[] = []
  if (category === 'STA' || category === 'Disting') {
    defs = STA_DISTING_STAGE_DEFS
  } else if (category === 'Bastion') {
    defs = BASTION_STAGE_DEFS
  } else if (category === 'ST') {
    defs = isStTitanOrder(order) ? ST_TITAN_STAGE_DEFS : ST_STAGE_DEFS
  }

  const parsed = parseProductionStages(order.production_stages, category)

  const stages = defs.map((def) => ({
    key: def.key,
    header: def.header,
    title: def.title ?? '',
    done: parsed[def.key] === 'T',
  }))

  const completed = stages.filter((s) => s.done).length
  const total = stages.length
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0

  return { completed, total, percent, stages }
}

export function isOrderReadyToInvoice(order: Order): boolean {
  const extra = order.extra_fields as Record<string, unknown> | null
  return extra?.ready_to_invoice === true
}

export function autoSuggestReadyToInvoice(order: Order): boolean {
  const { percent, total } = countCompletedStages(order)
  if (percent === 100 && total > 0) return true
  if (order.release_date && !isReleaseDateEmpty(order.release_date)) return true
  return false
}

export function isFieldValueExcluded(
  exclusions: ConfigExclusion[],
  category: string,
  currentFormData: Record<string, unknown>,
  targetField: string,
  targetValue: string,
): boolean {
  return exclusions.some((ex) => {
    if (ex.category !== category) return false

    const forwardMatch =
      ex.target_field === targetField &&
      ex.target_value === targetValue &&
      currentFormData[ex.source_field] === ex.source_value

    const reverseMatch =
      ex.source_field === targetField &&
      ex.source_value === targetValue &&
      currentFormData[ex.target_field] === ex.target_value

    return forwardMatch || reverseMatch
  })
}

export function validateOrderForm(category: string, formData: Record<string, unknown>): string[] {
  const commonFields = [
    'company',
    'system',
    'model',
    'wing_color',
    'width',
    'direction',
    'opening',
    'height',
  ]
  const baseRequired = [
    ...commonFields,
    'frame_color',
    'threshold_color',
    'glazing',
    'hardware',
    'handle',
  ]
  const staRequired = [...baseRequired]
  if (formData.top_light_h_mm?.toString().trim()) staRequired.push('top_light_glazing')
  if (formData.side_panel_a_w_mm?.toString().trim()) staRequired.push('side_panel_a_glazing')
  if (formData.side_panel_b_w_mm?.toString().trim()) staRequired.push('side_panel_b_glazing')

  const fieldsByCategory: Record<string, string[]> = {
    STA: staRequired,
    Disting: staRequired,
    Bastion: [
      ...commonFields,
      'frame_color',
      'threshold_color',
      'glazing',
      'hardware',
      'handle',
    ],
    ST: [
      'company',
      'system',
      'model',
      'wing_color',
      'width',
      'direction',
      'opening',
      'height',
      'glazing',
      'hardware',
      'handle',
    ],
    Techniczne: [
      'company',
      'system',
      'model',
      'wing_color',
      'width',
      'direction',
      'opening',
      'height',
    ],
  }

  const required = fieldsByCategory[category] ?? commonFields

  return required.filter((field) => {
    const val = formData[field]
    if (val === undefined || val === null) return true
    if (typeof val === 'string') return val.trim() === ''
    return false
  })
}

export function mapConfigTypeToFormField(type: string): string | null {
  if (type === 'system') return 'system'
  if (type === 'model') return 'model'
  if (type === 'kolor') return 'wing_color'
  if (type === 'kolor-oscieznicy' || type === 'kolor_oscieznicy') return 'frame_color'
  if (type === 'kolor_progu') return 'threshold_color'
  if (type === 'prog') return 'threshold_color'
  if (type === 'rozmiar') return 'width'
  if (type === 'wysokosc') return 'height'
  if (type === 'szklenie') return 'glazing'
  if (type === 'wizjer') return 'peephole'
  if (type === 'okucia') return 'hardware'
  if (type === 'pochwyt') return 'handle'
  if (type === 'oslonki') return 'oslonki'
  if (type === 'zaczep') return 'zaczep'
  if (type === 'panel') return 'decorative_panel'
  if (type === 'oscieznica') return 'frame_type'
  if (type === 'zakres') return 'frame_range'
  if (type === 'kolekcja') return 'collection'
  return null
}

export function applyDefaultConfigValues<T extends Record<string, unknown>>(
  baseFormData: T,
  category: string,
  allDefaults: ConfigOptionRecord[],
): T {
  const defaultsForCategory = allDefaults.filter((o) => o.category === category && o.is_default)
  const next = { ...baseFormData } as Record<string, unknown>
  defaultsForCategory.forEach((def) => {
    const fieldName = mapConfigTypeToFormField(def.type)
    if (!fieldName || !(fieldName in next)) return
    next[fieldName] = def.value
  })
  return next as T
}

export function splitWxH(value: string): { w: string; h: string } {
  const s = (value || '').trim()
  if (!s) return { w: '', h: '' }
  const parts = s.split(/[×x]/i)
  if (parts.length >= 2) {
    return { w: parts[0].trim(), h: parts[1].trim() }
  }
  return { w: '', h: '' }
}

export function getDimensions(
  map: DimensionMap[],
  category: string,
  code: string,
): { width_mm: number; height_mm: number } {
  const codeUpper = code.trim().toUpperCase()
  const match = map.find(
    (m) => m.category === category && codeUpper.includes(m.dimension_code.toUpperCase()),
  )
  return {
    width_mm: match?.width_mm ?? 0,
    height_mm: match?.height_mm ?? 2080,
  }
}

export function calcExtensionDims(
  width: string,
  height: string,
  category: string,
  dimMap: DimensionMap[],
): {
  sideDim: string
  topDim: string
} {
  const heightUpper = height.trim().toUpperCase()
  const dims = getDimensions(
    dimMap,
    category,
    heightUpper === 'STD' || !height.trim() ? 'STD' : width,
  )
  const sideDim =
    heightUpper === 'STD' || !height.trim()
      ? String(dims.height_mm)
      : height.trim().replace(/[^0-9]/g, '')

  const widthDims = getDimensions(dimMap, category, width)
  const topDim = widthDims.width_mm ? String(widthDims.width_mm) : width.trim().replace(/[^0-9]/g, '')

  return { sideDim, topDim }
}

export function calcGlassDim(
  totalW: number,
  totalH: number,
  allowanceW: number,
  allowanceH: number,
): string {
  if (!totalW && !totalH) return ''
  const glassW = totalW - allowanceW
  const glassH = totalH - allowanceH
  return `${glassW}×${glassH}`
}

export function getGlassAllowance(
  allowances: GlassAllowance[],
  category: string,
  element: string,
): { w: number; h: number } {
  const found = allowances.find((a) => a.category === category && a.element === element)
  return {
    w: found?.allowance_w_mm ?? 10,
    h: found?.allowance_h_mm ?? 10,
  }
}

export function glassPartToAllowanceKey(part: string): 'top_light' | 'side_panel' | null {
  if (part === 'top_light_glass') return 'top_light'
  if (part === 'side_panel_a_glass' || part === 'side_panel_b_glass') return 'side_panel'
  return null
}

export function calcGlassIssueDim(
  issue: { part: string; raw_dim?: string },
  category: string,
  glassAllowances: GlassAllowance[],
): { rawDim: string; glassDim: string } | null {
  if (!issue.raw_dim) return null
  const allowKey = glassPartToAllowanceKey(issue.part)
  if (!allowKey) return null

  const parts = String(issue.raw_dim).split('×')
  const w = parseInt(parts[0] ?? '0') || 0
  const h = parseInt(parts[1] ?? '0') || 0
  if (!w || !h) return null

  const allowance = getGlassAllowance(glassAllowances, category, allowKey)
  const glassDim = calcGlassDim(w, h, allowance.w, allowance.h)

  return {
    rawDim: `${w}×${h}`,
    glassDim,
  }
}

export function getProfileWidth(
  profiles: { category: string; profile_width_mm: number }[],
  category: string,
): number {
  return profiles.find((p) => p.category === category)?.profile_width_mm ?? 50
}

export function getExtQty(
  qtys: Record<string, Record<string, number>>,
  side: string,
  profileWidth: number,
): number {
  return qtys[side]?.[String(profileWidth)] ?? 0
}

export function setExtQty(
  qtys: Record<string, Record<string, number>>,
  side: string,
  profileWidth: number,
  value: number,
): Record<string, Record<string, number>> {
  return {
    ...qtys,
    [side]: {
      ...(qtys[side] ?? {}),
      [String(profileWidth)]: value,
    },
  }
}

export function isExtSideActive(qtys: Record<string, Record<string, number>>, side: string): boolean {
  return Object.values(qtys[side] ?? {}).some((v) => v > 0)
}

export function calcTopLightWidth(
  formData: StaOrderFormData,
  category: string,
  dimMap: DimensionMap[],
): string {
  const dims = getDimensions(dimMap, category, formData.width)
  if (!dims.width_mm) return ''

  let total = dims.width_mm
  total += parseInt(formData.side_panel_a_w_mm) || 0
  total += parseInt(formData.side_panel_b_w_mm) || 0

  const aQtys = formData.extension_qtys?.['a'] ?? {}
  const bQtys = formData.extension_qtys?.['b'] ?? {}

  let extensionTotal = 0
  for (const [w, qty] of Object.entries(aQtys)) {
    extensionTotal += qty * parseInt(w)
  }
  for (const [w, qty] of Object.entries(bQtys)) {
    extensionTotal += qty * parseInt(w)
  }
  total += extensionTotal

  return String(total)
}

export function calcSidePanelHeight(
  formData: StaOrderFormData,
  category: string,
  dimMap: DimensionMap[],
): string {
  const heightUpper = formData.height.trim().toUpperCase()
  const dims = getDimensions(dimMap, category, heightUpper === 'STD' ? 'STD' : formData.height)

  const baseHeight =
    heightUpper === 'STD' || !formData.height.trim()
      ? dims.height_mm
      : parseInt(formData.height.replace(/[^0-9]/g, '')) || dims.height_mm

  return String(baseHeight)
}

export function isRushOrderSequence(sequence: string | undefined | null): boolean {
  return String(sequence ?? '').trim().toUpperCase() === 'X'
}

export function supabaseNumericFromForm(value: unknown): number | null {
  if (value === '' || value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function sanitizeOrderPayloadForDb<T extends Record<string, unknown>>(payload: T): T {
  const out = { ...payload } as Record<string, unknown>
  if ('configurator_value' in out) {
    out.configurator_value = supabaseNumericFromForm(out.configurator_value)
  }
  if ('quantity' in out) {
    out.quantity = supabaseNumericFromForm(out.quantity)
  }
  return out as T
}

export function orderMetaForUpdate(o: Order): Record<string, unknown> {
  return {
    order_number: o.order_number,
    sequence: o.sequence,
    order_date: o.order_date,
    production_stages: o.production_stages,
    release_date: o.release_date,
    disting_sheet: o.disting_sheet,
    sta_sheet: o.sta_sheet,
    sta_ref: o.sta_ref ?? '',
    st_sheet: o.st_sheet ?? '',
    linked_order_id: o.linked_order_id,
    defects: o.defects,
    entered_by: o.entered_by,
    configurator_value: supabaseNumericFromForm(o.configurator_value),
    info: o.info,
    airtable_id: o.airtable_id,
    label: o.label,
    category: o.category,
    electric_strike: o.electric_strike,
    oslonki: o.oslonki,
    zaczep: o.zaczep,
    podwalina_1: o.podwalina_1,
    podwalina_1_qty: o.podwalina_1_qty,
    podwalina_2: o.podwalina_2,
    podwalina_2_qty: o.podwalina_2_qty,
  }
}

export function orderToStaForm(order: Order): StaOrderFormData {
  const top = splitWxH(order.top_light)
  const sideA = splitWxH(order.side_panel_a ?? order.side_panel ?? '')
  const sideB = splitWxH(order.side_panel_b ?? '')
  const st = parseProductionStages(order.production_stages, order.category)
  return {
    order_number: order.order_number ?? '',
    category: order.category ?? 'STA',
    company: order.company ?? '',
    production_day: order.production_day || 'PONIEDZIAŁEK',
    system: order.system ?? '',
    model: order.model ?? '',
    wing_color: order.wing_color ?? '',
    frame_color: order.frame_color ?? '',
    threshold_color: order.threshold_color ?? '',
    width: order.width ?? '',
    direction: order.direction || 'PRAWE',
    height: order.height ?? '',
    opening: order.opening || 'ONZ',
    glazing: order.glazing ?? '',
    decorative_panel: order.decorative_panel ?? '',
    top_light_w_mm: top.w,
    top_light_h_mm: top.h,
    top_light_glazing: order.top_light_glazing ?? '',
    side_panel_a_w_mm: sideA.w,
    side_panel_b_w_mm: sideB.w,
    side_panel_h_mm: sideA.h || sideB.h,
    side_panel_a_glazing: order.side_panel_a_glazing ?? order.side_panel_glazing ?? '',
    side_panel_b_glazing: order.side_panel_b_glazing ?? '',
    extension: order.extension ?? '',
    extension_qtys: (() => {
      const raw = order.extension_qtys
      if (raw && typeof raw === 'object') return raw as Record<string, Record<string, number>>
      return { a: {}, b: {}, top: {} }
    })(),
    peephole: order.peephole ?? '',
    hardware: order.hardware ?? '',
    handle: order.handle ?? '',
    oslonki: order.oslonki ?? '',
    zaczep: order.zaczep ?? '',
    stage1: st.e1 ?? '',
    stage2_1: st.e2_1 ?? '',
    stage2_2: st.e2_2 ?? '',
    stage3: st.e3 ?? '',
    stage4: st.e4 ?? '',
    stage5: st.e5 ?? '',
    quantity: Number(order.quantity) || 1,
    notes: order.notes ?? '',
    client_order_number: order.client_order_number ?? '',
  }
}

export function orderToStForm(order: Order): StOrderFormData {
  return {
    order_number: order.order_number ?? '',
    category: order.category ?? 'ST',
    company: order.company ?? '',
    production_day: order.production_day || 'PONIEDZIAŁEK',
    system: order.system ?? '',
    model: order.model ?? '',
    wing_color: order.wing_color ?? '',
    threshold_color: order.threshold_color ?? '',
    width: order.width ?? '',
    direction: order.direction || 'PRAWE',
    height: order.height ?? '',
    opening: order.opening || 'ONZ',
    glazing: order.glazing ?? '',
    peephole: order.peephole ?? '',
    hardware: order.hardware ?? '',
    extension: order.extension ?? '',
    handle: order.handle ?? '',
    quantity: Number(order.quantity) || 1,
    notes: order.notes ?? '',
    client_order_number: order.client_order_number ?? '',
    sta_ref: String(order.sta_ref ?? '').trim(),
  }
}

export function orderToTechniczneForm(order: Order): TechniczneOrderFormData {
  return {
    order_number: order.order_number ?? '',
    category: order.category ?? 'Techniczne',
    company: order.company ?? '',
    production_day: order.production_day || 'PONIEDZIAŁEK',
    system: order.system ?? '',
    model: order.model ?? '',
    wing_color: order.wing_color ?? '',
    threshold_color: order.threshold_color ?? '',
    width: order.width ?? '',
    direction: order.direction || 'PRAWE',
    height: order.height ?? '',
    opening: order.opening || 'ONZ',
    glazing: order.glazing ?? '',
    peephole: order.peephole ?? '',
    hardware: order.hardware ?? '',
    handle: order.handle ?? '',
    quantity: Number(order.quantity) || 1,
    notes: order.notes ?? '',
    client_order_number: order.client_order_number ?? '',
  }
}

export function orderToBastionForm(order: Order): BastionOrderFormData {
  const bastion = order as Record<string, unknown>
  return {
    order_number: order.order_number ?? '',
    category: order.category ?? 'Bastion',
    company: order.company ?? '',
    production_day: order.production_day || 'PONIEDZIAŁEK',
    system: order.system ?? '',
    model: order.model ?? '',
    wing_color: order.wing_color ?? '',
    frame_color: order.frame_color ?? '',
    threshold_color: order.threshold_color ?? '',
    width: order.width ?? '',
    direction: order.direction || 'PRAWE',
    height: order.height ?? '',
    opening: order.opening || 'ONZ',
    glazing: order.glazing ?? '',
    peephole: order.peephole ?? '',
    hardware: order.hardware ?? '',
    quantity: Number(order.quantity) || 1,
    notes: order.notes ?? '',
    notes_2: String(bastion.bastion_notes_2 ?? order.info ?? ''),
    client_order_number: order.client_order_number ?? '',
    collection: String(bastion.bastion_collection ?? ''),
    frame_type: String(bastion.bastion_frame_type ?? order.decorative_panel ?? ''),
    frame_range: String(bastion.bastion_frame_range ?? order.extension ?? ''),
    sales_changes: String(bastion.bastion_sales_changes ?? ''),
    rush_date: String(bastion.bastion_rush_date ?? ''),
    day_of_week: String(bastion.bastion_day_of_week ?? ''),
    is_promo: Boolean(bastion.bastion_is_promo),
    is_production_rush: Boolean(bastion.bastion_is_production_rush),
    production_priority: String(bastion.bastion_production_priority ?? ''),
    label_qty: Number(bastion.bastion_label_qty) || 0,
  }
}

export function buildRecipeAutoName(form: RecipeFormState): string {
  const parts: string[] = []
  parts.push(form.category)
  const partLabel = RECIPE_PARTS.find((p) => p.value === form.part)?.label
  if (partLabel) parts.push(partLabel)
  const attrs = [
    form.system,
    form.model,
    form.wing_color,
    form.frame_color,
    form.width,
    form.direction,
    form.glazing,
    form.decorative_panel,
    form.hardware,
    form.handle,
    form.peephole,
    form.electric_strike,
  ].filter((v) => v && v.trim())
  parts.push(...attrs)
  return parts.join(' / ')
}

export function orderToLegacyForm(order: Order): NewOrderFormData {
  return {
    order_number: order.order_number ?? '',
    category: order.category ?? 'STA',
    company: order.company ?? '',
    order_date: order.order_date ?? '',
    production_day: order.production_day || 'PONIEDZIAŁEK',
    quantity: Number(order.quantity) || 1,
    sequence: order.sequence ?? '',
    system: order.system || 'NORMAL',
    model: order.model ?? '',
    wing_color: order.wing_color ?? '',
    frame_color: order.frame_color ?? '',
    threshold_color: order.threshold_color ?? '',
    width: order.width ?? '',
    direction: order.direction || 'PRAWE',
    opening: order.opening || 'ONZ',
    height: order.height ?? '',
    glazing: order.glazing ?? '',
    hardware: order.hardware ?? '',
    notes: order.notes ?? '',
    entered_by: order.entered_by ?? '',
  }
}
