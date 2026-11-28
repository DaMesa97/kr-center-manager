import { describe, expect, it } from 'vitest'
import { isExtraCancelled, isOrderCancelled } from '../lib/orderCancelled'
import { isOrderCancelled as zOptimy } from '../lib/optimaRo'
import { parseOrderExtraFields } from '../utils'

describe('D50: jedno znaczenie „zlecenie anulowane”', () => {
  it('anulowane tylko przy extra_fields.cancelled === true', () => {
    expect(isOrderCancelled({ extra_fields: { cancelled: true } })).toBe(true)
    for (const v of [false, 'true', 'false', 1, 0, null, undefined, 'tak']) {
      expect(isOrderCancelled({ extra_fields: { cancelled: v } })).toBe(false)
    }
    expect(isOrderCancelled({ extra_fields: null })).toBe(false)
    expect(isOrderCancelled({ extra_fields: [true] })).toBe(false)
    expect(isOrderCancelled({})).toBe(false)
    expect(isOrderCancelled(null)).toBe(false)
  })
  it('wariant dla samego extra_fields', () => {
    expect(isExtraCancelled({ cancelled: true })).toBe(true)
    expect(isExtraCancelled({ cancelled: 'true' })).toBe(false)
    expect(isExtraCancelled('cancelled')).toBe(false)
  })
  it('stary import z modułu Optimy to ta sama funkcja', () => {
    expect(zOptimy).toBe(isOrderCancelled)
  })
  it('parseOrderExtraFields: tekst „false” albo 1 nie daje już „anulowane”', () => {
    expect(parseOrderExtraFields({ cancelled: 'false' }).cancelled).toBe(false)
    expect(parseOrderExtraFields({ cancelled: 1 }).cancelled).toBe(false)
    expect(parseOrderExtraFields({ cancelled: true }).cancelled).toBe(true)
  })
})
