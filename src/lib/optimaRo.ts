// =====================================================================
// Zlecenia drzwi wewnętrznych z Optimy (rezerwacje odbiorcy, RO).
//
// Import robi edge function optima-ro-import (pg_cron co godzinę) z dwóch baz
// Optimy: KR Center i MR Profil. Jedno RO = jedno zlecenie (category
// 'DrzwiWewnetrzne', source 'optima_ro') — tylko gdy RO ma choć jedno skrzydło
// albo ościeżnicę drzwi wewnętrznych (same TECHNIC i Bastion — nie).
// orders.quantity = liczba skrzydeł; pozycje mają item_type. Przy każdej zmianie RO import
// NADPISUJE pola z OPTIMA_OWNED_FIELDS i wszystkie pozycje (kasuje i wstawia
// na nowo — id pozycji się zmieniają, nie trzymać referencji do nich).
// Pól produkcyjnych (release_date, etapy, wysyłka, reszta extra_fields) nie rusza.
// =====================================================================
import { supabase } from '../supabaseClient'
import type { InternalDoorItem, Order } from '../types'

export const OPTIMA_SOURCE = 'optima_ro'

export type OptimaBaza = 'KR' | 'MR'

export const OPTIMA_BAZA_LABEL: Record<OptimaBaza, string> = {
  KR: 'KR Center',
  MR: 'MR Profil',
}

/** D10 (28.11): zlecenie z RO bazy MR Profil (source_metadata.optima_key = 'MR:<id>') — numer z „MR/”,
 *  wydanie z magazynu MR_WEW, poza statystykami i rezerwacjami KR. */
export function isMrProfilOrder(o: { source?: string | null; optima_key?: string | null; source_metadata?: unknown }): boolean {
  if (o.source !== OPTIMA_SOURCE) return false
  const key = o.optima_key ?? ((o.source_metadata as { optima_key?: unknown } | null | undefined)?.optima_key as string | undefined)
  return String(key ?? '').startsWith('MR:')
}

/** Pola zlecenia, które import nadpisuje — w aplikacji tylko do odczytu. */
export const OPTIMA_OWNED_FIELDS = [
  'order_number', 'erp_ro_number', 'erp_status', 'company', 'client_order_number',
  'order_date', 'quantity', 'notes', 'entered_by', 'source_metadata',
] as const

export const OPTIMA_READONLY_HINT = 'Zmieniaj w Optimie, synchronizacja co godzinę'

// ---------------------------------------------------------------------
// Typy pozycji (order_internal_door_items.item_type z importu; przy ręcznych
// — kategoria komponentu magazynu)
// ---------------------------------------------------------------------

export const ITEM_TYPE_GROUPS: Array<{ key: string; label: string }> = [
  { key: 'door_wing', label: 'Skrzydła' },
  { key: 'door_frame', label: 'Ościeżnice i opaski' },
  { key: 'door_handle', label: 'Klamki' },
  { key: 'door_hinge_cover', label: 'Osłonki' },
  { key: 'door_accessory', label: 'Akcesoria' },
]

type TypedItem = Pick<InternalDoorItem, 'item_type' | 'component_category' | 'quantity' | 'unit' | 'component_id'>

export function itemTypeOf(it: Pick<InternalDoorItem, 'item_type' | 'component_category'>): string {
  return String(it.item_type || it.component_category || '').trim() || 'other'
}

/** „7 szt. · 4 kpl” — suma ilości osobno dla każdej jednostki (listwy idą w kpl). */
export function qtyByUnit(items: Array<Pick<InternalDoorItem, 'quantity' | 'unit'>>): string {
  const byUnit = new Map<string, number>()
  for (const it of items) {
    const u = String(it.unit || 'szt').replace(/\.$/, '').trim() || 'szt'
    byUnit.set(u, (byUnit.get(u) ?? 0) + (Number(it.quantity) || 0))
  }
  return [...byUnit].map(([u, n]) => `${n} ${u === 'szt' ? 'szt.' : u}`).join(' · ')
}

// ---------------------------------------------------------------------
// Komplety z Optimy (27.11.2026): jeden kod RO = kilka części magazynu (tabela optima_kit_parts),
// np. „MALEO 06 … Z SYSTEMEM PRZESUWNYM” = skrzydło przesuwne + SYSTEM PRZESUWNY. Rozbicie robią
// triggery bazy na order_internal_door_items: pozycja z RO dostaje komponent pierwszej części, a każda
// kolejna część to osobna pozycja z tym samym optima_element_id i notes „Część kompletu <kod>”.
// Aplikacja niczego nie rozbija — tylko pokazuje część pod jej pozycją z RO.
// ---------------------------------------------------------------------

