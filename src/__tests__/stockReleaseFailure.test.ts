import { describe, expect, it } from 'vitest'
import { releaseErrorText, releaseFailureMessage, releaseFailureWhat } from '../lib/stockReleaseFailure'

describe('D41 — błąd zdjęcia z magazynu nie blokuje etapu', () => {
  it('komunikat: zgłoszone do Weryfikacji', () => {
    expect(releaseFailureMessage(true, 'etap', 'timeout')).toBe(
      'Etap zapisany, magazyn do sprawdzenia w Weryfikacji (timeout)',
    )
    expect(releaseFailureMessage(true, 'wydanie')).toBe('Wydanie zapisane, magazyn do sprawdzenia w Weryfikacji')
  })

  it('komunikat: zgłoszenie się nie udało (baza bez migracji / brak sieci)', () => {
    expect(releaseFailureMessage(false, 'etap', 'x')).toContain('zgłoś kierownikowi')
    expect(releaseFailureMessage(false, 'etap', 'x')).toContain('Etap zapisany')
  })

  it('treść błędu: obiekt z message, tekst, wyjątek, pusty', () => {
    expect(releaseErrorText({ message: ' Failed to fetch ' })).toBe('Failed to fetch')
    expect(releaseErrorText('abc')).toBe('abc')
    expect(releaseErrorText(new Error('boom'))).toBe('boom')
    expect(releaseErrorText(null)).toBe('nieznany błąd')
    expect(releaseErrorText({ message: '' })).toBe('nieznany błąd')
    expect(releaseErrorText('x'.repeat(400))).toHaveLength(300)
  })

  it('opis wpisu', () => {
    expect(releaseFailureWhat('etap', 'Okleinowanie')).toBe('etap: Okleinowanie')
    expect(releaseFailureWhat('wydanie', null)).toContain('wydanie końcowe')
    expect(releaseFailureWhat('drzwi_wew', null)).toContain('drzwi wewnętrznych')
  })
})
