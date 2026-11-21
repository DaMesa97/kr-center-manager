import { describe, expect, it } from 'vitest'
import { etykietaUstalenia, krokOferty, ustaleniaLista } from '../lib/crmOferta'

describe('crmOferta — krok oferty', () => {
  it('status → krok i podświetlony etap', () => {
    expect(krokOferty('wstrzymana', {})).toEqual({ krok: 'ustalenia', idx: 0 })
    expect(krokOferty('przelicz', {})).toEqual({ krok: 'liczenie', idx: 1 })
    expect(krokOferty('do_sprawdzenia', { pending: true })).toEqual({ krok: 'liczenie', idx: 1 })
    expect(krokOferty('do_sprawdzenia', { sysErr: true })).toEqual({ krok: 'blad', idx: 1 })
    expect(krokOferty('do_sprawdzenia', {})).toEqual({ krok: 'wysylka', idx: 2 })
    expect(krokOferty('wyslana', {})).toEqual({ krok: 'decyzja', idx: 3 })
    expect(krokOferty('zaakceptowana', {})).toEqual({ krok: 'koniec', idx: 3 })
    expect(krokOferty('odrzucona', {})).toEqual({ krok: 'koniec', idx: 3 })
    expect(krokOferty('robocza', {})).toEqual({ krok: 'stara', idx: -1 })
  })
})

describe('crmOferta — ustalenia po polsku', () => {
  it('etykiety: znane klucze i nieznane bez podkreślników', () => {
    expect(etykietaUstalenia('kolor_skrzydla')).toBe('Kolor skrzydła')
    expect(etykietaUstalenia('wymiar_otworu')).toBe('Wymiar otworu')
    expect(etykietaUstalenia('ilosc')).toBe('Ilość')
    expect(etykietaUstalenia('nowe_pole_ai')).toBe('Nowe pole ai')
  })

  it('tylko wypełnione pola, najważniejsze najpierw, wartości czytelne', () => {
    const l = ustaleniaLista({
      inne: 'Drzwi łącznie 396 szt.',
      ilosc: 396,
      model: '',
      montaz: true,
      okucia: null,
      kolor_skrzydla: 'turner',
      oslonki: 'brak',
      termin: ['06.2027', '12.2027'],
    })
    expect(l.map((u) => u.nazwa)).toEqual(['Ilość', 'Kolor skrzydła', 'Montaż', 'Termin', 'Inne'])
    expect(l.find((u) => u.klucz === 'montaz')?.wartosc).toBe('tak')
    expect(l.find((u) => u.klucz === 'termin')?.wartosc).toBe('06.2027, 12.2027')
    expect(ustaleniaLista(null)).toEqual([])
  })
})
