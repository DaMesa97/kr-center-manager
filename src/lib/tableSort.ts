// =====================================================================
// Sortowanie tabel po kliknięciu nagłówka.
// 3 stany: asc → desc → brak (powrót do domyślnej kolejności widoku).
// Liczby sortowane numerycznie, teksty po polsku (A2 < A10 dzięki numeric),
// puste wartości ZAWSZE na końcu (niezależnie od kierunku).
// =====================================================================

export type SortDir = 'asc' | 'desc'
export type SortState = { key: string; dir: SortDir } | null

export function toggleSort(prev: SortState, key: string): SortState {
  if (!prev || prev.key !== key) return { key, dir: 'asc' }
  if (prev.dir === 'asc') return { key, dir: 'desc' }
  return null
}

const isEmpty = (v: unknown): boolean =>
  v == null || String(v).trim() === '' || String(v).trim() === '—'

const numOf = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v ?? '').trim().replace(',', '.')
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null
  return parseFloat(s)
}

export function sortRows<T>(
  rows: T[],
  state: SortState,
  getters: Record<string, (row: T) => unknown>,
): T[] {
  if (!state) return rows
  const get = getters[state.key]
  if (!get) return rows
  const mul = state.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = get(a)
    const vb = get(b)
    const ea = isEmpty(va)
    const eb = isEmpty(vb)
    if (ea && eb) return 0
    if (ea) return 1
    if (eb) return -1
    const na = numOf(va)
    const nb = numOf(vb)
    if (na != null && nb != null) return (na - nb) * mul
    return String(va).localeCompare(String(vb), 'pl', { sensitivity: 'base', numeric: true }) * mul
  })
}
