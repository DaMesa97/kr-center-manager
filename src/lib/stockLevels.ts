// =====================================================================
// Poziomy braków w Stanach — strona aplikacji. Reguły poziomu i „do zamówienia”
// liczy BAZA (stock_level / stock_shortage w widoku v_stock_levels); tu tylko:
// etykiety, kolejność, agregacja po komponencie (widok „Wszystkie”), liczniki,
// sortowanie „od najgorszych” i CSV braków. Testy: __tests__/stockLevels.test.ts
// =====================================================================
import type { StockLevel, StockLevelRow, StockMinSource } from '../types'

export const STOCK_LEVEL_ORDER: StockLevel[] = ['critical', 'covered', 'low', 'ok', 'inactive']

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const numOrNull = (v: unknown): number | null => (v == null || v === '' ? null : num(v))

/** Wiersz v_stock_levels z PostgREST — numeric przychodzi jako string, tu rzutujemy raz */
export function normalizeStockLevelRow(r: Record<string, unknown>): StockLevelRow {
  const lvl = String(r.level ?? 'ok') as StockLevel
  const src = r.min_source == null ? null : (String(r.min_source) as StockMinSource)
  return {
    stock_id: num(r.stock_id),
    warehouse_id: num(r.warehouse_id),
    warehouse_code: String(r.warehouse_code ?? ''),
    component_id: num(r.component_id),
    component_code: String(r.component_code ?? ''),
    component_name: String(r.component_name ?? ''),
    component_unit: r.component_unit == null ? null : String(r.component_unit),
    component_category: r.component_category == null ? null : String(r.component_category),
    supplier_id: numOrNull(r.supplier_id),
    is_active: r.is_active !== false,
    quantity: num(r.quantity),
    reserved_quantity: num(r.reserved_quantity),
    available_quantity: num(r.available_quantity),
    incoming_qty: num(r.incoming_qty),
    earliest_eta: r.earliest_eta == null ? null : String(r.earliest_eta),
    open_pos: num(r.open_pos),
    min_quantity: numOrNull(r.min_quantity),
    min_source: src,
    min_effective: numOrNull(r.min_effective),
    level: STOCK_LEVEL_ORDER.includes(lvl) ? lvl : 'ok',
    shortage: num(r.shortage),
    updated_at: r.updated_at == null ? null : String(r.updated_at),
  }
}

export function stockLevelRank(level: StockLevel): number {
  const i = STOCK_LEVEL_ORDER.indexOf(level)
  return i < 0 ? 99 : i
}

export function stockLevelLabel(level: StockLevel): string {
  switch (level) {
    case 'critical': return 'Krytyczny'
    case 'covered': return 'Pokryty dostawą'
    case 'low': return 'Niski'
    case 'inactive': return 'Nieaktywny'
    default: return 'OK'
  }
}

export function stockLevelHint(level: StockLevel): string {
  switch (level) {
    case 'critical': return 'Dostępne poniżej zera i zamówione tego nie pokrywają — trzeba dokupić'
    case 'covered': return 'Dostępne poniżej zera, ale otwarte ZD pokrywają brak — pilnuj terminu dostawy'
    case 'low': return 'Dostępne + w drodze poniżej minimum'
    case 'inactive': return 'Stan 0, bez rezerwacji, bez minimum, nic w drodze — nie pilnujemy'
    default: return 'Bez uwag'
  }
}

/** Czy poziom to realny problem (liczniki, eksport braków) */
export function isStockProblem(level: StockLevel): boolean {
  return level === 'critical' || level === 'covered' || level === 'low'
}

export function minSourceLabel(src: StockMinSource): string {
  if (src === 'shelf') return 'minimum półki'
  if (src === 'smart') return 'Smart ROP'
  if (src === 'component') return 'minimum komponentu'
  return 'brak minimum'
}

export type StockLevelCounts = Record<StockLevel, number>

export function countStockLevels(rows: Array<{ level: StockLevel }>): StockLevelCounts {
  const c: StockLevelCounts = { critical: 0, covered: 0, low: 0, ok: 0, inactive: 0 }
  for (const r of rows) c[r.level] = (c[r.level] ?? 0) + 1
  return c
}

/** Wiersz widoku „Wszystkie” — komponent z sumami po półkach */
export type AggregatedStockLevelRow = {
  component_id: number
  component_code: string
  component_name: string
  component_category: string | null
  component_unit: string | null
  supplier_id: number | null
  quantities: Record<number, number>
  /** minimum per magazyn (klucz = warehouse_id); brak klucza = brak półki */
  minByWarehouse: Record<number, number | null>
  minEffectiveByWarehouse: Record<number, number | null>
  total: number
  reserved: number
  available: number
  incoming: number
  /** najgorszy poziom wśród półek */
  level: StockLevel
  /** najniższe dostępne wśród półek (sortowanie krytycznych) */
  worstAvailable: number
  /** suma „do zamówienia” po półkach */
  shortage: number
  shelves: StockLevelRow[]
}

