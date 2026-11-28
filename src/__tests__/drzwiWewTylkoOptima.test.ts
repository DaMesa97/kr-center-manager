import { describe, expect, it } from 'vitest'
import { DRZWI_WEW_TYLKO_Z_OPTIMY, moznaEdytowacDrzwiWew } from '../lib/optimaRo'

describe('D40: drzwi wewnętrzne tylko z Optimy', () => {
  it('formularz otwiera się tylko dla zlecenia z importu RO', () => {
    expect(moznaEdytowacDrzwiWew({ source: 'optima_ro' })).toBe(true)
    expect(moznaEdytowacDrzwiWew({ source: 'manual' })).toBe(false)
    expect(moznaEdytowacDrzwiWew({ source: null })).toBe(false)
    expect(moznaEdytowacDrzwiWew(null)).toBe(false)
  })
  it('komunikat mówi, skąd przychodzą zlecenia', () => {
    expect(DRZWI_WEW_TYLKO_Z_OPTIMY).toContain('Optimy')
  })
})
