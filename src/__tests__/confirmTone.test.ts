import { describe, expect, it } from 'vitest'
import { inferConfirmTone } from '../lib/confirmTone'

// Enter potwierdza tylko pozytywne okna (decyzja Tymka 23.10)
describe('inferConfirmTone', () => {
  it.each([
    ['Usunąć to zdjęcie?'],
    ['Anulować zamówienie?'],
    ['Cofnąć realizację reklamacji 12?'],
    ['Przesunąć mimo to?'],
    ['Zwolnić wszystkie rezerwacje zlecenia?'],
    ['Wyczyścić całą listę zakupową?'],
    ['Dezaktywować konto Jan?'],
  ])('niebezpieczne: %s', (msg) => {
    expect(inferConfirmTone(msg)).toBe('danger')
  })

  it.each([
    ['Oznaczyć wydanie zamówienia nr 12 dzisiejszą datą?', 'Tak, oznacz'],
    ['Oznaczyć szyby jako odebrane od szklarza?', 'Odebrane'],
    ['Czy na pewno oznaczyć zamówienie jako zweryfikowane?', 'Oznacz jako zweryfikowane'],
    ['Czy na pewno wydać zamówienie #5?', 'Wydaj'],
  ])('pozytywne: %s', (msg, label) => {
    expect(inferConfirmTone(msg, label)).toBe('success')
  })
})
