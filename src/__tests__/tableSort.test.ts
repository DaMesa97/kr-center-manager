import { describe, expect, it } from 'vitest'
import { sortRows, toggleSort, type SortState } from '../lib/tableSort'

type Row = { name: string | null; qty: number | null; code?: string }
const rows: Row[] = [
  { name: 'Zawias', qty: 10, code: 'Z-2' },
  { name: 'antaba', qty: 2, code: 'Z-10' },
  { name: 'Śruba', qty: null, code: '' },
  { name: null, qty: 100, code: 'A-1' },
]
const getters = {
  name: (r: Row) => r.name,
  qty: (r: Row) => r.qty,
  code: (r: Row) => r.code,
}

describe('toggleSort — 3 stany: asc → desc → domyślne', () => {
  it('cyklicznie przełącza kierunki', () => {
    let s: SortState = null
    s = toggleSort(s, 'name')
    expect(s).toEqual({ key: 'name', dir: 'asc' })
    s = toggleSort(s, 'name')
    expect(s).toEqual({ key: 'name', dir: 'desc' })
    s = toggleSort(s, 'name')
    expect(s).toBeNull()
  })
  it('klik w inną kolumnę zaczyna od asc', () => {
    expect(toggleSort({ key: 'name', dir: 'desc' }, 'qty')).toEqual({ key: 'qty', dir: 'asc' })
  })
})

describe('sortRows', () => {
  it('tekst po polsku, bez wrażliwości na wielkość liter; puste ZAWSZE na końcu', () => {
    const asc = sortRows(rows, { key: 'name', dir: 'asc' }, getters).map((r) => r.name)
    expect(asc).toEqual(['antaba', 'Śruba', 'Zawias', null])
    const desc = sortRows(rows, { key: 'name', dir: 'desc' }, getters).map((r) => r.name)
    expect(desc).toEqual(['Zawias', 'Śruba', 'antaba', null])
  })
  it('liczby numerycznie (1→9 / 9→1), null na końcu', () => {
    const asc = sortRows(rows, { key: 'qty', dir: 'asc' }, getters).map((r) => r.qty)
    expect(asc).toEqual([2, 10, 100, null])
    const desc = sortRows(rows, { key: 'qty', dir: 'desc' }, getters).map((r) => r.qty)
    expect(desc).toEqual([100, 10, 2, null])
  })
  it('kody z liczbami naturalnie: Z-2 przed Z-10', () => {
    const asc = sortRows(rows, { key: 'code', dir: 'asc' }, getters).map((r) => r.code)
    expect(asc).toEqual(['A-1', 'Z-2', 'Z-10', ''])
  })
  it('brak stanu / nieznany klucz → oryginalna kolejność', () => {
    expect(sortRows(rows, null, getters)).toBe(rows)
    expect(sortRows(rows, { key: 'xxx', dir: 'asc' }, getters)).toBe(rows)
  })
})
