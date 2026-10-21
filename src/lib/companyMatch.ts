import type { Order } from '../types'

// Dzień produkcji / trasa w Wysyłce — wspólne dla tabeli, modala szczegółów i mobile.

export type CompanyShippingInfo = { production_day: string; route_day: string }

export const PERSONAL_PICKUP_ROUTE = 'Odbiór osobisty'

// Wartości z importu typu '#N/A', '-' traktujemy jak puste
export function cleanCompanyValue(v: unknown): string {
  const s = String(v ?? '').trim()
  if (!s || s === '-' || s === '—' || /^#N\/?A$/i.test(s)) return ''
  return s
}

const normName = (v: unknown) => String(v ?? '').trim().toLowerCase()

const tokens = (v: unknown): string[] =>
  String(v ?? '').trim().toUpperCase().split(/[\s#,]+/).filter(Boolean)

// Jak companiesMatch w orders-excel-intake: równe albo wszystkie słowa krótszej
// nazwy zawierają się w dłuższej ('PO DRZWI' ~ 'PO DRZWI ŻORY', 'X # GLIWICE')
export function companiesMatch(a: unknown, b: unknown): boolean {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.length === 0 || tb.length === 0) return false
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  return shorter.every((t) => longer.includes(t))
}

/**
 * Szuka firmy: najpierw dokładnie (lower/trim), potem tolerancyjnie po słowach.
 * Przy kilku dopasowaniach wygrywa to z największą liczbą wspólnych słów;
 * remis z różnymi danymi = brak dopasowania (nie zgadujemy trasy).
 */
export function findCompanyInfo<T extends CompanyShippingInfo>(
  map: Map<string, T>,
  company: string | null | undefined,
): T | null {
  const key = normName(company)
  if (!key) return null
  const exact = map.get(key)
  if (exact) return exact
  const orderTokens = tokens(company)
  let best: T | null = null
  let bestScore = 0
  let tie = false
  for (const [name, info] of map) {
    if (!companiesMatch(name, company)) continue
    const nameTokens = tokens(name)
    const score = nameTokens.filter((t) => orderTokens.includes(t)).length
    if (score > bestScore) {
      best = info
      bestScore = score
      tie = false
    } else if (score === bestScore && best) {
      if (
        cleanCompanyValue(best.route_day) !== cleanCompanyValue(info.route_day) ||
        cleanCompanyValue(best.production_day) !== cleanCompanyValue(info.production_day)
      ) {
        tie = true
      }
    }
  }
  return tie ? null : best
}

// Resolver z pamięcią — tabela woła lookup wiele razy na zamówienie (filtry, sort)
export function createCompanyResolver<T extends CompanyShippingInfo>(map: Map<string, T>) {
  const cache = new Map<string, T | null>()
  return (company: string | null | undefined): T | null => {
    const key = normName(company)
    if (cache.has(key)) return cache.get(key) ?? null
    const found = findCompanyInfo(map, company)
    cache.set(key, found)
    return found
  }
}

const PICKUP_RE = /ODBI[OÓ]R\s+OSOBIST/iu

/** Zamówienie z adnotacją „ODBIÓR OSOBISTY" w uwagach / extra_fields */
export function isPersonalPickup(order: Pick<Order, 'notes' | 'extra_fields'>): boolean {
  if (PICKUP_RE.test(String(order.notes ?? ''))) return true
  const extra = order.extra_fields
  if (!extra) return false
  try {
    return PICKUP_RE.test(typeof extra === 'string' ? extra : JSON.stringify(extra))
  } catch {
    return false
  }
}

/** Dzień produkcji: z zamówienia, firma tylko jako fallback (nie dla odbioru osobistego) */
export function getOrderProductionDay(
  order: Pick<Order, 'production_day' | 'notes' | 'extra_fields'>,
  companyInfo: CompanyShippingInfo | null | undefined,
): string {
  const own = cleanCompanyValue(order.production_day)
  if (own || isPersonalPickup(order)) return own
  return cleanCompanyValue(companyInfo?.production_day)
}

/** Trasa: z firmy; odbiór osobisty to osobna grupa */
export function getOrderRouteDay(
  order: Pick<Order, 'notes' | 'extra_fields'>,
  companyInfo: CompanyShippingInfo | null | undefined,
): string {
  if (isPersonalPickup(order)) return PERSONAL_PICKUP_ROUTE
  return cleanCompanyValue(companyInfo?.route_day)
}
