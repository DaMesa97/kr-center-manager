import {
  BASTION_STAGE_DEFS,
  BASTION_TITAN_STAGE_DEFS,
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
import { can, isAdminRole, isCategoryScoped, isManagerRole } from './lib/permissions'
import type {
  BastionOrderFormData,
  Company,
  Complaint,
  ConfigOptionRecord,
  ConfigExclusion,
  CurrentUser,
  DimensionMap,
  GlassAllowance,
  LeadTimeRule,
  NewOrderFormData,
  Order,
  OrderAgeStatus,
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

// Magazyn wewnętrznych drzwi — rozpoznajemy po prefiksie kodu (WEWNETRZNE, WEW1, WEW2…)
export function isInternalWarehouseCode(code: string | null | undefined): boolean {
  return String(code ?? '').trim().toUpperCase().startsWith('WEW')
}

export const ROLE_LABELS: Record<string, string> = {
  // stare role (zgodność wsteczna)
  manager: 'Kierownik',
  worker: 'Pracownik',
  sprzedawca: 'Sprzedawca',
  // nowe role
  obsluga_klienta: 'Obsługa klienta',
  pracownik_produkcji: 'Pracownik produkcji',
  magazynier: 'Magazynier',
  kierownik_dzialu: 'Kierownik działu',
  kierownik_magazynu: 'Kierownik magazynu',
  kierownik_produkcji: 'Kierownik produkcji',
  kierownik_firmowy: 'Kierownik firmowy',
  admin: 'Administrator',
}

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role
}

/** Normalizuje nazwę firmy do porównań: małe litery, bez form prawnych, bez interpunkcji i nadmiarowych spacji */
export function normalizeCompanyName(s: string | null | undefined): string {
  if (!s) return ''
  return String(s)
    .toLowerCase()
    .replace(/sp\.?\s*z\.?\s*o\.?\s*o\.?/g, '') // sp. z o.o.
    .replace(/\bs\.?\s*c\.?\b/g, '')             // s.c.
    .replace(/\bs\.?\s*a\.?\b/g, '')             // s.a.
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Znajduje kontrahenta z bazy najlepiej pasującego do podanej nazwy. Null jeśli brak sensownego dopasowania. */
export function findBestCompanyMatch(input: string | null | undefined, companies: Company[]): Company | null {
  const norm = normalizeCompanyName(input)
  if (!norm || companies.length === 0) return null
  // 1) dokładne dopasowanie znormalizowane
  const exact = companies.find((c) => normalizeCompanyName(c.name) === norm)
  if (exact) return exact
  // 2) jedna nazwa zawiera drugą (min. 4 znaki, by uniknąć przypadków)
  if (norm.length >= 4) {
    const contains = companies.find((c) => {
      const cn = normalizeCompanyName(c.name)
      return cn.length >= 4 && (cn.includes(norm) || norm.includes(cn))
    })
    if (contains) return contains
  }
  return null
}

/**
 * Opcja ościeżnicy Bastion pasująca do typu z zlecenia. Dopasowanie przez
 * ZAWIERANIE (TRIM+UPPER): słownik ma nazwy ogólne ('REGULOWANA', 'ZABUDOWA'),
 * a zlecenia pełne ('DREWNIANA REGULOWANA', 'ZABUDOWA KĄTOWA') — spójnie
 * z match_bastion_frame_type w czasach realizacji. Przy wielu trafieniach
 * wygrywa najdłuższa (najbardziej szczegółowa) wartość słownika.
 */
// Normalizacja nazw ościeżnic: różne źródła (konfigurator/excel/formularz)
// piszą je różnie — wielkość liter, kropki w skrótach ('ZAB.OŚC.METAL.'),
// polskie znaki ('OŚC' vs 'OSC'), nadmiarowe spacje.
const normalizeBastionFrameName = (v: unknown): string =>
  String(v ?? '')
    .toUpperCase()
    .replace(/[ĄĆĘŁŃÓŚŹŻ]/g, (ch) => ('ACELNOSZZ'['ĄĆĘŁŃÓŚŹŻ'.indexOf(ch)] ?? ch))
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export function bastionFrameOptionForOrder<T extends { value: string }>(
  frameType: string | null | undefined,
  options: T[],
): T | null {
  const ft = normalizeBastionFrameName(frameType)
  if (!ft) return null
  let best: T | null = null
  let bestLen = 0
  for (const opt of options) {
    const v = normalizeBastionFrameName(opt.value)
    if (!v || !ft.includes(v)) continue
    if (!best || v.length > bestLen) {
      best = opt
      bestLen = v.length
    }
  }
  return best
}

/** Czy nazwa firmy odpowiada dokładnie (znormalizowanie) jakiemuś kontrahentowi z bazy */
export function isCompanyInBase(input: string | null | undefined, companies: Company[]): boolean {
  const norm = normalizeCompanyName(input)
  if (!norm) return false
  return companies.some((c) => normalizeCompanyName(c.name) === norm)
}

export function tabsForUserDepartment(
  dept: ProfileDepartment,
  isMgr: boolean,
  role?: string,
  categories?: string[],
): (typeof TABS)[number][] {
  const roleNormalized = String(role ?? '').toLowerCase()
  const LEGACY = roleNormalized === '' || roleNormalized === 'manager' || roleNormalized === 'worker' || roleNormalized === 'sprzedawca'

  // ── NOWE role: widoczność wprost z uprawnień (can) + przypisanych kategorii ──
  if (!LEGACY) {
    const allCats: (typeof TABS)[number][] = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne']
    const orderTabs: (typeof TABS)[number][] = isCategoryScoped(role)
      ? (allCats.filter((c) => (categories ?? []).includes(c)))
      : allCats
    const out: (typeof TABS)[number][] = []
    if (isManagerRole(role)) out.push('Pulpit')
    if (isManagerRole(role) || roleNormalized === 'pracownik_produkcji' || roleNormalized === 'magazynier') {
      out.push('Moje stanowisko')
    }
    out.push(...orderTabs)
    if (can(role, 'shipping.view')) out.push('Wysyłka')
    if (can(role, 'stats.view')) out.push('Statystyki')
    if (can(role, 'review.handle')) out.push('Weryfikacja')
    if (can(role, 'audit.view')) out.push('Audyt')
    if (isManagerRole(role)) out.push('Archiwum')
    if (can(role, 'warehouse.movements')) out.push('Magazyn')
    if (can(role, 'warehouse.ordering')) out.push('Zamawianie', 'Inwentaryzacja')
    if (isAdminRole(role)) out.push('Kontrahenci')
    out.push('Etykiety')
    if (isAdminRole(role)) out.push('Konfiguracja', 'Użytkownicy', 'Klucze API')
    out.push('Zgłoszenia', 'Pomoc')
    return out
  }

  // ── LEGACY (stare role) — zachowanie bez zmian (okres przejściowy) ──
  const seesAllOrderCategories =
    isMgr || roleNormalized === 'manager' || roleNormalized === 'sprzedawca'
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
  let result: (typeof TABS)[number][] = [...orderTabs, ...managerOnlyTabs, 'Magazyn', 'Zamawianie', 'Inwentaryzacja', 'Etykiety']
  if (isMgr) {
    result = [...result, 'Kontrahenci', 'Konfiguracja', 'Użytkownicy', 'Klucze API']
  }
  result = [...result, 'Zgłoszenia', 'Pomoc']
  if (isMgr || ['worker', 'manager', 'pracownik_produkcji', 'magazynier'].includes(roleNormalized)) {
    result = ['Moje stanowisko', ...result]
  }
  if (isMgr) {
    result = ['Pulpit', ...result]
  }
  return result
}

export function profileRoleLabel(role: string): string {
  return roleLabel(role)
}

export function canEditBastionSalesChanges(currentUser: CurrentUser | null): boolean {
  if (!currentUser) return false
  // kierownicy/admin (nowe role) + legacy manager/sprzedawca — bez tego po migracji
  // ról kolumna ZMIANY-SPRZEDAŻ stałaby się nieedytowalna dla wszystkich
  return isManagerRole(currentUser.role) || currentUser.role === 'sprzedawca'
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
      // E5 (pakowanie ościeżnicy) ROBI Disting — jak w zamówieniach.
      // Blokada e5 zamrażała plakietkę OŚC w STA na zawsze.
      return ['e3', 'e4']
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
  // RPC w SQL — numerycznie i bez wyścigów. Stare tekstowe sortowanie z
  // limit 1 po RK/{rok}/999 dawałoby każdej kolejnej reklamacji numer 1000.
  const { data, error } = await supabase.rpc('get_next_complaint_number')
  if (error || !data) {
    console.error(error)
    // awaryjnie: unikalny znacznik czasowy zamiast dubla
    return `RK/${new Date().getFullYear()}/${Date.now() % 100000}`
  }
  return String(data)
}

// Systemy Titana — JEDNA lista używana wszędzie (tworzenie pary, wyświetlanie, reklamacje).
// 'GUARD RC3' łapie też 'GUARD RC3 EI 30'. Realne systemy: CORE, GUARD RC2, GUARD RC3, GUARD RC3 EI 30.
export function isTitanSystem(system: string | null | undefined): boolean {
  const sys = String(system ?? '').toUpperCase()
  return sys.includes('CORE') || sys.includes('GUARD RC2') || sys.includes('GUARD RC3')
}

export function isStTitanOrder(order: Order): boolean {
  if (order.category !== 'ST') return false
  if (order.linked_order_id != null) return true
  return isTitanSystem(order.system)
}

export function isStTitanComplaint(c: Complaint): boolean {
  if (c.category !== 'ST') return false
  return isTitanSystem(c.system)
}

// Przyjmuje tablicę lub Map id→Order — gorące pętle (buildTasks po wszystkich
// zamówieniach) budują mapę raz zamiast robić find() per zamówienie (O(n²)).
export function isStaTitanLinked(order: Order, allOrders: Order[] | Map<number, Order>): boolean {
  if (order.category !== 'STA') return false
  if (order.linked_order_id == null) return false
  const partner =
    allOrders instanceof Map
      ? allOrders.get(order.linked_order_id)
      : allOrders.find((o) => o.id === order.linked_order_id)
  if (!partner) return false
  return partner.category === 'ST'
}

export function isStTitanSystemLabel(system: string): boolean {
  return isTitanSystem(system)
}

export function stStageCellKind(
  def: StageDef,
  isTitan: boolean,
  layoutMode: StStageLayoutMode,
): StStageCellKind {
  // Titan w ST: jedyny etap ekipy ST to OŚCIEŻNICA (E1). Skrzydło robi STA,
  // okuwanie/montaż/pakowanie robi Bastion → reszta etapów zablokowana.
  if (layoutMode === 'titan') {
    if (def.key === 'e1') return { kind: 'click', stageKey: 'e1' }
    return { kind: 'none' }
  }
  if (layoutMode === 'std') {
    return { kind: 'click', stageKey: def.key }
  }
  switch (def.key) {
    case 'st_mix_0':
      // CNC — dla Titana nieaktywne
      return isTitan ? { kind: 'none' } : { kind: 'click', stageKey: 'cnc' }
    case 'st_mix_1':
      // OŚC — dla Titana = ościeżnica (E1), jedyny etap ST
      return isTitan ? { kind: 'click', stageKey: 'e1' } : { kind: 'click', stageKey: 'osc' }
    case 'st_mix_2':
      // SKR — dla Titana nieaktywne (skrzydło robi STA)
      return isTitan ? { kind: 'none' } : { kind: 'click', stageKey: 'skr' }
    case 'st_mix_3':
      // MON — dla Titana nieaktywne (montaż na Bastionie)
      return isTitan ? { kind: 'none' } : { kind: 'click', stageKey: 'mon' }
    case 'st_mix_4':
      // MAG — dla Titana nieaktywne
      return isTitan ? { kind: 'none' } : { kind: 'click', stageKey: 'mag' }
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
  if (category === 'Bastion') {
    // standardowe etapy + etapy Titana (okuwanie/montaż/pakowanie)
    return [...base, ...BASTION_TITAN_STAGE_DEFS.map((d) => d.key)]
  }
  if (category === 'Techniczne' || category === 'DrzwiWewnetrzne') return []
  return base
}

// Czy rekord Bastion to "noga" Titana (powstał z STA Titan, ma titan_group)
export function isTitanBastionOrder(order: Order): boolean {
  if (order.category !== 'Bastion') return false
  const g = (order.extra_fields as Record<string, unknown> | null)?.titan_group
  return g != null && Number(g) > 0
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
  // JEDNO kryterium "ma szklany dodatek" dla tabeli i stanowiska —
  // stara wersja pomijała side_panel_a/b: zlecenie tylko z dostawką A miało
  // e2_2 zablokowane w tabeli, a na stanowisku dostawało zadanie
  return !hasGlassExtra(order)
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
    defs = isTitanBastionOrder(order) ? BASTION_TITAN_STAGE_DEFS : BASTION_STAGE_DEFS
  } else if (category === 'ST') {
    defs = isStTitanOrder(order) ? ST_TITAN_STAGE_DEFS : ST_STAGE_DEFS
  }

  const parsed = parseProductionStages(order.production_stages, category)

  // Etap szklenia dostawki/naświetla (e2_2) jest "z automatu" zrobiony,
  // gdy zamówienie nie ma ani dostawki, ani naświetla — nie ma czego robić.
  const noGlassExtra = (category === 'STA' || category === 'Disting') && !hasGlassExtra(order)

  // Etap zrobiony = dowolna niepusta wartość (inicjały pracownika, 'T' lub 'X' z migracji) —
  // spójnie z komórkami tabeli, które każdą niepustą wartość traktują jako wykonany etap.
  const stages = defs.map((def) => ({
    key: def.key,
    header: def.header,
    title: def.title ?? '',
    done: String(parsed[def.key] ?? '').trim() !== '' || (def.key === 'e2_2' && noGlassExtra),
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
  const parts = s.split(/[×x*]/i)
  if (parts.length >= 2) {
    return { w: parts[0].trim(), h: parts[1].trim() }
  }
  // Pojedyncza liczba bez separatora — potraktuj jako szerokość (nie gub danych)
  return { w: parts[0].trim(), h: '' }
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

/**
 * Wymiar naświetla/dostawki "W×H" → [w, h] liczbowo (0 przy braku) — nakładka na
 * wspólny parser splitWxH (×/x/*). Łapie też "380 mm x 2081 mm" ze starych danych.
 * "NIE" → [0, 0]; sama liczba ("2080") → [2080, 0], czyli BRAK pełnego wymiaru.
 */
export function parseGlassDim(raw: unknown): [number, number] {
  const p = splitWxH(String(raw ?? ''))
  return [parseInt(p.w) || 0, parseInt(p.h) || 0]
}

export function calcGlassDim(
  totalW: number,
  totalH: number,
  allowanceW: number,
  allowanceH: number,
): string {
  if (!totalW && !totalH) return ''
  // Naddatek nie może dać ujemnego wymiaru szyby
  const glassW = Math.max(0, totalW - allowanceW)
  const glassH = Math.max(0, totalH - allowanceH)
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

  // splitWxH akceptuje ×/x/* — wymiar "900x400" (ASCII x) z danych migracji
  // znikał z braków szkła, choć webhook szyb go rozumiał
  const { w: wRaw, h: hRaw } = splitWxH(String(issue.raw_dim))
  const w = parseInt(wRaw) || 0
  const h = parseInt(hRaw) || 0
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
  total += parseInt(formData.side_panel_a_w_mm, 10) || 0
  total += parseInt(formData.side_panel_b_w_mm, 10) || 0

  const aQtys = formData.extension_qtys?.['a'] ?? {}
  const bQtys = formData.extension_qtys?.['b'] ?? {}

  let extensionTotal = 0
  for (const [w, qty] of Object.entries(aQtys)) {
    const mm = parseInt(w, 10)
    if (Number.isFinite(mm) && mm > 0) extensionTotal += qty * mm
  }
  for (const [w, qty] of Object.entries(bQtys)) {
    const mm = parseInt(w, 10)
    if (Number.isFinite(mm) && mm > 0) extensionTotal += qty * mm
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

// ── Kompletność KOMPLETU drzwi (Wysyłka) ─────────────────────────────
// Para Disting Plus / trójka Titan: wysyłamy komplet, nie połówkę — wiersz
// musi mówić, czy WSZYSTKIE nogi są gotowe. null = zamówienie pojedyncze.
// Nogi nieobecnej na liście otwartych (wydanej/archiwalnej) nie blokujemy.
export type SetCompleteness = { complete: boolean; missing: string[] }

export function orderSetCompleteness(order: Order, allOrders: Order[]): SetCompleteness | null {
  const done = (v: unknown) => String(v ?? '').trim() !== ''
  const stagesOf = (o: Order) => parseProductionStages(o.production_stages, o.category)
  const byId = (id: number | null | undefined) =>
    id == null ? undefined : allOrders.find((o) => o.id === id)

  const ef = order.extra_fields as Record<string, unknown> | null
  const titanGroup = ef?.titan_group != null ? String(ef.titan_group) : null
  const titan =
    titanGroup != null ||
    isStaTitanLinked(order, allOrders) ||
    (order.category === 'ST' && isStTitanOrder(order) && order.linked_order_id != null)

  if (titan) {
    // ustal id skrzydła STA (środek trójki)
    const staId =
      order.category === 'STA'
        ? order.id
        : order.category === 'ST'
          ? order.linked_order_id
          : titanGroup != null
            ? Number(titanGroup)
            : null
    const sta = order.category === 'STA' ? order : byId(staId ?? null)
    const st =
      order.category === 'ST'
        ? order
        : allOrders.find((o) => o.category === 'ST' && o.linked_order_id != null && o.linked_order_id === staId)
    const bastion =
      order.category === 'Bastion'
        ? order
        : allOrders.find((o) => {
            const e = o.extra_fields as Record<string, unknown> | null
            return o.category === 'Bastion' && staId != null && String(e?.titan_group ?? '') === String(staId)
          })

    const missing: string[] = []
    if (sta) {
      const s = stagesOf(sta)
      if (!done(s.e3)) missing.push('frez skrzydła (E3)')
      if (!done(s.e5)) missing.push('skrzydło na Bukową (E5)')
    }
    if (st) {
      const s = stagesOf(st)
      if (!done(s.e1)) missing.push('ościeżnica (ST E1)')
    }
    if (bastion) {
      const s = stagesOf(bastion)
      if (!done(s.tit_oku)) missing.push('okuwanie (OKU)')
      if (!done(s.tit_mon)) missing.push('montaż (MONT)')
      if (!done(s.tit_pak)) missing.push('pakowanie (PAK)')
    }
    return { complete: missing.length === 0, missing }
  }

  if (order.linked_order_id != null && (order.category === 'STA' || order.category === 'Disting')) {
    // para Disting Plus: każdy wymagany etap spełnia klucz WŁASNY albo mirror
    const stages = stagesOf(order)
    const glassExtra = hasGlassExtra(order)
    const req: Array<{ k: string; label: string }> = [
      { k: 'e1', label: 'ościeżnica (E1)' },
      { k: 'e2_1', label: 'okucie ościeżnicy (E2.1)' },
      ...(glassExtra ? [{ k: 'e2_2', label: 'szklenie dostawki (E2.2)' }] : []),
      { k: 'e3', label: 'frez skrzydła (E3)' },
      { k: 'e4', label: 'okucie skrzydła (E4)' },
      { k: 'e5', label: 'pakowanie (E5)' },
    ]
    const sat = (k: string) => done(stages[k]) || done(stages[`dist_${k}`]) || done(stages[`sta_${k}`])
    const missing = req.filter((r) => !sat(r.k)).map((r) => r.label)
    return { complete: missing.length === 0, missing }
  }

  return null
}

// Plan wydań (zastępuje Airtable brygadzisty): XX = towar na magazyn DZIŚ,
// X = na JUTRO — konwencja 1:1 z arkuszem. Trzymane w extra_fields.route_mark.
export function orderRouteMark(order: Order): '' | 'X' | 'XX' {
  const ef = order.extra_fields as Record<string, unknown> | null
  const v = String(ef?.route_mark ?? '').trim().toUpperCase()
  return v === 'X' || v === 'XX' ? v : ''
}

// ---------------------------------------------------------------------------
// Przeterminowane zamówienia
// ---------------------------------------------------------------------------

const PRODUCTION_DAY_WEEKDAY: Record<string, number> = {
  'PONIEDZIAŁEK': 1,
  'WTOREK':       2,
  'ŚRODA':        3,
  'CZWARTEK':     4,
  'PIĄTEK':       5,
}

/** Numer dnia produkcji (1=pon … 5=pt) do sortowania; nieznany → null (na koniec). */
export function productionDaySortValue(day: string | null | undefined): number | null {
  if (!day) return null
  return PRODUCTION_DAY_WEEKDAY[day.toUpperCase().trim()] ?? null
}

/**
 * Zwraca docelową datę produkcji dla zamówienia:
 * pierwsza data >= order_date w której wypada production_day.
 * Jeśli production_day pokrywa się z dniem order_date — zwraca order_date.
 */
export function getOrderTargetProductionDate(
  orderDate: string | null | undefined,
  productionDay: string | null | undefined,
): Date | null {
  if (!orderDate || !productionDay) return null
  const targetWeekday = PRODUCTION_DAY_WEEKDAY[productionDay.toUpperCase().trim()]
  if (targetWeekday === undefined) return null

  const base = new Date(orderDate)
  if (isNaN(base.getTime())) return null
  base.setHours(0, 0, 0, 0)

  // getDay(): 0=niedziela … 6=sobota → przelicz na 1=pon … 7=niedz
  const baseWeekday = base.getDay() === 0 ? 7 : base.getDay()
  let daysToAdd = targetWeekday - baseWeekday
  if (daysToAdd < 0) daysToAdd += 7   // cofnij do następnego tygodnia

  const target = new Date(base)
  target.setDate(base.getDate() + daysToAdd)
  return target
}

/**
 * Zwraca true gdy zamówienie jest przeterminowane:
 * jego docelowa data produkcji minęła, a zamówienie nie zostało jeszcze wydane.
 */
export function isOrderOverdue(order: {
  order_date?: string | null
  production_day?: string | null
  release_date?: string | null
  extra_fields?: unknown
}): boolean {
  const extra = order.extra_fields as Record<string, unknown> | null
  if (extra?.cancelled === true) return false
  if (order.release_date && !isReleaseDateEmpty(order.release_date)) return false

  const target = getOrderTargetProductionDate(order.order_date, order.production_day)
  if (!target) return false

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return target < today
}

/**
 * Liczba dni, które upłynęły od daty złożenia zamówienia (order_date).
 */
/** Dni ROBOCZE (pn–pt) w przedziale (start, end] — bez sobót i niedziel.
 *  Świąt nie znamy (brak kalendarza) — przy progach terminów to margines
 *  na korzyść produkcji. */
export function workingDaysBetween(start: Date, end: Date): number {
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  const days = Math.floor((e.getTime() - s.getTime()) / 86_400_000)
  if (days <= 0) return 0
  const fullWeeks = Math.floor(days / 7)
  let count = fullWeeks * 5
  const rem = days % 7
  const dow = s.getDay()
  for (let i = 1; i <= rem; i++) {
    const d = (dow + i) % 7
    if (d !== 0 && d !== 6) count++
  }
  return count
}

/** Ile DNI ROBOCZYCH czeka zamówienie (decyzja Tymka 2026-10-21: weekendy
 *  nie liczą się do wieku — progi reguł terminów też są w dniach roboczych). */
export function getDaysElapsed(order: {
  order_date?: string | null
}): number {
  if (!order.order_date) return 0
  // Parsuj "YYYY-MM-DD" jako datę LOKALNĄ (nie UTC), by uniknąć przesunięcia o dzień
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(order.order_date.trim())
  const base = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(order.order_date)
  if (isNaN(base.getTime())) return 0
  return workingDaysBetween(base, new Date())
}

export function hasGlassExtra(order: Order): boolean {
  const check = (v: string | null | undefined) => {
    const s = String(v ?? '').trim()
    // dodatek istnieje tylko, gdy pole ma wymiar (cyfrę) — '-', 'NIE' itp. to brak
    return s !== '' && s.toUpperCase() !== 'NIE' && /\d/.test(s)
  }
  return (
    check(order.top_light) ||
    check(order.side_panel) ||
    check(order.side_panel_a) ||
    check(order.side_panel_b)
  )
}

/**
 * Zwraca status wiekowy zamówienia na podstawie konfigurowalnych reguł terminów realizacji.
 * Reguły są sprawdzane malejąco według priorytetu — wygrywa pierwsza pasująca.
 * Jeśli żadna reguła nie pasuje, stosowane są domyślne progi 7/14 dni.
 */
export function getOrderAgeStatus(
  order: Order,
  rules: LeadTimeRule[],
): OrderAgeStatus {
  const extra = order.extra_fields as Record<string, unknown> | null
  if (extra?.cancelled === true) return 'ok'
  if (order.release_date && !isReleaseDateEmpty(order.release_date)) return 'ok'

  const days = getDaysElapsed(order)

  const activeRules = [...rules]
    .filter((r) => r.is_active)
    .sort((a, b) => b.priority - a.priority)

  let matchedRule: LeadTimeRule | null = null
  for (const rule of activeRules) {
    if (rule.match_category && rule.match_category !== order.category) continue
    if (rule.match_has_glass_extra !== null) {
      if (rule.match_has_glass_extra !== hasGlassExtra(order)) continue
    }
    if (rule.match_bastion_frame_type) {
      const frameType = String(
        (order as Record<string, unknown>).bastion_frame_type ?? '',
      ).toLowerCase()
      if (!frameType.includes(rule.match_bastion_frame_type.toLowerCase())) continue
    }
    matchedRule = rule
    break
  }

  const warningDays = matchedRule?.warning_days ?? 7
  const overdueDays = matchedRule?.overdue_days ?? 14

  if (days >= overdueDays) return 'overdue'
  if (days >= warningDays) return 'warning'
  return 'ok'
}

// Porównanie wersji apki "1.0.0-beta.51" (bramka minimalnej wersji).
// Wydanie bez -beta jest NOWSZE niż każda beta tej samej bazy (semver).
// Nieparsowalna wersja → false (nie blokujemy przy śmieciach w configu).
export function isAppVersionOlder(current: string, min: string): boolean {
  const parse = (v: string): [number, number, number, number] | null => {
    const m = String(v ?? '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/)
    if (!m) return null
    return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] != null ? Number(m[4]) : Infinity]
  }
  const a = parse(current)
  const b = parse(min)
  if (!a || !b) return false
  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i]) return a[i] < b[i]
  }
  return false
}

export function supabaseNumericFromForm(value: unknown): number | null {
  if (value === '' || value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Czy formularz zamówienia różni się od zrzutu z chwili otwarcia. Wszystkie pola
 * (suma kluczy), stringi bez białych znaków na brzegach, null/undefined = ''.
 * Brak zrzutu = nie pytamy.
 */
export function isOrderFormDirty(
  snapshot: Record<string, unknown> | null,
  current: Record<string, unknown>,
): boolean {
  if (!snapshot) return false
  const norm = (v: unknown) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v).trim())
  const keys = new Set([...Object.keys(snapshot), ...Object.keys(current)])
  for (const k of keys) if (norm(snapshot[k]) !== norm(current[k])) return true
  return false
}

/** Kopia obiektu bez podanych kluczy (np. pól, których formularz nie ma). */
export function omitKeys<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const out = { ...obj }
  for (const k of keys) delete out[k]
  return out
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

// orderMetaForUpdate USUNIĘTE: wysyłało przy edycji snapshot całego zamówienia
// z chwili otwarcia okna (etapy, wydanie, linki), nadpisując zmiany zrobione
// w międzyczasie przez inne stanowiska. Edycja wysyła teraz tylko pola
// formularza; ścieżka STA idzie jednym RPC update_order_form (pola + patch
// etapów + extra_fields atomowo), pozostałe merge'ują RPC merge_order_stages /
// merge_order_extra_fields po stronie bazy.

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
    // scalenie zaczep/elektrozaczep (#57): jedno pole UI, źródłem electric_strike
    // (fallback na stare zamówienia pisane tylko do zaczep)
    zaczep: order.electric_strike || order.zaczep || '',
    intarsja: order.intarsja ?? '',
    stage1: st.e1 ?? '',
    stage2_1: st.e2_1 ?? '',
    stage2_2: st.e2_2 ?? '',
    stage3: st.e3 ?? '',
    stage4: st.e4 ?? '',
    stage5: st.e5 ?? '',
    quantity: Number(order.quantity) || 1,
    notes: order.notes ?? '',
    client_order_number: order.client_order_number ?? '',
    wykonawca: String((order.extra_fields as Record<string, unknown> | null)?.wykonawca ?? ''),
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
    wentylacja: String((order as Record<string, unknown>).wentylacja ?? ''),
    quantity: Number(order.quantity) || 1,
    notes: order.notes ?? '',
    client_order_number: order.client_order_number ?? '',
  }
}

export function orderToBastionForm(order: Order): BastionOrderFormData {
  const bastion = order as Record<string, unknown>
  // "SZER×WYS" → [szer, wys] (obsługa × oraz x)
  const splitDim = (v: unknown): [string, string] => {
    const parts = String(v ?? '').split(/[×x]/)
    return [String(parts[0] ?? '').trim(), String(parts[1] ?? '').trim()]
  }
  const [sideKW, sideKH] = splitDim(bastion.bastion_side_panel_k)
  const [sidePW, sidePH] = splitDim(bastion.bastion_side_panel_p)
  const [topW, topH] = splitDim(bastion.bastion_top_panel)
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
    intarsja: order.intarsja ?? '',
    side_panel_k_w: sideKW,
    side_panel_p_w: sidePW,
    side_panel_h: sideKH || sidePH,
    top_panel_w: topW,
    top_panel_h: topH,
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
  // dynamiczne kryteria: multi-wartości sklejane przez "|"
  for (const c of form.criteria ?? []) {
    const vals = c.values.map((v) => v.trim()).filter(Boolean)
    if (vals.length > 0) parts.push(vals.join('|'))
  }
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
