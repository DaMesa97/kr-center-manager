// Statystyki per firma (#118, Tymek 6.11): czysta logika dla zakładki
// Statystyki → Firmy. Liczy na zleceniach i reklamacjach trzymanych w pamięci
// (Statystyki ładują wszystkie wiersze), bez zapytań do bazy.
import type { Complaint, Order } from '../types'
import { isReleaseDateEmpty } from '../utils'

/** 0 = cały okres */
export type CompanyPeriodMonths = 0 | 3 | 6 | 12 | 24

export function normCompany(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
}

export function isCancelledOrder(o: Order): boolean {
  const ef = o.extra_fields as Record<string, unknown> | null | undefined
  return ef?.cancelled === true
}

/**
 * Nazwy firm z zleceń (bez anulowanych), od najczęstszej. Jedna firma bywa
 * zapisana różnie („PO DRZWI” / „PO DRZWI ŻORY”), dlatego lista jest po
 * dokładnej pisowni, a dopasowanie zapytania „zawiera” łapie warianty.
 */
export function companyNames(orders: Order[]): Array<{ name: string; count: number }> {
  const map = new Map<string, number>()
  for (const o of orders) {
    if (isCancelledOrder(o)) continue
    const name = String(o.company ?? '').trim()
    if (!name) continue
    map.set(name, (map.get(name) ?? 0) + 1)
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pl'))
}

/** Dokładne trafienie (bez wielkości liter) wygrywa; inaczej wszystkie nazwy zawierające zapytanie. */
export function resolveCompanyQuery(query: string, names: string[]): string[] {
  const q = normCompany(query)
  if (!q) return []
  const exact = names.filter((n) => normCompany(n) === q)
  if (exact.length > 0) return exact
  return names.filter((n) => normCompany(n).includes(q))
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Pierwszy dzień miesiąca sprzed (months − 1) miesięcy; null = bez ograniczenia. */
export function periodStartIso(months: CompanyPeriodMonths, now: Date = new Date()): string | null {
  if (!months) return null
  const d = new Date(now.getFullYear(), now.getMonth() - months + 1, 1)
  return `${monthKey(d)}-01`
}

function daysBetween(from: string, to: string): number | null {
  const a = new Date(from)
  const b = new Date(to)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null
  const d = Math.round((b.getTime() - a.getTime()) / 86_400_000)
  return d >= 0 ? d : null
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function complaintDate(c: Complaint): string {
  return String(c.complaint_date || c.created_at || '').slice(0, 10)
}

export type NamedValue = { name: string; value: number }
export type CompanyMonthRow = { month: string; qty: number; orders: number; complaints: number }

export type CompanyStats = {
  companies: string[]
  orders: number
  pieces: number
  open: number
  released: number
  fromConfigurator: number
  complaints: number
  /** reklamacje na 100 zleceń (null, gdy brak zleceń) */
  complaintsPer100: number | null
  avgDays: number | null
  medianDays: number | null
  leadCount: number
  lastOrderDate: string | null
  byMonth: CompanyMonthRow[]
  byCategory: NamedValue[]
  topModels: NamedValue[]
  topColors: NamedValue[]
  recent: Order[]
}

export function computeCompanyStats(
  allOrders: Order[],
  allComplaints: Complaint[],
  companies: string[],
  months: CompanyPeriodMonths,
  now: Date = new Date(),
): CompanyStats {
  const wanted = new Set(companies.map(normCompany))
  const from = periodStartIso(months, now)

  const orders = allOrders.filter((o) => {
    if (!wanted.has(normCompany(o.company))) return false
    if (isCancelledOrder(o)) return false
    const d = String(o.order_date || (o as { created_at?: string }).created_at || '').slice(0, 10)
    return !from || d >= from
  })
  const complaints = allComplaints.filter((c) => {
    if (!wanted.has(normCompany(c.company))) return false
    const d = complaintDate(c)
    return !from || d >= from
  })

  const qty = (o: Order) => Number(o.quantity) || 1

  let pieces = 0
  let open = 0
  let released = 0
  let fromConfigurator = 0
  const leadDays: number[] = []
  let lastOrderDate: string | null = null
  const byCategory = new Map<string, number>()
  const byModel = new Map<string, number>()
  const byColor = new Map<string, number>()
  const byMonth = new Map<string, CompanyMonthRow>()

  if (from) {
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      byMonth.set(monthKey(d), { month: monthKey(d), qty: 0, orders: 0, complaints: 0 })
    }
  }
  const monthRow = (key: string): CompanyMonthRow | null => {
    if (!/^\d{4}-\d{2}$/.test(key)) return null
    if (!byMonth.has(key)) {
      if (from) return null
      byMonth.set(key, { month: key, qty: 0, orders: 0, complaints: 0 })
    }
    return byMonth.get(key)!
  }

  for (const o of orders) {
    const q = qty(o)
    pieces += q
    if (isReleaseDateEmpty(o.release_date)) open += 1
    else {
      released += 1
      if (o.order_date && o.release_date) {
        const d = daysBetween(o.order_date, String(o.release_date))
        if (d != null) leadDays.push(d)
      }
    }
    if (o.source === 'bot') fromConfigurator += 1
    const d = String(o.order_date || (o as { created_at?: string }).created_at || '').slice(0, 10)
    if (d && (!lastOrderDate || d > lastOrderDate)) lastOrderDate = d
    const cat = String(o.category || '(brak)')
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + q)
    const model = (o.model || '').trim() || '(brak)'
    byModel.set(model, (byModel.get(model) ?? 0) + q)
    const color = (o.wing_color || '').trim() || '(brak)'
    byColor.set(color, (byColor.get(color) ?? 0) + q)
    const row = monthRow(d.slice(0, 7))
    if (row) {
      row.qty += q
      row.orders += 1
    }
  }
  for (const c of complaints) {
    const row = monthRow(complaintDate(c).slice(0, 7))
    if (row) row.complaints += 1
  }

  const toSorted = (m: Map<string, number>, limit: number): NamedValue[] =>
    Array.from(m.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, limit)

  const avg = leadDays.length ? Math.round((leadDays.reduce((s, d) => s + d, 0) / leadDays.length) * 10) / 10 : null

  const recent = [...orders]
    .sort((a, b) => String(b.order_date || '').localeCompare(String(a.order_date || '')) || (Number(b.id) || 0) - (Number(a.id) || 0))
    .slice(0, 20)

  return {
    companies,
    orders: orders.length,
    pieces,
    open,
    released,
    fromConfigurator,
    complaints: complaints.length,
    complaintsPer100: orders.length ? Math.round((complaints.length / orders.length) * 1000) / 10 : null,
    avgDays: avg,
    medianDays: median(leadDays),
    leadCount: leadDays.length,
    lastOrderDate,
    byMonth: Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month)),
    byCategory: toSorted(byCategory, 10),
    topModels: toSorted(byModel, 10),
    topColors: toSorted(byColor, 10),
    recent,
  }
}
