import { describe, expect, it } from 'vitest'
import { terminZadania } from '../lib/crmZadania'

describe('Do zrobienia v3 — termin w pierwszej kolumnie', () => {
  const dzis = '2026-11-27' // piątek
  it('dziś / zaległe / jutro / później z dniem tygodnia', () => {
    expect(terminZadania('2026-11-27', 'dzis', dzis)).toBe('dziś')
    expect(terminZadania('2026-11-25', 'zalegle', dzis)).toBe('25.11')
    expect(terminZadania('2026-11-28T00:00:00', 'pozniej', dzis)).toBe('jutro')
    expect(terminZadania('2026-12-02', 'pozniej', dzis)).toBe('śr 02.12')
    expect(terminZadania(null, 'pozniej', dzis)).toBe('bez terminu')
  })
})
