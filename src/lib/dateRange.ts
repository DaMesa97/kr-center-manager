// =====================================================================
// Filtr dat w tabelach zleceń (data zamówienia `order_date`, YYYY-MM-DD).
// Presety liczone LOKALNIE (jak localDates): „ten miesiąc" to miesiąc w
// Polsce, nie w UTC. '' w from/to = brak ograniczenia z tej strony.
// =====================================================================
import { localDateStr, localMonday } from './localDates'

export type DatePreset =
  | 'all'
  | 'today'
  | 'week'
  | 'month'
  | 'prev_month'
  | 'last30'
  | 'quarter'
  | 'year'
  | 'custom'

export type DateRangeFilter = { preset: DatePreset; from: string; to: string }

export const DATE_FILTER_ALL: DateRangeFilter = { preset: 'all', from: '', to: '' }

export const DATE_PRESET_LABELS: Array<{ value: DatePreset; label: string }> = [
  { value: 'all', label: 'Wszystkie daty' },
  { value: 'today', label: 'Dziś' },
  { value: 'week', label: 'Ten tydzień' },
  { value: 'month', label: 'Ten miesiąc' },
  { value: 'prev_month', label: 'Poprzedni miesiąc' },
  { value: 'last30', label: 'Ostatnie 30 dni' },
  { value: 'quarter', label: 'Ten kwartał' },
  { value: 'year', label: 'Ten rok' },
  { value: 'custom', label: 'Zakres dat…' },
]

const addDays = (d: Date, n: number): Date => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/** Zakres dat (włącznie) dla presetu; null = otwarty koniec. */
export function resolveDateRange(f: DateRangeFilter, now: Date = new Date()): { from: string | null; to: string | null } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const ymd = (d: Date) => localDateStr(d)
  switch (f.preset) {
    case 'all':
      return { from: null, to: null }
    case 'today':
      return { from: ymd(today), to: ymd(today) }
    case 'week': {
      const mon = localMonday(today)
      return { from: ymd(mon), to: ymd(addDays(mon, 6)) }
    }
    case 'month':
      return {
        from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)),
        to: ymd(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
      }
    case 'prev_month':
      return {
        from: ymd(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        to: ymd(new Date(today.getFullYear(), today.getMonth(), 0)),
      }
    case 'last30':
      return { from: ymd(addDays(today, -29)), to: ymd(today) }
    case 'quarter': {
      const q0 = Math.floor(today.getMonth() / 3) * 3
      return { from: ymd(new Date(today.getFullYear(), q0, 1)), to: ymd(new Date(today.getFullYear(), q0 + 3, 0)) }
    }
    case 'year':
      return { from: ymd(new Date(today.getFullYear(), 0, 1)), to: ymd(new Date(today.getFullYear(), 11, 31)) }
    case 'custom':
      return { from: f.from.trim() || null, to: f.to.trim() || null }
    default:
      return { from: null, to: null }
  }
}

/** Czy data (YYYY-MM-DD albo ISO) mieści się w zakresie; przy aktywnym filtrze brak daty = poza zakresem. */
export function dateInRange(value: string | null | undefined, range: { from: string | null; to: string | null }): boolean {
  if (!range.from && !range.to) return true
  const d = String(value ?? '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
  if (range.from && d < range.from) return false
  if (range.to && d > range.to) return false
  return true
}

export const isDateFilterActive = (f: DateRangeFilter): boolean =>
  f.preset !== 'all' && !(f.preset === 'custom' && !f.from.trim() && !f.to.trim())

/** Opis zakresu do etykiety / licznika („1.11–30.11.2026"). */
export function describeDateRange(f: DateRangeFilter, now: Date = new Date()): string {
  const r = resolveDateRange(f, now)
  const fmt = (s: string) => {
    const [y, m, d] = s.split('-')
    return `${Number(d)}.${m}.${y}`
  }
  if (!r.from && !r.to) return ''
  if (r.from && r.to) return r.from === r.to ? fmt(r.from) : `${fmt(r.from)} – ${fmt(r.to)}`
  if (r.from) return `od ${fmt(r.from)}`
  return `do ${fmt(r.to as string)}`
}
