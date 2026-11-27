import { describe, expect, it } from 'vitest'
import { adresFirmy, formatNip, nipPoprawny, normalizujNip } from '../lib/nip'

describe('NIP', () => {
  it('normalizuje PL, kreski i spacje', () => {
    expect(normalizujNip('PL 774-000-14-54')).toBe('7740001454')
    expect(normalizujNip(null)).toBe('')
  })
  it('sprawdza sumę kontrolną', () => {
    expect(nipPoprawny('7740001454')).toBe(true)
    expect(nipPoprawny('774-000-14-54')).toBe(true)
    expect(nipPoprawny('7740001455')).toBe(false)
    expect(nipPoprawny('1234567890')).toBe(false)
    expect(nipPoprawny('123')).toBe(false)
  })
  it('formatuje do wyświetlenia', () => {
    expect(formatNip('7740001454')).toBe('774-000-14-54')
    expect(formatNip('abc')).toBe('abc')
  })
  it('składa adres firmy', () => {
    expect(adresFirmy({ firma_ulica: 'CHEMIKÓW 7', firma_kod: '09-411', firma_miasto: 'PŁOCK' })).toBe('CHEMIKÓW 7, 09-411 PŁOCK')
    expect(adresFirmy({ firma_miasto: 'Żory' })).toBe('Żory')
    expect(adresFirmy({})).toBe('')
  })
})
