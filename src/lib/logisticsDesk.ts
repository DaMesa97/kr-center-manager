// =====================================================================
// Biurko kierownika logistyki (Wysyłka → „Do fakturowania”, makieta z 16–17.11.2026).
// Czyste reguły, bez React: dzień produkcji ↔ trasa, „na magazynie wysyłkowym”,
// ostrzeżenia w wierszu, brak RO, przypięcie do trasy, lista do druku.
// Testy: __tests__/logisticsDesk.test.ts
//
// Słownik (decyzje Tymka 17.11):
//  * „na magazynie” = drzwi stoją na Bukowej i można je ładować. STA i Titan-skrzydło:
//    data z Excela (release_date = przekazane z Marklowickiej). Reszta: odhaczone wszystkie
//    etapy (pakowanie). Techniczne / drzwi wewn. nie mają etapów → tylko po release_date.
//  * „wyjechało” = orders.shipped_at (przycisk „Trasa wyjechała”) — osobne od wydania.
//  * „do fakturowania” = extra_fields.ready_to_invoice, jak dotąd, nic go nie blokuje.
// =====================================================================
import type { Order } from '../types'
import { countCompletedStages, getDaysElapsed, isReleaseDateEmpty, isRushOrderSequence, isStTitanOrder, isTitanBastionOrder, orderSetCompleteness } from '../utils'
import { getOrderProblem } from './orderProblem'
import { ALU_MONTAZ_ROUTE, PERSONAL_PICKUP_ROUTE, getOrderRouteDay, type CompanyShippingInfo } from './companyMatch'

export const DESK_DAYS = ['PONIEDZIAŁEK', 'WTOREK', 'ŚRODA', 'CZWARTEK', 'PIĄTEK'] as const
export type DeskDay = (typeof DESK_DAYS)[number]

/** Dzień produkcji → trasa dwa dni robocze później (czwartek → poniedziałek) */
export const ROUTE_OF_PROD: Record<DeskDay, DeskDay> = {
  PONIEDZIAŁEK: 'ŚRODA', WTOREK: 'CZWARTEK', ŚRODA: 'PIĄTEK', CZWARTEK: 'PONIEDZIAŁEK', PIĄTEK: 'WTOREK',
}
export const PROD_OF_ROUTE: Record<DeskDay, DeskDay> = {
  ŚRODA: 'PONIEDZIAŁEK', CZWARTEK: 'WTOREK', PIĄTEK: 'ŚRODA', PONIEDZIAŁEK: 'CZWARTEK', WTOREK: 'PIĄTEK',
}

/** Firma bez dnia trasy — też musi dać się obejrzeć i oznaczyć (Tymek 17.11) */
export const NO_ROUTE = 'Bez trasy'
/** Trasy poza dniami tygodnia: odbiór osobisty, montaż własny (aluminium), brak trasy */
export const SPECIAL_ROUTES: readonly string[] = [PERSONAL_PICKUP_ROUTE, ALU_MONTAZ_ROUTE, NO_ROUTE]

/** Etykieta przycisku wyjazdu dla trasy: odbiór osobisty to nie bus */
export function shipButtonLabel(route: string): string {
  if (route === PERSONAL_PICKUP_ROUTE) return 'Odebrane osobiście'
  if (route === ALU_MONTAZ_ROUTE) return 'Wyjechało na montaż'
  return 'Trasa wyjechała'
}

export function isDeskDay(v: string | null | undefined): v is DeskDay {
  return (DESK_DAYS as readonly string[]).includes(String(v ?? ''))
}

/** Dzień tygodnia (PL, wielkie litery) z daty lokalnej; weekend → PONIEDZIAŁEK */
export function deskDayOf(d: Date): DeskDay {
  const i = d.getDay()
  if (i >= 1 && i <= 5) return DESK_DAYS[i - 1]
  return 'PONIEDZIAŁEK'
}

/** Dzisiejsza trasa = trasa dla dzisiejszego dnia produkcji (poniedziałek → środa) */
export function defaultRouteForToday(today = new Date()): { prod: DeskDay; route: DeskDay } {
  const prod = deskDayOf(today)
  return { prod, route: ROUTE_OF_PROD[prod] }
}

