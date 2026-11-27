// =====================================================================
// Magazyn wewnętrzne (id 3) — drzwi wewnętrzne. Komponenty zakłada import
// z kartotek Optimy po stronie bazy (code = kod Optimy, notes = 'Import z
// kartotek Optimy (…)'). Bastion to osobny produkt: nigdy nie trafia do
// magazynu wewnętrznego ani do powiązań kodów z Optimy.
// =====================================================================
import type { WarehouseComponent } from '../types'

/** 27.11: drzwi wewnętrzne leżą w dwóch magazynach — WEW1 „Magazyn 1” (dawne WEWNETRZNE, id 3) i WEW2 „Magazyn 2”.
 *  Stan drzwi = suma magazynów o kodzie WEW*; wydanie zlecenia (issue_internal_door_stock) zdejmuje najpierw z Magazynu 1. */
export const INTERNAL_WAREHOUSE_CODE_PATTERN = 'WEW%'

/** Suma stanów magazynów drzwi wewnętrznych per komponent (wiersze warehouse_stock z kodem magazynu). */
export function sumInternalStock(rows: Array<{ component_id: number | string; quantity: number | string | null }>): Map<number, number> {
  const m = new Map<number, number>()
  for (const r of rows) {
    const id = Number(r.component_id)
    m.set(id, (m.get(id) ?? 0) + (Number(r.quantity) || 0))
  }
  return m
}

export const OPTIMA_IMPORT_NOTE_PREFIX = 'Import z kartotek Optimy'

/** warehouse_components.category, którą import kartotek nadaje komponentom drzwi wewnętrznych */
export const INTERNAL_DOOR_GROUP = 'DRZWI WEWNĘTRZNE'

/** Kategorie komponentów drzwi wewnętrznych (product_category LIKE 'door_%'). */
export const DOOR_CATEGORIES = ['door_wing', 'door_frame', 'door_handle', 'door_hinge_cover', 'door_accessory'] as const

/** product_category drzwi wewnętrznych — także door_accessory (zamki, wkładki…) i każda przyszła door_*. */
export function isDoorCategory(category: string | null | undefined): boolean {
  return String(category ?? '').startsWith('door_')
}

export function isDoorComponent(c: Pick<WarehouseComponent, 'product_category'>): boolean {
  return isDoorCategory(c.product_category)
}

/** Komponent magazynu wewnętrznego: product_category door_* albo grupa „DRZWI WEWNĘTRZNE” z importu. */
export function isInternalDoorComponent(c: Pick<WarehouseComponent, 'product_category' | 'category'>): boolean {
  return isDoorCategory(c.product_category) || String(c.category ?? '').trim().toUpperCase() === INTERNAL_DOOR_GROUP
}

/** Komponent z importu kartotek Optimy — kod to klucz powiązania, nie zmieniamy go i nie usuwamy. */
export function isOptimaImportedComponent(c: Pick<WarehouseComponent, 'notes'> | null | undefined): boolean {
  return String(c?.notes ?? '').trimStart().startsWith(OPTIMA_IMPORT_NOTE_PREFIX)
}

export function isBastionComponent(c: Pick<WarehouseComponent, 'name' | 'code'>): boolean {
  return /bastion/i.test(`${c.name ?? ''} ${c.code ?? ''}`)
}

/** Komponenty, które można przypiąć do pozycji drzwi wewnętrznych (bez surowców i bez Bastiona). */
export function internalDoorComponents<T extends WarehouseComponent>(list: T[]): T[] {
  return list.filter((c) => c.is_active && isDoorComponent(c) && !isBastionComponent(c))
}

// ---------------------------------------------------------------------
// Filtry (inwentaryzacja, stany wewnętrzne)
// ---------------------------------------------------------------------

export type DoorAttrs = {
  code?: string | null
  name?: string | null
  product_category?: string | null
  door_model?: string | null
  door_color?: string | null
  door_size?: string | null
  door_direction?: string | null
}

export type DoorFilter = { q: string; category: string; model: string; color: string }

export const DOOR_FILTER_EMPTY: DoorFilter = { q: '', category: '', model: '', color: '' }

const fold = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')

/** Wyszukiwarka: każde słowo w kodzie / nazwie / modelu / kolorze / rozmiarze (bez ogonków). */
export function matchesDoorFilter(a: DoorAttrs, f: DoorFilter): boolean {
  if (f.category && a.product_category !== f.category) return false
  if (f.model && (a.door_model ?? '') !== f.model) return false
  if (f.color && (a.door_color ?? '') !== f.color) return false
  const terms = fold(f.q).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const hay = fold([a.code, a.name, a.door_model, a.door_color, a.door_size, a.door_direction].filter(Boolean).join(' '))
  return terms.every((t) => hay.includes(t))
}

/** Wartości do list wyboru modelu / koloru (z bieżącego zakresu kategorii). */
export function distinctValues(rows: DoorAttrs[], key: 'door_model' | 'door_color', category = ''): string[] {
  const set = new Set<string>()
  for (const r of rows) {
    if (category && r.product_category !== category) continue
    const v = String(r[key] ?? '').trim()
    if (v) set.add(v)
  }
  return [...set].sort((x, y) => x.localeCompare(y, 'pl'))
}

