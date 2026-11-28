// Statystyki per firma (#118, Tymek 6.11): czysta logika dla zakładki
// Statystyki → Firmy. Liczy na zleceniach i reklamacjach podanych z zewnątrz, bez zapytań do bazy.
// D47 (28.11): lista firm z liczników pisowni policzonych w bazie (companyNamesFromCounts), karta firmy
// z samych zleceń wybranej firmy (rpc stat_zlecenia_firm).
//
// Porządek nazw (Tymek 20.11): jedna firma bywa zapisana na kilka sposobów.
//  * companyKey skleja automatycznie różnice wielkości liter, ogonków, „#”, interpunkcji
//    i powtórzonego słowa („BEL-POL WAŁBRZYCH WAŁBRZYCH” = „Bel-Pol Wałbrzych”);
//  * resztę („PO DRZWI” = „PO DRZWI ŻORY”) scala kierownik → tabela company_aliases
//    (ta sama, z której trigger podmienia nazwę przy zleceniu z bota): alias_name → company_name.
//    Tu: CompanyAliases = Map(companyKey(alias_name) → company_name). Zleceń nie przepisujemy.
// Rekordy łączone (trójka Titan, para Disting Plus) liczymy raz — isLinkedSecondary.
import type { Complaint, Order } from '../types'
import { isReleaseDateEmpty } from '../utils'
import { isExtraCancelled } from './orderCancelled'
import { titanGroupValue } from './titanGroup'
import { mediana } from './mediana'

/** Kategorie, których konfigurator nie wysyła (Tymek 26.11) — poza udziałem „z konfiguratora” */
export const KONFIGURATOR_POZA = ['Techniczne', 'DrzwiWewnetrzne'] as const

/** 0 = cały okres */
export type CompanyPeriodMonths = 0 | 3 | 6 | 12 | 24

/** companyKey(wariantu) → nazwa, pod którą liczymy */
export type CompanyAliases = Map<string, string>

export function normCompany(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
}

/**
 * Klucz porównawczy nazwy firmy: wielkie litery bez ogonków, bez „#” i interpunkcji,
 * pojedyncze spacje, bez powtórzonego pod rząd słowa.
 * „PO DRZWI Żory” → „PO DRZWI ZORY”, „ROJAR # TUCHÓW” → „ROJAR TUCHOW”.
 */
