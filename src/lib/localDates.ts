// Daty "kalendarzowe" w czasie lokalnym (komputery firmy = Europe/Warsaw).
// toISOString() liczy w UTC — po północy lokalnej dawało poprzedni dzień,
// a tydzień/miesiąc rozjeżdżał się o dobę. Tu wszystko idzie po czasie lokalnym.

const pad = (n: number) => String(n).padStart(2, '0')

/** 'YYYY-MM-DD' wg lokalnego kalendarza */
export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Poniedziałek tygodnia, w którym leży `d` (00:00 lokalnie) */
export function localMonday(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = copy.getDay()
  copy.setDate(copy.getDate() + (day === 0 ? -6 : 1 - day))
  return copy
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

/** Początek lokalnego dnia jako ISO UTC — do `.gte('created_at', …)` na timestamptz */
export function localDayStartIso(dateStr: string): string {
  return parseLocalDate(dateStr).toISOString()
}

/** Początek NASTĘPNEGO lokalnego dnia jako ISO UTC — do `.lt('created_at', …)` */
export function localDayEndExclusiveIso(dateStr: string): string {
  const d = parseLocalDate(dateStr)
  d.setDate(d.getDate() + 1)
  return d.toISOString()
}