export type DeskWarehouseState = {
  /** drzwi stoją na magazynie wysyłkowym (Bukowa) */
  packed: boolean
  /** skąd to wiemy */
  source: 'wydanie' | 'etapy' | 'brak'
  /** krótki opis do tooltipa */
  label: string
}

/** Marklowicka: STA i Titan-skrzydło (noga STA) — „na magazynie” dopiero po wydaniu z Excela */
export function isMarklowickaOrder(order: Order): boolean {
  if (order.category === 'STA') return true
  if (order.category === 'Bastion' && isTitanBastionOrder(order)) return false
  return false
}

export function deskWarehouseState(order: Order): DeskWarehouseState {
  const released = !!order.release_date && !isReleaseDateEmpty(order.release_date)
  if (isMarklowickaOrder(order)) {
    return released
      ? { packed: true, source: 'wydanie', label: `Przekazane z Marklowickiej na Bukową ${fmtDay(order.release_date)}` }
      : { packed: false, source: 'wydanie', label: 'Jeszcze na Marklowickiej (brak wydania w Excelu)' }
  }
  const cat = order.category ?? ''
  if (cat === 'Techniczne' || cat === 'DrzwiWewnetrzne' || cat === 'Aluminium') {
    return released
      ? { packed: true, source: 'wydanie', label: `Wydane ${fmtDay(order.release_date)}` }
      : { packed: false, source: 'brak', label: 'Kategoria bez etapów — stan magazynu nieznany' }
  }
  const st = countCompletedStages(order)
  if (st.total === 0) {
    return released
      ? { packed: true, source: 'wydanie', label: `Wydane ${fmtDay(order.release_date)}` }
      : { packed: false, source: 'brak', label: 'Brak etapów' }
  }
  const packed = st.completed >= st.total
  return {
    packed,
    source: 'etapy',
    label: packed ? `Wszystkie etapy odhaczone (${st.completed}/${st.total})` : `Etapy ${st.completed}/${st.total} — brakuje: ${st.stages.filter((s) => !s.done).map((s) => s.header).join(', ')}`,
  }
}

/** RO z Optimy przekazuje się tylko dla zleceń z konfiguratora — tam brak RO to problem fakturzystki */
export function deskNoRo(order: Order): boolean {
  return !String(order.erp_ro_number ?? '').trim() && order.source === 'bot'
}

export type DeskWarning = { kind: 'glass' | 'pair' | 'stock' | 'rush' | 'problem' | 'titan'; text: string }

/** Ostrzeżenia do wiersza: nic nie blokuje, tylko informuje */
export function deskWarnings(order: Order, allOrders: Order[]): DeskWarning[] {
  const out: DeskWarning[] = []
  if (order.glass_order_date && !order.glass_received) {
    out.push({ kind: 'glass', text: `szyba zamówiona ${fmtDay(order.glass_order_date)}, jeszcze nie ma` })
  }
  // Tymek 24.11: gdy drzwi już stoją NA MAGAZYNIE wysyłkowym, ostrzeżenie o nieodhaczonych etapach
  // kompletu nie ma znaczenia — towar jest, brakuje tylko „ptaszków” w Excelu / programie.
  if (!deskWarehouseState(order).packed) {
    const set = orderSetCompleteness(order, allOrders)
    if (set && !set.complete && set.missing.length) {
      out.push({ kind: 'pair', text: `niekompletny komplet: ${set.missing.join(', ')}` })
    }
  }
  // Tylko realne braki (Tymek 17.11): „brak receptury” / „częściowa receptura” to sprawa
  // magazynu i receptur, nie logistyki — na biurku tylko śmieciły i odrywały uwagę.
  if (String(order.stock_status ?? '') === 'insufficient') out.push({ kind: 'stock', text: 'niedobór magazynowy' })
  if (isRushOrderSequence(order.sequence)) out.push({ kind: 'rush', text: 'PILNE' })
  // flaga z hali (#87) to obiekt {reason, at, by} — stary warunek `problem === true` nigdy nie łapał (zwiad 21.11)
  const problem = getOrderProblem(order)
  if (problem) out.push({ kind: 'problem', text: `problem: ${problem.reason}` })
  if (order.category === 'ST' && isStTitanOrder(order)) out.push({ kind: 'titan', text: 'noga Titan (ościeżnica)' })
  return out
}

