import { describe, expect, it } from 'vitest'
import { computeStockStatus, stockStatusLabel, stockStatusRank } from '../lib/stockStatus'

describe('computeStockStatus — status półki w Stanach', () => {
  it('stan ujemny = minus (ważniejsze niż nadrezerwacja)', () => {
    expect(computeStockStatus(-1, 5, 10)).toBe('minus')
  })

  it('rezerwacje > stan = nadrezerwacja, nawet bez progu minimum', () => {
    expect(computeStockStatus(3, 5, null)).toBe('overreserved')
    expect(computeStockStatus(0, 1, undefined)).toBe('overreserved')
  })

  it('rezerwacje = stan to jeszcze nie nadrezerwacja', () => {
    expect(computeStockStatus(5, 5, null)).toBe('ok')
  })

  it('poniżej minimum = niski, bez progu = ok', () => {
    expect(computeStockStatus(4, 0, 10)).toBe('low')
    expect(computeStockStatus(4, null, null)).toBe('ok')
    expect(computeStockStatus(10, 2, 10)).toBe('ok')
  })

  it('widok zbiorczy: nadrezerwacja w jednym magazynie nie znika przez zapas w drugim', () => {
    // suma: 20 fizycznie, 6 zarezerwowane — ale w jednym magazynie dostępne -2
    expect(computeStockStatus(20, 6, null, -2)).toBe('overreserved')
    expect(computeStockStatus(20, 6, null, 3)).toBe('ok')
  })

  it('ranga sortowania: minus → nadrezerwacja → niski → ok', () => {
    const order = (['ok', 'low', 'overreserved', 'minus'] as const)
      .slice()
      .sort((a, b) => stockStatusRank(a) - stockStatusRank(b))
    expect(order).toEqual(['minus', 'overreserved', 'low', 'ok'])
    expect(stockStatusLabel('overreserved')).toBe('Nadrezerwacja')
  })
})
