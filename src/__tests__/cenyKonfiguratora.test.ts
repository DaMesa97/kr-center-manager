import { describe, expect, it } from 'vitest'
import { isEmptyPrice, shownConfiguratorValue } from '../lib/cenyKonfiguratora'

// D12 (28.11.2026): cena z konfiguratora w tabeli poufnej, kolumna zlecenia pusta po migracji.
describe('D12: cena z konfiguratora', () => {
  it('pusta wartość', () => {
    expect(isEmptyPrice(null)).toBe(true)
    expect(isEmptyPrice(undefined)).toBe(true)
    expect(isEmptyPrice('  ')).toBe(true)
    expect(isEmptyPrice(0)).toBe(false)
    expect(isEmptyPrice('1234.5')).toBe(false)
  })
  it('kolumna ma pierwszeństwo (przed migracją), potem tabela poufna', () => {
    expect(shownConfiguratorValue('1500', '999')).toBe('1500')
    expect(shownConfiguratorValue('', '999')).toBe('999')
    expect(shownConfiguratorValue(null, null)).toBeNull()
    expect(shownConfiguratorValue(null, ' ')).toBeNull()
  })
})
