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

/**
 * Nr zamówienia BaseLinker = pierwszy ciąg dokładnie 8 cyfr w client_order_number: „57857794/GNIEWEK”,
 * „1066 VIVENTO (zamówienie 55204048/Hanak)”. Bez takiego ciągu — pusto (zlecenie idzie osobno, bez sklejania:
 * „557/09/2026” czy „OF/WASILEWSKI” to nie numery BL). Testy 27.11.
 */
export function blFromClientOrder(clientOrderNumber: string | null | undefined): string {
  const m = /(?:^|\D)(\d{8})(?!\d)/.exec(String(clientOrderNumber ?? ''))
  return m ? m[1] : ''
}

/** Klient z client_order_number: tekst po „<nr BL>/” („55204048/Hanak)” → „Hanak”), bez nr BL — po pierwszym „/”. */
export function clientFromClientOrder(clientOrderNumber: string | null | undefined): string {
  const s = String(clientOrderNumber ?? '').trim()
  const bl = blFromClientOrder(s)
  const po = bl ? s.slice(s.indexOf(bl) + bl.length) : s
  const i = po.indexOf('/')
  if (i < 0) return ''
  return po.slice(i + 1).replace(/[)\]]+\s*$/, '').trim()
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

/** Data RRRR-MM-DD to sobota, niedziela albo dzień wolny (święto) — ostrzeżenie w oknie planowania. */
export function isNonWorkingDay(iso: string, dniWolne: Set<string> = new Set()): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return false
  const dow = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()
  return dow === 0 || dow === 6 || dniWolne.has(iso)
}

/** „Oczekuje” dłużej niż 3 min = BaseLinker / funkcja nie odpowiedziały — ekran pokazuje „Ponów” (baza też wpuszcza po 3 min). */
export const BL_OCZEKUJE_MS = 3 * 60_000
export function blOczekujeZaDlugo(s: { bl_status?: string | null; bl_requested_at?: string | null }, now = Date.now()): boolean {
  if (s.bl_status !== 'oczekuje') return false
  const t = Date.parse(String(s.bl_requested_at ?? ''))
  return !Number.isFinite(t) || now - t > BL_OCZEKUJE_MS
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

/** RRRR-MM-DD + n dni roboczych (bez sobót, niedziel i dni wolnych) — data doręczenia SUUS = wysyłka + 2. */
export function addWorkingDays(iso: string, n: number, dniWolne: Set<string> = new Set()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  let added = 0
  for (let i = 0; i < 60 && added < n; i++) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6 && !dniWolne.has(isoDate(d))) added++
  }
  return isoDate(d)
}

const DNI_KR = ['nd.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.']
/** „2026-11-30” → „pon. 30.11.2026” (pusto przy złej dacie). */
export function dayLabel(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  if (!m) return ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return `${DNI_KR[d.getDay()]} ${m[3]}.${m[2]}.${m[1]}`
}

/** Sekcja listy „Do wysyłki”: gotowe (produkcja skończona), w produkcji, stare do sprawdzenia (zamówione ponad 30 dni temu). */
/** Metoda dostawy z BaseLinkera: kurier (Kurier, KURIER, Kurier (PoDrzwi)), inna (odbiór osobisty, montaż), brak danych (bez nr BL albo zamówienia nie ma w synchronizacji BL). */
export type RodzajDostawy = 'kurier' | 'inna' | 'brak'
export function rodzajDostawy(metoda: string | null | undefined, maBl: boolean): RodzajDostawy {
  if (!maBl || metoda == null || !String(metoda).trim()) return 'brak'
  return /kurier/i.test(String(metoda)) ? 'kurier' : 'inna'
}

export type PendingSection = 'gotowe' | 'produkcja' | 'stare'
export const STARE_PO_DNIACH = 30

export function pendingSection(o: { order_date: string | null; ready: boolean }, today: string): PendingSection {
  const od = String(o.order_date ?? '').slice(0, 10)
  if (od && today) {
    const ms = Date.parse(`${today}T12:00:00`) - Date.parse(`${od}T12:00:00`)
    if (Number.isFinite(ms) && ms > STARE_PO_DNIACH * 86_400_000) return 'stare'
  }
  return o.ready ? 'gotowe' : 'produkcja'
}

/** Dni od zamówienia (do etykiety „44 dni”). */
export function daysSince(orderDate: string | null | undefined, today: string): number | null {
  const od = String(orderDate ?? '').slice(0, 10)
  if (!od) return null
  const ms = Date.parse(`${today}T12:00:00`) - Date.parse(`${od}T12:00:00`)
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null
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
