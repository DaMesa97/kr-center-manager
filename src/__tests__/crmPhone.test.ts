import { describe, expect, it } from 'vitest'
import { normalizePlPhone } from '../utils/crmPhone'

describe('normalizePlPhone (CRM „Dodaj klienta”)', () => {
  it('9 cyfr → +48', () => {
    expect(normalizePlPhone('601 234 567')).toBe('+48601234567')
    expect(normalizePlPhone('601-234-567')).toBe('+48601234567')
  })
  it('z prefiksem 48 / +48 / 0048', () => {
    expect(normalizePlPhone('+48 601 234 567')).toBe('+48601234567')
    expect(normalizePlPhone('48601234567')).toBe('+48601234567')
    expect(normalizePlPhone('0048601234567')).toBe('+48601234567')
  })
  it('stary zapis z zerem', () => {
    expect(normalizePlPhone('0601234567')).toBe('+48601234567')
  })
  it('zagraniczny tylko z plusem', () => {
    expect(normalizePlPhone('+49 30 12345678')).toBe('+493012345678')
    expect(normalizePlPhone('493012345678')).toBeNull()
  })
  it('śmieci → null', () => {
    expect(normalizePlPhone('')).toBeNull()
    expect(normalizePlPhone('   ')).toBeNull()
    expect(normalizePlPhone(null)).toBeNull()
    expect(normalizePlPhone('12345')).toBeNull()
    expect(normalizePlPhone('abc')).toBeNull()
  })
})
