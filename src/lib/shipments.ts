// =====================================================================
// Wysyłki kurierem (SUUS) — czysta logika ekranu „Wysyłki” (27.11).
// Baza: order_shipments + order_shipment_orders (jedno zlecenie = jedna wysyłka),
// suggest_pallets(order_ids) podpowiada palety, trigger na order_shipments sam
// zdejmuje / oddaje palety na Bukowej przy statusie gotowa / nadana — UI tego NIE dubluje.
// =====================================================================

export type ShipmentStatus = 'zaplanowana' | 'gotowa' | 'nadana' | 'anulowana'

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  zaplanowana: 'Zaplanowana',
  gotowa: 'Gotowa (spakowana)',
  nadana: 'Nadana',
  anulowana: 'Anulowana',
}

/** Palety można zmieniać, dopóki wysyłka nie jest nadana (ani anulowana). */
export function canEditPallets(status: ShipmentStatus): boolean {
  return status === 'zaplanowana' || status === 'gotowa'
}

/** Nr zamówienia BaseLinker z client_order_number „57857794/GNIEWEK” → „57857794” (bez „/” — całość). */
export function blFromClientOrder(clientOrderNumber: string | null | undefined): string {
  const s = String(clientOrderNumber ?? '').trim()
  if (!s) return ''
  const i = s.indexOf('/')
  return (i >= 0 ? s.slice(0, i) : s).trim()
}

/** Klient z client_order_number „57857794/GNIEWEK” → „GNIEWEK” (bez „/” — pusto). */
export function clientFromClientOrder(clientOrderNumber: string | null | undefined): string {
  const s = String(clientOrderNumber ?? '').trim()
  const i = s.indexOf('/')
  return i >= 0 ? s.slice(i + 1).trim() : ''
}

/** bl_order_id (bigint) z numeru BL — tylko same cyfry, inaczej null. */
export function blOrderId(bl: string): number | null {
  return /^\d{1,18}$/.test(bl) ? Number(bl) : null
}

/** Wspólny nr BL zaznaczonych zleceń (wszystkie ten sam) albo pusto. */
export function commonBl(rows: Array<{ bl: string }>): string {
  const set = new Set(rows.map((r) => r.bl))
  return set.size === 1 ? [...set][0] : ''
}

/** Grupy po nr BL w kolejności pierwszego wystąpienia; wiersze bez BL — każdy osobno (klucz = id). */
export function groupByBl<T extends { id: number; bl: string }>(rows: T[]): Array<{ key: string; bl: string; rows: T[] }> {
  const out: Array<{ key: string; bl: string; rows: T[] }> = []
  const idx = new Map<string, number>()
  for (const r of rows) {
    const key = r.bl ? `bl:${r.bl}` : `id:${r.id}`
    const at = idx.get(key)
    if (at == null) {
      idx.set(key, out.length)
      out.push({ key, bl: r.bl, rows: [r] })
    } else {
      out[at].rows.push(r)
    }
  }
  return out
}

const pad = (n: number) => String(n).padStart(2, '0')
/** Data lokalna RRRR-MM-DD. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Najbliższy dzień roboczy OD JUTRA (bez sobót, niedziel i dni wolnych RRRR-MM-DD). */
export function nextWorkingDay(from: Date, dniWolne: Set<string> = new Set()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  for (let i = 0; i < 60; i++) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6 && !dniWolne.has(isoDate(d))) return isoDate(d)
  }
  return isoDate(d)
}

export type ShipmentLite = { id: number; ship_date: string | null; status: ShipmentStatus; pallets_vertical: number; pallets_horizontal: number }

/** Podsumowanie dnia: wysyłki (bez anulowanych) na datę, palety pionowe / poziome. */
export function daySummary(shipments: ShipmentLite[], date: string): { count: number; vertical: number; horizontal: number } {
  let count = 0
  let vertical = 0
  let horizontal = 0
  for (const s of shipments) {
    if (s.status === 'anulowana' || s.ship_date !== date) continue
    count++
    vertical += Number(s.pallets_vertical) || 0
    horizontal += Number(s.pallets_horizontal) || 0
  }
  return { count, vertical, horizontal }
}

/** Wysyłki pogrupowane po dacie (rosnąco; bez daty na końcu). */
export function groupByDate<T extends { ship_date: string | null }>(rows: T[]): Array<{ date: string | null; rows: T[] }> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const k = r.ship_date ?? ''
    m.set(k, [...(m.get(k) ?? []), r])
  }
  return [...m.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([k, list]) => ({ date: k || null, rows: list }))
}

/** Zlecenie do wysyłki: nieanulowane, bez wydania albo z wydaniem od dziś, nieprzypięte do wysyłki. */
export function isPendingForShipment(
  o: { id: number; release_date: string | null; extra_fields?: Record<string, unknown> | null },
  today: string,
  attached: Set<number>,
): boolean {
  if (attached.has(o.id)) return false
  if (o.extra_fields?.cancelled === true || o.extra_fields?.cancelled === 'true') return false
  return !o.release_date || o.release_date.slice(0, 10) >= today
}