// ---------------------------------------------------------------------
// Spis z natury magazynu wewnętrznego: grupy wg product_category, w grupie po nazwie
// ---------------------------------------------------------------------

export const INVENTORY_GROUP_ORDER = ['door_wing', 'door_frame', 'door_handle', 'door_accessory', 'door_hinge_cover'] as const

type SpisLine = { component_category?: string | null; component_name?: string | null }

const groupRank = (cat: string | null | undefined) => {
  const i = (INVENTORY_GROUP_ORDER as readonly string[]).indexOf(String(cat ?? ''))
  return i < 0 ? INVENTORY_GROUP_ORDER.length : i
}

/** Spis z drzwiami wewnętrznymi: kategoria (skrzydła, ościeżnice, klamki, akcesoria, osłonki), potem nazwa. Surowce bez zmian. */
export function sortInventoryLines<T extends SpisLine>(lines: T[]): T[] {
  if (!lines.some((l) => isDoorCategory(l.component_category))) return lines
  return [...lines].sort(
    (a, b) => groupRank(a.component_category) - groupRank(b.component_category) || String(a.component_name ?? '').localeCompare(String(b.component_name ?? ''), 'pl'),
  )
}

/** Grupy do wydruku (po sortInventoryLines); surowce = jedna grupa bez nagłówka (key ''). */
export function groupInventoryLines<T extends SpisLine>(lines: T[]): Array<{ key: string; lines: T[] }> {
  if (!lines.some((l) => isDoorCategory(l.component_category))) return [{ key: '', lines }]
  const out: Array<{ key: string; lines: T[] }> = []
  for (const l of sortInventoryLines(lines)) {
    const key = String(l.component_category ?? '')
    const last = out[out.length - 1]
    if (last && last.key === key) last.lines.push(l)
    else out.push({ key, lines: [l] })
  }
  return out
}

// ---------------------------------------------------------------------
// Rezerwacje z otwartych zleceń
// ---------------------------------------------------------------------

export type OpenItem = { order_id: number; component_id: number | null; quantity: number }
export type IssuedMovement = { order_id: number; component_id: number; movement_type: string; quantity: number }

/**
 * Rezerwacje komponentów z otwartych zleceń drzwi wewnętrznych (niewydane,
 * nieanulowane): suma ilości z pozycji MINUS to, co już zeszło z magazynu
 * dla tego zlecenia (WZ − ZWR). Ręczne zlecenia schodzą z magazynu przy
 * zapisie, z Optimy — przy „Wydane"; bez odejmowania ręczne liczyłyby się
 * podwójnie (raz w stanie, raz w rezerwacji).
 */
export type Shortage = { componentId: number; toIssue: number; stock: number; missing: number }

/**
 * Braki przy wydaniu jednego zlecenia: dla każdego komponentu ile jeszcze
 * trzeba wydać (pozycje − netto WZ−ZWR tego zlecenia) wobec stanu magazynu
 * wewnętrznego. missing > 0 = stan zejdzie poniżej zera.
 */
export function internalShortages(
  items: Array<{ component_id: number | null; quantity: number }>,
  stock: Map<number, number>,
  issued: Array<{ component_id: number; movement_type: string; quantity: number }>,
): Map<number, Shortage> {
  const need = new Map<number, number>()
  for (const it of items) {
    if (it.component_id == null) continue
    need.set(it.component_id, (need.get(it.component_id) ?? 0) + (Number(it.quantity) || 0))
  }
  const done = new Map<number, number>()
  for (const m of issued) {
    const sign = m.movement_type === 'WZ' ? 1 : m.movement_type === 'ZWR' ? -1 : 0
    if (sign) done.set(m.component_id, (done.get(m.component_id) ?? 0) + sign * (Number(m.quantity) || 0))
  }
  const out = new Map<number, Shortage>()
  for (const [id, qty] of need) {
    const toIssue = Math.max(0, qty - Math.max(0, done.get(id) ?? 0))
    const st = stock.get(id) ?? 0
    out.set(id, { componentId: id, toIssue, stock: st, missing: Math.max(0, toIssue - Math.max(0, st)) })
  }
  return out
}

export function internalReservations(items: OpenItem[], movements: IssuedMovement[]): Map<number, number> {
  const key = (o: number, c: number) => `${o}:${c}`
  const needed = new Map<string, number>()
  for (const it of items) {
    if (it.component_id == null) continue
    const k = key(it.order_id, it.component_id)
    needed.set(k, (needed.get(k) ?? 0) + (Number(it.quantity) || 0))
  }
  const issued = new Map<string, number>()
  for (const m of movements) {
    const sign = m.movement_type === 'WZ' ? 1 : m.movement_type === 'ZWR' ? -1 : 0
    if (!sign) continue
    const k = key(m.order_id, m.component_id)
    issued.set(k, (issued.get(k) ?? 0) + sign * (Number(m.quantity) || 0))
  }
  const out = new Map<number, number>()
  for (const [k, qty] of needed) {
    const rest = Math.max(0, qty - Math.max(0, issued.get(k) ?? 0))
    if (rest <= 0) continue
    const componentId = Number(k.split(':')[1])
    out.set(componentId, (out.get(componentId) ?? 0) + rest)
  }
  return out
}