export function companyKey(value: unknown): string {
  const s = String(value ?? '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
  const out: string[] = []
  for (const t of s.split(' ')) {
    if (t && out[out.length - 1] !== t) out.push(t)
  }
  return out.join(' ')
}

/** Map z wierszy company_aliases (alias_name → company_name) kluczowana companyKey. */
export function buildCompanyAliases(rows: Array<{ alias_name: string; company_name: string }>): CompanyAliases {
  const m: CompanyAliases = new Map()
  for (const r of rows) {
    const k = companyKey(r.alias_name)
    const canon = String(r.company_name ?? '').trim()
    if (k && canon) m.set(k, canon)
  }
  return m
}

/** Klucz grupy: alias (jeśli kierownik scalił) albo companyKey. */
export function companyGroupKey(name: unknown, aliases?: CompanyAliases): string {
  const k = companyKey(name)
  const canon = aliases?.get(k)
  return canon ? companyKey(canon) : k
}

export function isCancelledOrder(o: Order): boolean {
  const ef = o.extra_fields as Record<string, unknown> | null | undefined
  return isExtraCancelled(ef)
}

export function isCancelledComplaint(c: Complaint): boolean {
  const ef = c.extra_fields as Record<string, unknown> | null | undefined
  return isExtraCancelled(ef)
}

/**
 * Rekord łączony liczony przez partnera, nie sam: nogi STA i ST trójki Titan (liczy się
 * rekord Bastion) oraz skrzydło STA pary Disting Plus (liczy się rekord Disting).
 * Bez tego firma, która zamówiła 1 Titan, miała w statystykach 3 sztuki.
 */
export function isLinkedSecondary(o: Order): boolean {
  const ef = o.extra_fields as Record<string, unknown> | null | undefined
  if (titanGroupValue(ef?.titan_group) != null && o.category !== 'Bastion') return true
  if (o.linked_order_id != null && o.category === 'STA' && /DISTING\s*PLUS/i.test(String(o.system ?? ''))) return true
  return false
}

export type CompanyVariant = { name: string; count: number }
export type CompanyGroup = {
  /** nazwa wyświetlana: alias kierownika albo najczęstsza pisownia */
  name: string
  count: number
  key: string
  variants: CompanyVariant[]
}

/**
 * Firmy z zleceń (bez anulowanych i bez nóg rekordów łączonych), od najczęstszej,
 * sklejone po companyKey + aliasach. Każda grupa pamięta swoje pisownie.
 */
/** Data wydania wpisana przez excel-sync z dnia synchronizacji (sam znacznik „X”, bez daty) — nie do liczenia czasu realizacji. */
export function dataWydaniaSzacunkowa(o: Pick<Order, 'extra_fields'>): boolean {
  return (o.extra_fields as Record<string, unknown> | null | undefined)?.release_date_szacunkowa === true
}

/** Pisownia firmy (po trim) i liczba jej zleceń — bez anulowanych i nóg rekordów łączonych; kolejność = pierwsze wystąpienie. */
export type CompanyNameCount = { name: string; count: number }

/** D47: to samo liczy baza (`stat_zlecenia_podsumowanie` → `firmy`), żeby nie ładować zleceń do przeglądarki. */
export function companyNameCounts(orders: Order[]): CompanyNameCount[] {
  const counts = new Map<string, number>()
  for (const o of orders) {
    if (isCancelledOrder(o) || isLinkedSecondary(o)) continue
    const name = String(o.company ?? '').trim()
    if (!name) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return Array.from(counts.entries()).map(([name, count]) => ({ name, count }))
}

export function companyNames(orders: Order[], aliases?: CompanyAliases): CompanyGroup[] {
  return companyNamesFromCounts(companyNameCounts(orders), aliases)
}

/** Grupy firm z gotowych liczników pisowni (z bazy albo z companyNameCounts). */
export function companyNamesFromCounts(counts: CompanyNameCount[], aliases?: CompanyAliases): CompanyGroup[] {
  const groups = new Map<string, Map<string, number>>()
  for (const { name: raw, count: n } of counts) {
    const name = String(raw ?? '').trim()
    if (!name) continue
    const gk = companyGroupKey(name, aliases)
    let m = groups.get(gk)
    if (!m) {
      m = new Map()
      groups.set(gk, m)
    }
    m.set(name, (m.get(name) ?? 0) + (Number(n) || 0))
  }
  const canonByGroup = new Map<string, string>()
  if (aliases) for (const canon of aliases.values()) canonByGroup.set(companyKey(canon), canon)
  return Array.from(groups.entries())
    .map(([key, m]) => {
      const variants = Array.from(m.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pl'))
      const count = variants.reduce((s, v) => s + v.count, 0)
      return { key, name: canonByGroup.get(key) ?? variants[0].name, count, variants }
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pl'))
}

/** Dokładne trafienie (po companyKey, także w wariant pisowni) wygrywa; inaczej wszystkie grupy zawierające zapytanie. */
export function resolveCompanyGroups(query: string, groups: CompanyGroup[]): CompanyGroup[] {
  const q = companyKey(query)
  if (!q) return []
  const exact = groups.filter((g) => g.key === q || g.variants.some((v) => companyKey(v.name) === q))
  if (exact.length > 0) return exact
  return groups.filter((g) => g.key.includes(q) || g.variants.some((v) => companyKey(v.name).includes(q)))
}

/** Wersja na samych nazwach (bez grup) — dokładne trafienie bez wielkości liter wygrywa, inaczej „zawiera”. */
export function resolveCompanyQuery(query: string, names: string[]): string[] {
  const q = normCompany(query)
  if (!q) return []
  const exact = names.filter((n) => normCompany(n) === q)
  if (exact.length > 0) return exact
  return names.filter((n) => normCompany(n).includes(q))
}

export type SuspectedCluster = { stem: string; groups: CompanyGroup[]; total: number }

/**
 * Podejrzane warianty do ręcznego scalenia: grupy o wspólnych dwóch pierwszych słowach
 * (jedno, gdy nazwa jednosłowna), których companyKey ani aliasy jeszcze nie skleiły.
 * To tylko podpowiedź — „BEL-POL Opole” i „BEL-POL Lubin” to różne sklepy.
 */
export function suspectedCompanyClusters(groups: CompanyGroup[]): SuspectedCluster[] {
  const byStem = new Map<string, CompanyGroup[]>()
  for (const g of groups) {
    const stem = g.key.split(' ').slice(0, 2).join(' ')
    if (!stem) continue
    const list = byStem.get(stem)
    if (list) list.push(g)
    else byStem.set(stem, [g])
  }
  return Array.from(byStem.entries())
    .filter(([, list]) => list.length > 1)
    .map(([stem, list]) => ({ stem, groups: list, total: list.reduce((s, g) => s + g.count, 0) }))
    .sort((a, b) => b.total - a.total || a.stem.localeCompare(b.stem, 'pl'))
}

/** Funkcja nazwa → nazwa wyświetlana grupy (do „top firm” w innych statystykach). */
export function companyCanonizer(orders: Order[], aliases?: CompanyAliases): (name: unknown) => string {
  return companyCanonizerFromGroups(companyNames(orders, aliases), aliases)
}

/** Jak companyCanonizer, z gotowych grup (D47: grupy z liczników policzonych w bazie). */
export function companyCanonizerFromGroups(groups: CompanyGroup[], aliases?: CompanyAliases): (name: unknown) => string {
  const display = new Map<string, string>()
  for (const g of groups) display.set(g.key, g.name)
  return (name: unknown) => {
    const raw = String(name ?? '').trim()
    if (!raw) return ''
    const gk = companyGroupKey(raw, aliases)
    return display.get(gk) ?? aliases?.get(companyKey(raw)) ?? raw
  }
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

/** Dni między datami (zaokrąglone); ujemne albo błędne daty → null. Wspólne dla Statystyk. */
export function daysBetween(from: string, to: string): number | null {
  const a = new Date(from)
  const b = new Date(to)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null
  const d = Math.round((b.getTime() - a.getTime()) / 86_400_000)
  return d >= 0 ? d : null
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
  /** zleceń w kategoriach, które konfigurator wysyła (bez Technicznych i Drzwi wewnętrznych) — mianownik % z konfiguratora */
  configuratorEligible: number
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
  aliases?: CompanyAliases,
): CompanyStats {
  const wanted = new Set(companies.map((c) => companyGroupKey(c, aliases)))
  const from = periodStartIso(months, now)

  const orders = allOrders.filter((o) => {
    if (!wanted.has(companyGroupKey(o.company, aliases))) return false
    if (isCancelledOrder(o) || isLinkedSecondary(o)) return false
    const d = String(o.order_date || (o as { created_at?: string }).created_at || '').slice(0, 10)
    return !from || d >= from
  })
  const complaints = allComplaints.filter((c) => {
    if (!wanted.has(companyGroupKey(c.company, aliases))) return false
    if (isCancelledComplaint(c)) return false
    const d = complaintDate(c)
    return !from || d >= from
  })

  const qty = (o: Order) => Number(o.quantity) || 1

  let pieces = 0
  let open = 0
  let released = 0
  let fromConfigurator = 0
  let configuratorEligible = 0
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
      // runda 4 (recenzent): data z dnia synchronizacji Excela (sam znacznik „X”) fałszowała średnią firmy (59 dni zamiast 8)
      if (o.order_date && o.release_date && !dataWydaniaSzacunkowa(o)) {
        const d = daysBetween(o.order_date, String(o.release_date))
        if (d != null) leadDays.push(d)
      }
    }
    if (o.source === 'bot') fromConfigurator += 1
    if (!(KONFIGURATOR_POZA as readonly string[]).includes(String(o.category ?? ''))) configuratorEligible += 1
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
    configuratorEligible,
    complaints: complaints.length,
    complaintsPer100: orders.length ? Math.round((complaints.length / orders.length) * 1000) / 10 : null,
    avgDays: avg,
    medianDays: mediana(leadDays),
    leadCount: leadDays.length,
    lastOrderDate,
    byMonth: Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month)),
    byCategory: toSorted(byCategory, 10),
    topModels: toSorted(byModel, 10),
    topColors: toSorted(byColor, 10),
    recent,
  }
}
