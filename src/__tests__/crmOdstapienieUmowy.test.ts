import { describe, expect, it } from 'vitest'
import { moznaOdstapicOdUmowy, powodOdstapienia } from '../lib/crmUmowa'
import { zdarzenieLabel } from '../types/crm'

describe('D19: odstąpienie od podpisanej umowy', () => {
  it('tylko podpisana umowa (nie karta / protokół, nie inne statusy)', () => {
    expect(moznaOdstapicOdUmowy({ rodzaj: 'umowa', status: 'podpisana' })).toBe(true)
    expect(moznaOdstapicOdUmowy({ rodzaj: 'umowa', status: 'wyslana' })).toBe(false)
    expect(moznaOdstapicOdUmowy({ rodzaj: 'umowa', status: 'anulowana' })).toBe(false)
    expect(moznaOdstapicOdUmowy({ rodzaj: 'protokol', status: 'podpisana' })).toBe(false)
    expect(moznaOdstapicOdUmowy({ rodzaj: 'karta_pomiarowa', status: 'podpisana' })).toBe(false)
  })

  it('powód: przycięty, spacje zwinięte, min. 3 znaki, max. 500', () => {
    expect(powodOdstapienia('  odstąpienie   w 14 dni ')).toBe('odstąpienie w 14 dni')
    expect(powodOdstapienia('  ')).toBeNull()
    expect(powodOdstapienia('ok')).toBeNull()
    expect(powodOdstapienia(null)).toBeNull()
    expect(powodOdstapienia('x'.repeat(600))).toHaveLength(500)
  })

  it('historia klienta pokazuje numer i powód', () => {
    expect(zdarzenieLabel('umowa_odstapienie', { numer: '12/11/2026', powod: 'odstąpienie w 14 dni' })).toBe('Odstąpienie od umowy nr 12/11/2026: odstąpienie w 14 dni')
    expect(zdarzenieLabel('umowa_odstapienie', {})).toBe('Odstąpienie od umowy')
  })
})