export const KIT_PART_PREFIX = 'Część kompletu '

type KitItem = { notes?: string | null; optima_element_id?: number | null }

/** Pozycja dopisana przez bazę jako dalsza część kompletu (nie ma jej w RO). */
export function isKitPart(it: KitItem): boolean {
  return it.optima_element_id != null && String(it.notes ?? '').startsWith(KIT_PART_PREFIX)
}

/** Kod kompletu, z którego jest część („MALEO 06 BIAŁY 80 Z SYSTEMEM PRZESUWNYM”). */
export function kitCodeOf(it: KitItem): string | null {
  return isKitPart(it) ? String(it.notes).slice(KIT_PART_PREFIX.length).trim() || null : null
}

/** Pozycje w grupach wg typu, w stałej kolejności; nieznany typ na końcu jako „Pozostałe”.
 *  Części kompletu stoją zaraz pod swoją pozycją z RO (ten sam optima_element_id), w jej grupie, i nie liczą się
 *  do sumy grupy (suma = to, co w RO). Część bez pozycji-rodzica zostaje w grupie swojego typu. */
export function groupItemsByType<T extends TypedItem & Partial<KitItem>>(items: T[]): Array<{ key: string; label: string; items: T[]; total: string }> {
  const parts = new Map<number, T[]>()
  const parentIds = new Set(items.filter((it) => !isKitPart(it as KitItem) && it.optima_element_id != null).map((it) => it.optima_element_id as number))
  const by = new Map<string, T[]>()
  for (const it of items) {
    if (isKitPart(it as KitItem) && parentIds.has(it.optima_element_id as number)) {
      const eid = it.optima_element_id as number
      parts.set(eid, [...(parts.get(eid) ?? []), it])
      continue
    }
    const k = itemTypeOf(it)
    by.set(k, [...(by.get(k) ?? []), it])
  }
  const withParts = (list: T[]) => list.flatMap((it) => [it, ...(!isKitPart(it as KitItem) && it.optima_element_id != null ? parts.get(it.optima_element_id) ?? [] : [])])
  const known = ITEM_TYPE_GROUPS.filter((g) => by.has(g.key))
  const rest = [...by.keys()].filter((k) => !ITEM_TYPE_GROUPS.some((g) => g.key === k))
  return [
    ...known.map((g) => ({ ...g, items: withParts(by.get(g.key)!), total: qtyByUnit(by.get(g.key)!) })),
    ...(rest.length
      ? [{ key: 'other', label: 'Pozostałe', items: withParts(rest.flatMap((k) => by.get(k)!)), total: qtyByUnit(rest.flatMap((k) => by.get(k)!)) }]
      : []),
  ]
}

export type ItemsSummary = { unmapped: number; wings: number; frames: number }

export function summarizeItems(items: TypedItem[]): ItemsSummary {
  const s: ItemsSummary = { unmapped: 0, wings: 0, frames: 0 }
  for (const it of items) {
    if (it.component_id == null) s.unmapped += 1
    const t = itemTypeOf(it)
    if (t === 'door_wing') s.wings += Number(it.quantity) || 0
    else if (t === 'door_frame') s.frames += Number(it.quantity) || 0
  }
  return s
}

/** Liczba skrzydeł: przy RO z Optimy orders.quantity (import liczy tylko skrzydła), przy ręcznych — z pozycji. */
export function wingCount(o: Pick<Order, 'source' | 'quantity'>, summary: ItemsSummary | null | undefined): number {
  if (isOptimaOrder(o)) return Number(o.quantity) || 0
  return summary?.wings ?? 0
}

export const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s)

/** Role z zapisem do optima_component_map (polityka ocm_write w bazie). */
export const OPTIMA_MAP_ROLES = [
  'superadmin', 'admin', 'manager', 'kierownik_magazynu', 'kierownik_produkcji', 'kierownik_firmowy', 'magazynier',
] as const

export function canMapOptimaCodes(role: string | null | undefined): boolean {
  return (OPTIMA_MAP_ROLES as readonly string[]).includes(String(role ?? ''))
}

export type OptimaRecipient = {
  code?: string | null
  name?: string | null
  city?: string | null
  street?: string | null
  post_code?: string | null
}

export type OptimaMeta = {
  optima_key?: string
  baza?: string
  document_id?: number
  full_number?: string
  status?: number
  state?: number
  updated?: string
  created?: string
  reservation_date?: string
  payer_code?: string
  recipient?: OptimaRecipient | null
}

