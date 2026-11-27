// testy 27.11 (runda 3): walidacja ilości w formularzach zleceń
import { describe, expect, it } from 'vitest'
import { checkOrderQuantity, quantityFromInput, QUANTITY_MAX } from '../utils'

describe('checkOrderQuantity', () => {
  it('liczba całkowita 1…50 — ok bez pytania', () => {
    expect(checkOrderQuantity(1)).toEqual({ ok: true, value: 1, needsConfirm: false })
    expect(checkOrderQuantity('50')).toEqual({ ok: true, value: 50, needsConfirm: false })
  })
  it('powyżej 50 — ok, ale z pytaniem', () => {
    expect(checkOrderQuantity(51)).toEqual({ ok: true, value: 51, needsConfirm: true })
  })
  it('ułamek, zero, ujemna, puste, tekst — odrzucone', () => {
    for (const v of [1.5, '1,5', 0, -3, '', '  ', 'abc', null, undefined]) {
      expect(checkOrderQuantity(v).ok).toBe(false)
    }
  })
  it('powyżej limitu — odrzucone z komunikatem o limicie', () => {
    const r = checkOrderQuantity(99999)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain(String(QUANTITY_MAX))
  })
})

describe('quantityFromInput', () => {
  it('liczba → number, puste → "", śmieci zostają do walidacji', () => {
    expect(quantityFromInput('3')).toBe(3)
    expect(quantityFromInput('1.5')).toBe(1.5)
    expect(quantityFromInput('')).toBe('')
    expect(quantityFromInput('-2')).toBe(-2)
  })
})
