import { describe, expect, it } from 'vitest'
import { etykietaUstalenia, krokOferty, ustaleniaLista, wersjeOferty } from '../lib/crmOferta'

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

describe('wersjeOferty', () => {
  const x1 = { id: 'x1', poprzednia_id: null }
  const x2 = { id: 'x2', poprzednia_id: 'x1' }
  const x3 = { id: 'x3', poprzednia_id: 'x2' }
  const y1 = { id: 'y1', poprzednia_id: null }
  const wszystkie = [x1, x2, y1, x3]
  it('zostawia tylko wersje tej samej oferty', () => {
    expect(wersjeOferty(wszystkie, x1).map((w) => w.id)).toEqual(['x1', 'x2', 'x3'])
    expect(wersjeOferty(wszystkie, x3).map((w) => w.id)).toEqual(['x1', 'x2', 'x3'])
    expect(wersjeOferty(wszystkie, y1).map((w) => w.id)).toEqual(['y1'])
  })
  it('nie wiesza się na pętli i brakującym poprzedniku', () => {
    const a = { id: 'a', poprzednia_id: 'b' }
    const b = { id: 'b', poprzednia_id: 'a' }
    const c = { id: 'c', poprzednia_id: 'zniknal' }
    expect(wersjeOferty([a, b, c], c).map((w) => w.id)).toEqual(['c'])
    expect(wersjeOferty([a, b, c], a).length).toBeGreaterThan(0)
  })
})
