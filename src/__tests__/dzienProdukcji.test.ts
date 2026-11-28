import { describe, expect, it } from 'vitest'
import { dzienZKartotekiFirmy, oczyscDzienProdukcji, opcjeDniaProdukcji } from '../lib/dzienProdukcji'

describe('dzień produkcji w formularzu (D27)', () => {
  it('lista: dni tygodnia + odbiór osobisty, nietypowa obecna wartość zostaje', () => {
    expect(opcjeDniaProdukcji('')).toEqual(['PONIEDZIAŁEK', 'WTOREK', 'ŚRODA', 'CZWARTEK', 'PIĄTEK', 'ODBIÓR OSOBISTY'])
    expect(opcjeDniaProdukcji('SOBOTA')).toContain('SOBOTA')
    expect(opcjeDniaProdukcji('ŚRODA')).toHaveLength(6)
    expect(opcjeDniaProdukcji('#N/A')).toHaveLength(6)
  })
  it('kartoteka: #N/A i puste = brak, nazwa bez wielkości liter', () => {
    expect(oczyscDzienProdukcji(' #n/a ')).toBe('')
    const firmy = [{ name: 'Firma A ', production_day: 'WTOREK' }, { name: 'B', production_day: '#N/A' }]
    expect(dzienZKartotekiFirmy('firma a', firmy)).toBe('WTOREK')
    expect(dzienZKartotekiFirmy('B', firmy)).toBe('')
    expect(dzienZKartotekiFirmy('', firmy)).toBe('')
    expect(dzienZKartotekiFirmy('X', null)).toBe('')
  })
})
