// =====================================================================
// Magazyn wewnętrzne (id 3) — drzwi wewnętrzne. Komponenty zakłada import
// z kartotek Optimy po stronie bazy (code = kod Optimy, notes = 'Import z
// kartotek Optimy (…)'). Bastion to osobny produkt: nigdy nie trafia do
// magazynu wewnętrznego ani do powiązań kodów z Optimy.
// =====================================================================
import type { WarehouseComponent } from '../types'

export const INTERNAL_WAREHOUSE_ID = 3

export const OPTIMA_IMPORT_NOTE_PREFIX = 'Import z kartotek Optimy'

/** Kategorie komponentów drzwi wewnętrznych (product_category LIKE 'door_%'). */
export const DOOR_CATEGORIES = ['door_wing', 'door_frame', 'door_handle', 'door_hinge_cover', 'door_accessory'] as const

export function isDoorComponent(c: Pick<WarehouseComponent, 'product_category'>): boolean {
  return String(c.product_category ?? '').startsWith('door_')
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
