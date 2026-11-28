import { describe, expect, it } from 'vitest'
import { dataCzasPl, dataPl } from '../lib/dataPl'
import { mediana } from '../lib/mediana'
import { isReleaseDateEmpty } from '../utils'

describe('D51: drobne rozjazdy kopii (daty, mediana, data wydania)', () => {
  it('data: pusta = „—” (albo zamiennik), zła = tekst z bazy, nie „Invalid Date”', () => {
    expect(dataPl('2026-11-28')).toBe('28.11.2026')
    expect(dataPl('2026-11-28T10:00:00Z')).toBe('28.11.2026')
    expect(dataPl(null)).toBe('—')
    expect(dataPl('  ')).toBe('—')
    expect(dataPl('', '')).toBe('')
    expect(dataPl('jutro')).toBe('jutro')
    expect(dataCzasPl('zła data')).toBe('zła data')
    expect(dataCzasPl(undefined)).toBe('—')
    expect(dataCzasPl('2026-11-28T10:05:00Z')).not.toContain('Invalid')
  })
  it('mediana pustej listy = null', () => {
    expect(mediana([])).toBeNull()
    expect(mediana([5])).toBe(5)
    expect(mediana([1, 9, 3])).toBe(3)
    expect(mediana([1, 2, 3, 4])).toBe(2.5)
  })
  it('data wydania ze spacji to nie „wydane”', () => {
    expect(isReleaseDateEmpty('   ')).toBe(true)
    expect(isReleaseDateEmpty('2026-11-28')).toBe(false)
  })
})