export function aggregateStockLevels(rows: StockLevelRow[]): AggregatedStockLevelRow[] {
  const map = new Map<number, AggregatedStockLevelRow>()
  for (const r of rows) {
    let agg = map.get(r.component_id)
    if (!agg) {
      agg = {
        component_id: r.component_id,
        component_code: r.component_code,
        component_name: r.component_name,
        component_category: r.component_category?.trim() ? r.component_category.trim() : null,
        component_unit: r.component_unit,
        supplier_id: r.supplier_id,
        quantities: {},
        minByWarehouse: {},
        minEffectiveByWarehouse: {},
        total: 0,
        reserved: 0,
        available: 0,
        incoming: 0,
        level: 'inactive',
        worstAvailable: Number.POSITIVE_INFINITY,
        shortage: 0,
        shelves: [],
      }
      map.set(r.component_id, agg)
    }
    agg.quantities[r.warehouse_id] = (agg.quantities[r.warehouse_id] ?? 0) + Number(r.quantity)
    agg.minByWarehouse[r.warehouse_id] = r.min_quantity
    agg.minEffectiveByWarehouse[r.warehouse_id] = r.min_effective
    agg.total += Number(r.quantity)
    agg.reserved += Number(r.reserved_quantity)
    agg.available += Number(r.available_quantity)
    agg.incoming += Number(r.incoming_qty)
    agg.shortage += Number(r.shortage)
    agg.worstAvailable = Math.min(agg.worstAvailable, Number(r.available_quantity))
    if (stockLevelRank(r.level) < stockLevelRank(agg.level)) agg.level = r.level
    agg.shelves.push(r)
  }
  return Array.from(map.values())
}

type Sortable = { level: StockLevel; shortage: number; component_code: string; component_name: string } & (
  | { available_quantity: number }
  | { worstAvailable: number }
)

function worstAvailableOf(r: Sortable): number {
  return 'worstAvailable' in r ? r.worstAvailable : r.available_quantity
}

/**
 * „Od najgorszych”: krytyczne (największy minus na górze) → pokryte dostawą →
 * niskie (największy brak na górze) → OK → nieaktywne; w obrębie poziomu po nazwie.
 */
export function compareByStockLevel(a: Sortable, b: Sortable): number {
  const ra = stockLevelRank(a.level)
  const rb = stockLevelRank(b.level)
  if (ra !== rb) return ra - rb
  if (a.level === 'critical' || a.level === 'covered') {
    const d = worstAvailableOf(a) - worstAvailableOf(b)
    if (d !== 0) return d
  }
  if (a.level === 'low') {
    const d = b.shortage - a.shortage
    if (d !== 0) return d
  }
  return (a.component_name || a.component_code).localeCompare(b.component_name || b.component_code, 'pl')
}

/** Pole minimum: '' / '-' = brak (null); liczba ≥ 0; inaczej 'invalid' */
export function parseMinInput(raw: string): number | null | 'invalid' {
  const s = raw.trim().replace(',', '.')
  if (s === '' || s === '-' || s === '—') return null
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return 'invalid'
  return Math.round(n * 1000) / 1000
}

// ── CSV braków — gotowa lista zakupów ────────────────────────────────
const cell = (v: unknown): string => {
  const s = v == null ? '' : String(v)
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const qty = (v: number | null | undefined): string => {
  const n = Number(v)
  if (v == null || !Number.isFinite(n)) return ''
  return String(Number(n.toFixed(3))).replace('.', ',')
}
const dateFromIso = (d: string | null | undefined): string => {
  if (!d) return ''
  const [y, m, day] = d.slice(0, 10).split('-')
  return y && m && day ? `${day}.${m}.${y}` : d
}

export function buildStockShortageCsv(rows: StockLevelRow[]): string {
  const header = ['Komponent', 'Kod', 'Magazyn', 'Poziom', 'Fizyczne', 'Zarezerwowane', 'Dostępne', 'W drodze', 'Najbliższa dostawa', 'Minimum', 'Do zamówienia', 'Jednostka']
  const lines = rows.map((r) =>
    [
      cell(r.component_name), cell(r.component_code), cell(r.warehouse_code), cell(stockLevelLabel(r.level)),
      qty(r.quantity), qty(r.reserved_quantity), qty(r.available_quantity), qty(r.incoming_qty), cell(dateFromIso(r.earliest_eta)),
      qty(r.min_effective), qty(r.shortage), cell(r.component_unit),
    ].join(';'),
  )
  return '﻿' + [header.map(cell).join(';'), ...lines].join('\r\n') + '\r\n'
}
