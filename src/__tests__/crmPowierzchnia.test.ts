import { describe, expect, it } from 'vitest'
import { parsePowierzchnia } from '../lib/crmWynik'

describe('parsePowierzchnia', () => {
  it('odczytuje typowe zapisy', () => {
    expect(parsePowierzchnia('150')).toBe(150)
    expect(parsePowierzchnia('150 m2')).toBe(150)
    expect(parsePowierzchnia('ok. 150')).toBe(150)
    expect(parsePowierzchnia('1 200')).toBe(1200)
    expect(parsePowierzchnia('82,5 m²')).toBe(82.5)
    expect(parsePowierzchnia('  ')).toBeNull()
  })
  it('nieczytelne → NaN (błąd w formularzu)', () => {
    expect(parsePowierzchnia('dużo')).toBeNaN()
    expect(parsePowierzchnia('100-150')).toBeNaN()
    expect(parsePowierzchnia('0')).toBeNaN()
  })
})