export function isOptimaOrder(o: Pick<Order, 'source'> | null | undefined): boolean {
  return o?.source === OPTIMA_SOURCE
}

/**
 * Stan rezerwacji odbiorcy w Optimie (source_metadata.state). Z danych 26.11 (7,7 tys. RO):
 * 0 = niezatwierdzone (bufor, status 1), 1 = potwierdzone, 2 = w realizacji (częściowo),
 * 3 = zrealizowane (większość, także z tego samego dnia), 4 = zamknięte (stare, zamykane po miesiącach).
 * 3 i 4 to zlecenia zamknięte: nie rezerwują magazynu i domyślnie nie ma ich na liście.
 */
export function optimaState(o: Pick<Order, 'source' | 'source_metadata'> | null | undefined): number | null {
  if (!o || !isOptimaOrder(o)) return null
  const m = o.source_metadata as { state?: unknown } | null | undefined
  const n = Number(m?.state)
  return m?.state == null || !Number.isFinite(n) ? null : n
}

export const OPTIMA_CLOSED_STATES = [3, 4] as const

/** Import zamknął / anulował zlecenie wg statusu RO (extra_fields.closed_by = 'optima_ro'). */
export function closedByOptima(o: Pick<Order, 'extra_fields'> | null | undefined): boolean {
  const e = o?.extra_fields
  return !!e && typeof e === 'object' && (e as Record<string, unknown>).closed_by === OPTIMA_SOURCE
}

export function isOptimaClosed(o: Pick<Order, 'source' | 'source_metadata'> & Partial<Pick<Order, 'extra_fields' | 'release_date'>> | null | undefined): boolean {
  if (!o || !isOptimaOrder(o)) return false
  if (closedByOptima(o) && o.release_date && String(o.release_date).trim()) return true
  const s = optimaState(o)
  return s != null && (OPTIMA_CLOSED_STATES as readonly number[]).includes(s)
}

/** Etykieta zamkniętego RO; null = otwarte (albo zlecenie ręczne). */
export function optimaClosedLabel(o: Pick<Order, 'source' | 'source_metadata'> & Partial<Pick<Order, 'extra_fields' | 'release_date'>> | null | undefined): string | null {
  if (!isOptimaClosed(o)) return null
  const s = optimaState(o)
  return s === 4 ? 'Zamknięte w Optimie' : 'Zrealizowane w Optimie'
}

/** Mała adnotacja w szczegółach: status przyszedł z Optimy (import), nie z ręcznego zamknięcia. */
export function optimaStatusNote(o: Pick<Order, 'source' | 'source_metadata' | 'extra_fields' | 'release_date'> | null | undefined): string | null {
  if (!o || !isOptimaOrder(o)) return null
  const e = (o.extra_fields && typeof o.extra_fields === 'object' ? o.extra_fields : {}) as Record<string, unknown>
  if (e.cancelled === true && (closedByOptima(o) || /optim/i.test(String(e.cancelled_reason ?? '')))) return 'anulowane wg Optimy'
  if (closedByOptima(o) && o.release_date && String(o.release_date).trim()) return 'zamknięte wg Optimy (RO zrealizowane)'
  if (isOptimaClosed(o)) return 'zamknięte wg Optimy'
  return null
}

export function optimaMeta(o: Pick<Order, 'source' | 'source_metadata'> | null | undefined): OptimaMeta | null {
  if (!o || !isOptimaOrder(o)) return null
  const m = o.source_metadata
  return m && typeof m === 'object' ? (m as OptimaMeta) : null
}

/** Baza Optimy z klucza KR:<id> / MR:<id>, awaryjnie z nazwy bazy. */
export function optimaBaza(o: Pick<Order, 'source' | 'source_metadata'> | null | undefined): OptimaBaza | null {
  const m = optimaMeta(o)
  if (!m) return null
  const key = String(m.optima_key ?? '').toUpperCase()
  if (key.startsWith('KR:')) return 'KR'
  if (key.startsWith('MR:')) return 'MR'
  const baza = String(m.baza ?? '').toUpperCase()
  if (baza.includes('MR')) return 'MR'
  if (baza.includes('KR')) return 'KR'
  return null
}

function extra(o: Pick<Order, 'extra_fields'> | null | undefined): Record<string, unknown> {
  const e = o?.extra_fields
  return e && typeof e === 'object' ? (e as Record<string, unknown>) : {}
}

export function isOrderCancelled(o: Pick<Order, 'extra_fields'> | null | undefined): boolean {
  return extra(o).cancelled === true
}

