import { describe, expect, it } from 'vitest'
import { MOBILE_CATEGORIES, filtrKategoriiNaTelefon, kategorieNaTelefon } from '../components/mobile/mobileKategorie'

describe('kategorie na telefonie (D62)', () => {
  it('kierownik działu i pracownik produkcji widzą tylko swoje kategorie, w stałej kolejności', () => {
    expect(kategorieNaTelefon('kierownik_dzialu', ['STA'])).toEqual(['STA'])
    expect(kategorieNaTelefon('pracownik_produkcji', ['Aluminium', 'STA'])).toEqual(['STA', 'Aluminium'])
    expect(kategorieNaTelefon('pracownik_produkcji', ['Nieznana'])).toEqual([])
    expect(kategorieNaTelefon('kierownik_dzialu', null)).toEqual([])
  })
  it('role bez zawężenia (admin, kierownicy, magazynier, obsługa) widzą wszystkie — także z pustym profilem', () => {
    for (const r of ['admin', 'superadmin', 'kierownik_magazynu', 'kierownik_produkcji', 'magazynier', 'obsluga_klienta']) {
      expect(kategorieNaTelefon(r, [])).toEqual([...MOBILE_CATEGORIES])
    }
  })
  it('filtr do zapytań: null = bez filtra, tablica = tylko te kategorie', () => {
    expect(filtrKategoriiNaTelefon('admin', [])).toBeNull()
    expect(filtrKategoriiNaTelefon('kierownik_dzialu', ['STA'])).toEqual(['STA'])
    expect(filtrKategoriiNaTelefon('pracownik_produkcji', [])).toEqual([])
  })
})