// ── przypięcie do trasy (extra_fields.route_pin) ─────────────────────
export type RoutePin = { route: string; at: string }

export function readRoutePin(order: Order): RoutePin | null {
  const extra = order.extra_fields as Record<string, unknown> | null
  const pin = extra?.route_pin as RoutePin | undefined
  if (!pin || typeof pin.route !== 'string' || !pin.route) return null
  // przypięcie wygasa po 7 dniach — nie zostawiamy zleceń „na wieki” na cudzej trasie
  const at = pin.at ? new Date(pin.at).getTime() : NaN
  if (Number.isFinite(at) && Date.now() - at > 7 * 86_400_000) return null
  return pin
}

/** Trasa zlecenia na biurku: przypięcie wygrywa nad firmą; firma bez trasy = „Bez trasy” */
export function deskRouteOf(order: Order, companyInfo: CompanyShippingInfo | null | undefined): string {
  const pin = readRoutePin(order)
  if (pin) return pin.route
  return getOrderRouteDay(order, companyInfo) || NO_ROUTE
}

/** Wyjechało dziś (lokalnie) — zostaje na liście z plakietką; starsze znikają */
export function shippedToday(order: Order, today = new Date()): boolean {
  if (!order.shipped_at) return false
  const d = new Date(order.shipped_at)
  return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()
}

export function isShipped(order: Order): boolean {
  return !!order.shipped_at
}

/** Wiek w dniach roboczych + próg koloru (jak w makiecie: > 21 flaga) */
export function deskAge(order: Order): { days: number; level: 'ok' | 'warn' | 'late' } {
  const days = getDaysElapsed(order)
  return { days, level: days > 21 ? 'late' : days > 14 ? 'warn' : 'ok' }
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}.${m[2]}` : iso
}

export function fmtDayFull(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}

/** „Steel Extra · Antracyt · 90P” — system, kolor skrzydła, rozmiar z kierunkiem */
export function deskSpec(order: Order): { system: string; color: string; size: string } {
  const dir = String(order.direction ?? '').trim().toUpperCase()
  const dirShort = dir.startsWith('L') ? 'L' : dir.startsWith('P') ? 'P' : dir
  const width = String(order.width ?? '').trim()
  return {
    system: String(order.system ?? '').trim(),
    color: String(order.wing_color ?? '').trim(),
    size: `${width}${dirShort}`.trim(),
  }
}

export const PERSONAL_PICKUP = PERSONAL_PICKUP_ROUTE

// ── lista do druku ───────────────────────────────────────────────────
export type PrintRow = { nr: string; cat: string; model: string; spec: string; qty: number; client: string; ro: string; noRo: boolean }
export type PrintFirm = { name: string; rows: PrintRow[] }

/** Zestawienie „do fakturowania” per trasa: tylko oznaczone, bez cen, firma po firmie */
export function buildPrintList(firms: Array<{ name: string; orders: Order[] }>, isMarked: (o: Order) => boolean): PrintFirm[] {
  const out: PrintFirm[] = []
  for (const f of firms) {
    const rows = f.orders.filter(isMarked).map((o) => {
      const s = deskSpec(o)
      return {
        nr: o.order_number,
        cat: o.category ?? '',
        model: o.model ?? '',
        spec: [s.system, s.color, s.size].filter(Boolean).join(' · '),
        qty: Number(o.quantity) || 1,
        client: String(o.client_order_number ?? '').trim(),
        ro: String(o.erp_ro_number ?? '').trim(),
        noRo: deskNoRo(o),
      }
    })
    if (rows.length) out.push({ name: f.name, rows })
  }
  return out
}
