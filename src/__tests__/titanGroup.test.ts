import { describe, expect, it } from 'vitest'
import { titanGroupId, titanGroupValue } from '../lib/titanGroup'
import { isTitanBastionOrder } from '../utils'
import { logicalOrderKey } from '../lib/dashboardCounts'
import { isLinkedSecondary } from '../lib/companyStats'
import type { Order } from '../types'

describe('D51: jedno wykrywanie grupy Titan', () => {
  it('poprawna grupa = dodatnia liczba całkowita (liczba albo tekst)', () => {
    expect(titanGroupValue(15180)).toBe(15180)
    expect(titanGroupValue('15180')).toBe(15180)
    expect(titanGroupValue(' 7 ')).toBe(7)
    for (const v of [0, '0', '', '  ', null, undefined, 'abc', -3, '1.5', 1.5, true, NaN]) {
      expect(titanGroupValue(v), String(v)).toBeNull()
    }
  })
  it('wszystkie miejsca dają ten sam wynik dla 0 / pustego tekstu', () => {
    const z = (g: unknown, category = 'Bastion') => ({ id: 1, category, extra_fields: { titan_group: g }, linked_order_id: null } as unknown as Order)
    for (const g of [0, '', '0']) {
      expect(titanGroupId(z(g))).toBeNull()
      expect(isTitanBastionOrder(z(g))).toBe(false)
      expect(isLinkedSecondary(z(g, 'ST'))).toBe(false)
      expect(logicalOrderKey({ id: 1, linked_order_id: null, titan_group: g as string })).toBe('o:1')
    }
    expect(isTitanBastionOrder(z('42'))).toBe(true)
    expect(isLinkedSecondary(z(42, 'ST'))).toBe(true)
    expect(logicalOrderKey({ id: 1, linked_order_id: null, titan_group: '42' })).toBe('t:42')
  })
})
