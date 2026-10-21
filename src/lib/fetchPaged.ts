// PostgREST ucina każdą odpowiedź do 1000 wierszy (max_rows) — `.limit(10000)`
// po cichu zwraca 1000. Ten helper dociąga kolejne porcje przez `.range()`.
// Zapytanie MUSI mieć stabilne sortowanie (np. created_at + id), inaczej
// porcje mogą się nakładać lub gubić wiersze.

export const PG_PAGE = 1000

type PageResponse<T> = { data: T[] | null; error: { message: string } | null }

export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<PageResponse<T>>,
  opts: { max?: number; pageSize?: number } = {},
): Promise<{ data: T[]; error: { message: string } | null }> {
  const size = opts.pageSize ?? PG_PAGE
  const max = opts.max ?? Infinity
  const rows: T[] = []
  for (let from = 0; from < max; from += size) {
    const to = Math.min(from + size, max) - 1
    const { data, error } = await page(from, to)
    if (error) return { data: rows, error }
    rows.push(...(data ?? []))
    if (!data || data.length < to - from + 1) break
  }
  return { data: rows, error: null }
}