/** Powód anulowania — import wpisuje cancelled_reason, ręczne anulowanie: kto i kiedy. */
export function cancelledReason(o: Pick<Order, 'extra_fields'> | null | undefined): string {
  const e = extra(o)
  const reason = String(e.cancelled_reason ?? '').trim()
  if (reason) return reason
  const at = String(e.cancelled_at ?? '').trim()
  const by = String(e.cancelled_by ?? '').trim()
  if (!at && !by) return ''
  return `Anulowano${at ? ` ${at.slice(0, 10)}` : ''}${by ? ` przez ${by}` : ''}`
}

export function recipientAddress(r: OptimaRecipient | null | undefined): string {
  if (!r) return ''
  const city = [r.post_code, r.city].map((v) => String(v ?? '').trim()).filter(Boolean).join(' ')
  return [r.name, r.street, city].map((v) => String(v ?? '').trim()).filter(Boolean).join(', ')
}

export function unmappedItems<T extends Pick<InternalDoorItem, 'component_id'>>(items: T[]): T[] {
  return items.filter((it) => it.component_id == null)
}

/** Data ze znacznika Optimy (2026-11-20T07:37:56, bez strefy) do wyświetlenia. */
export function formatOptimaDateTime(v: string | null | undefined): string {
  const s = String(v ?? '').trim()
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/)
  if (!m) return s || '—'
  const date = `${m[3]}.${m[2]}.${m[1]}`
  return m[4] ? `${date} ${m[4]}:${m[5]}` : date
}

// ---------------------------------------------------------------------
// Filtry listy drzwi wewnętrznych (dochodzą do ogólnych: szukaj, daty, anulowane)
// ---------------------------------------------------------------------

export type IntDoorFilter = {
  baza: 'all' | OptimaBaza
  zrodlo: 'all' | 'optima' | 'manual'
  bezKomponentu: boolean
  /** zawiera: skrzydła / same ościeżnice (bez skrzydeł) */
  zawartosc: 'all' | 'wings' | 'frames_only'
  /** pokaż też RO zrealizowane / zamknięte w Optimie (stan 3–4) — domyślnie tylko otwarte */
  zamkniete: boolean
}

export const INT_DOOR_FILTER_DEFAULT: IntDoorFilter = { baza: 'all', zrodlo: 'all', bezKomponentu: false, zawartosc: 'all', zamkniete: false }

export function isIntDoorFilterActive(f: IntDoorFilter): boolean {
  return f.baza !== 'all' || f.zrodlo !== 'all' || f.bezKomponentu || f.zawartosc !== 'all' || f.zamkniete
}

export function matchesIntDoorFilter(
  o: Pick<Order, 'source' | 'source_metadata' | 'quantity'> & Partial<Pick<Order, 'extra_fields' | 'release_date'>>,
  f: IntDoorFilter,
  summary: ItemsSummary | null | undefined,
): boolean {
  const unmappedCount = summary?.unmapped ?? 0
  const optima = isOptimaOrder(o)
  // anulowane rządzi ogólny filtr „Pokaż anulowane” — tu ukrywamy tylko zrealizowane / zamknięte
  if (!f.zamkniete && isOptimaClosed(o) && !isOrderCancelled(o)) return false
  if (f.zrodlo === 'optima' && !optima) return false
  if (f.zrodlo === 'manual' && optima) return false
  if (f.baza !== 'all' && optimaBaza(o) !== f.baza) return false
  if (f.bezKomponentu && unmappedCount === 0) return false
  if (f.zawartosc === 'wings' && wingCount(o, summary) === 0) return false
  if (f.zawartosc === 'frames_only' && (wingCount(o, summary) > 0 || (summary?.frames ?? 0) === 0)) return false
  return true
}

// ---------------------------------------------------------------------
// Powiązania kod Optimy → komponent magazynu
// ---------------------------------------------------------------------

export type OptimaMapRow = { optima_code: string; component_id: number; created_by: string | null; created_at: string }

/** Kod bez komponentu zebrany z pozycji (component_id IS NULL). */
export type UnmappedCode = { code: string; count: number; orders: number; sampleName: string; group: string }

