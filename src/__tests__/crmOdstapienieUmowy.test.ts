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

describe('D17: „Zamówił” z Baselinkera w historii', () => {
  it('zdarzenie wygrany ze źródłem baselinker jest opisane jako automatyczne', () => {
    expect(zdarzenieLabel('wygrany', { zrodlo: 'baselinker', bl_id: 57582221 })).toBe('Zamówił (zamówienie w sklepie, automatycznie)')
    expect(zdarzenieLabel('wygrany', { oferta_id: null })).toBe('Zamówił')
  })

  it('doprecyzowanie: „Zamówił” z maila sklepu i automatyczna wartość z zamówienia', () => {
    expect(zdarzenieLabel('wygrany', { zrodlo: 'mail_sklepu', mail_id: 'x' })).toBe('Zamówił (zamówienie w sklepie, automatycznie)')
    expect(zdarzenieLabel('wartosc_zmieniona', { zrodlo: 'baselinker', z: 6000, na: 5867 })).toBe('Wartość klienta = kwota zamówienia w sklepie (automatycznie)')
    expect(zdarzenieLabel('wartosc_zmieniona', { zrodlo: 'mail_sklepu', na: 2204 })).toBe('Wartość klienta = kwota zamówienia w sklepie (automatycznie)')
    expect(zdarzenieLabel('wartosc_zmieniona', { zrodlo: 'klik', na: 100 })).toBe('Zmieniono wartość klienta')
  })
})
