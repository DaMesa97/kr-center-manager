import { describe, expect, it } from 'vitest'
import { localDateStr, minusMonths } from '../lib/localDates'

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12, 0, 0)

describe('minusMonths', () => {
  it('koniec miesiąca nie przelewa się', () => {
    expect(localDateStr(minusMonths(d(2026, 3, 31), 1))).toBe('2026-02-28')
    expect(localDateStr(minusMonths(d(2028, 3, 31), 1))).toBe('2028-02-29')
    expect(localDateStr(minusMonths(d(2026, 5, 31), 3))).toBe('2026-02-28')
    expect(localDateStr(minusMonths(d(2026, 12, 31), 6))).toBe('2026-06-30')
  })
  it('przez granicę roku i zwykłe dni', () => {
    expect(localDateStr(minusMonths(d(2026, 1, 15), 1))).toBe('2025-12-15')
    expect(localDateStr(minusMonths(d(2026, 11, 28), 12))).toBe('2025-11-28')
    expect(localDateStr(minusMonths(d(2028, 2, 29), 12))).toBe('2027-02-28')
  })
})