export function groupUnmappedCodes(
  rows: Array<Pick<InternalDoorItem, 'optima_code' | 'optima_name' | 'optima_group' | 'order_id'>>,
): UnmappedCode[] {
  const byCode = new Map<string, { u: UnmappedCode; orderIds: Set<number> }>()
  for (const r of rows) {
    const code = String(r.optima_code ?? '').trim()
    if (!code) continue
    const cur = byCode.get(code) ?? { u: { code, count: 0, orders: 0, sampleName: '', group: '' }, orderIds: new Set<number>() }
    cur.u.count += 1
    cur.orderIds.add(r.order_id)
    if (!cur.u.sampleName && r.optima_name) cur.u.sampleName = r.optima_name
    if (!cur.u.group && r.optima_group) cur.u.group = r.optima_group
    byCode.set(code, cur)
  }
  return [...byCode.values()]
    .map(({ u, orderIds }) => ({ ...u, orders: orderIds.size }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
}

const isMissingFn = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message ?? ''))

/**
 * Powiąż kod z komponentem (componentId = null → usuń powiązanie) i od razu
 * przepnij wszystkie pozycje z tym kodem. Robi to RPC optima_map_component
 * (migrate/optima_component_map_rpc.sql) — jedna transakcja, działa też dla
 * magazyniera, który nie ma UPDATE na order_internal_door_items. Póki RPC nie
 * ma w bazie: upsert mapy + update pozycji z klienta (wystarczy kierownikom).
 * Zwraca liczbę przepiętych pozycji.
 */
export async function mapOptimaCode(code: string, componentId: number | null): Promise<number> {
  const optimaCode = code.trim()
  if (!optimaCode) throw new Error('Pusty kod Optimy')
  const { data, error } = await supabase.rpc('optima_map_component', { p_code: optimaCode, p_component_id: componentId })
  if (!error) return Number(data ?? 0)
  if (!isMissingFn(error)) throw new Error(error.message)

  if (componentId == null) {
    const { error: delErr } = await supabase.from('optima_component_map').delete().eq('optima_code', optimaCode)
    if (delErr) throw new Error(delErr.message)
  } else {
    const { error: upErr } = await supabase
      .from('optima_component_map')
      .upsert({ optima_code: optimaCode, component_id: componentId }, { onConflict: 'optima_code' })
    if (upErr) throw new Error(upErr.message)
  }
  // tylko pozycje, które faktycznie się zmieniają (jak „is distinct from" w RPC)
  const base = supabase.from('order_internal_door_items').update({ component_id: componentId }).eq('optima_code', optimaCode)
  const { data: upd, error: itErr } = await (componentId == null
    ? base.not('component_id', 'is', null)
    : base.or(`component_id.is.null,component_id.neq.${componentId}`)
  ).select('id')
  if (itErr) throw new Error(`Powiązanie zapisane, ale pozycji nie przepięto: ${itErr.message}`)
  return (upd ?? []).length
}

// ---------------------------------------------------------------------
// Stan synchronizacji (optima_ro_sync_state — tylko odczyt)
// ---------------------------------------------------------------------

export type OptimaSyncResult = {
  ro?: number
  nowe?: number
  zaktualizowane?: number
  anulowane?: number
  pominięte?: number
  bledy?: string[]
  [k: string]: unknown
}

export type OptimaSyncState = {
  baza: string
  last_u_date: string | null
  last_run_at: string | null
  last_result: OptimaSyncResult | null
  /** blokada przebiegu importu (optima_sync_lock) — trwa, dopóki > now() */
  running_until?: string | null
}

export function isSyncRunning(s: Pick<OptimaSyncState, 'running_until'> | null | undefined, now: number = Date.now()): boolean {
  const t = s?.running_until ? Date.parse(s.running_until) : NaN
  return Number.isFinite(t) && t > now
}

export const OPTIMA_SYNC_COUNTERS: Array<{ key: string; label: string }> = [
  { key: 'ro', label: 'RO sprawdzone' },
  { key: 'nowe', label: 'nowe' },
  { key: 'zaktualizowane', label: 'zaktualizowane' },
  { key: 'anulowane', label: 'anulowane' },
  { key: 'pominięte', label: 'pominięte' },
]

export function syncErrors(s: OptimaSyncState | null | undefined): string[] {
  const b = s?.last_result?.bledy
  return Array.isArray(b) ? b.map(String).filter(Boolean) : []
}

export async function fetchOptimaSyncState(): Promise<OptimaSyncState[]> {
  const { data, error } = await supabase.from('optima_ro_sync_state').select('*').order('baza')
  if (error) throw new Error(error.message)
  return (data ?? []) as OptimaSyncState[]
}

/** Ręczne uruchomienie importu (tylko kierownicy — RPC sprawdza też po swojej stronie). Asynchroniczne. */
export async function runOptimaImportNow(baza: OptimaBaza | null = null): Promise<void> {
  const { error } = await supabase.rpc('optima_ro_import_now', { p_baza: baza })
  if (error) throw new Error(error.message)
}
