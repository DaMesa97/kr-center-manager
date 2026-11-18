import { describe, expect, it } from 'vitest'
import { kwotaOferty, lejekPodsumowanie, opisWyniku, ostatniaOferta, zadanieGrupa } from '../lib/crmWynik'

describe('crmWynik — grupy zadań', () => {
  it('termin przed dziś = zaległe, dziś = dziś, potem i brak = później', () => {
    expect(zadanieGrupa('2026-11-17', '2026-11-18')).toBe('zalegle')
    expect(zadanieGrupa('2026-11-18', '2026-11-18')).toBe('dzis')
    expect(zadanieGrupa('2026-11-18T09:00:00+01:00', '2026-11-18')).toBe('dzis')
    expect(zadanieGrupa('2026-11-20', '2026-11-18')).toBe('pozniej')
    expect(zadanieGrupa(null, '2026-11-18')).toBe('pozniej')
  })
})

describe('crmWynik — oferty', () => {
  it('kwota: oficjalna = brutto, sklep = cena_razem', () => {
    expect(kwotaOferty({ rodzaj: 'oficjalna', brutto: 13073.4, cena_razem: 1 })).toBe(13073.4)
    expect(kwotaOferty({ rodzaj: 'sklep', brutto: null, cena_razem: 8220 })).toBe(8220)
    expect(kwotaOferty(null)).toBeNull()
  })

  it('ostatnia oferta pomija stare wersje, chyba że innych nie ma', () => {
    const o = [
      { id: 'a', status: 'robocza', created_at: '2026-11-18T13:00:00Z' },
      { id: 'b', status: 'wyslana', created_at: '2026-11-18T12:00:00Z' },
      { id: 'c', status: 'robocza', created_at: '2026-11-17T10:00:00Z' },
    ]
    expect(ostatniaOferta(o)?.id).toBe('b')
    expect(ostatniaOferta([o[0], o[2]])?.id).toBe('a')
    expect(ostatniaOferta([])).toBeNull()
  })
})

describe('crmWynik — lejek', () => {
  const rows = [
    { status: 'nowy' },
    { status: 'oferta', ostatnia_oferta: { rodzaj: 'sklep', cena_razem: 5000 } },
    { status: 'oferta', ostatnia_oferta: { rodzaj: 'oficjalna', brutto: 13000 } },
    { status: 'wygrany', ostatnia_oferta: { rodzaj: 'sklep', cena_razem: 6000 } },
    { status: 'przegrany', wynik_powod: 'cena', ostatnia_oferta: { rodzaj: 'sklep', cena_razem: 4000 } },
    { status: 'przegrany', wynik_powod: 'cena' },
    { status: 'przegrany', wynik_powod: 'konkurencja' },
  ]

  it('liczy kolumny, wartość w grze, wygrane, najczęstszy powód i % wygranych', () => {
    const s = lejekPodsumowanie(rows)
    expect(s.kolumny.nowy.n).toBe(1)
    expect(s.kolumny.oferta).toEqual({ n: 2, suma: 18000 })
    expect(s.wGrze).toBe(3)
    expect(s.wartoscWGrze).toBe(18000)
    expect(s.wygrane).toEqual({ n: 1, suma: 6000 })
    expect(s.przegrane).toEqual({ n: 3, topPowod: 'cena' })
    expect(s.procentWygranych).toBe(25)
  })

  it('bez zamkniętych procent = null; nieznany status trafia do „Nowy”', () => {
    const s = lejekPodsumowanie([{ status: null }, { status: 'oferta' }])
    expect(s.procentWygranych).toBeNull()
    expect(s.kolumny.nowy.n).toBe(1)
  })
})

describe('crmWynik — opis wyniku', () => {
  it('przegrany z powodem i notatką, wygrany z datą, otwarty pusty', () => {
    expect(opisWyniku({ status: 'przegrany', wynik_powod: 'cena', wynik_notatka: 'market taniej', wynik_at: '2026-11-18T10:00:00Z' })).toBe('Przegrany 18.11: cena — market taniej')
    expect(opisWyniku({ status: 'przegrany' })).toBe('Przegrany: bez podanego powodu')
    expect(opisWyniku({ status: 'wygrany', wynik_at: '2026-11-18T10:00:00Z' })).toBe('Zamówił 18.11')
    expect(opisWyniku({ status: 'oferta' })).toBe('')
  })
})

describe('crmWynik — przeciąganie w lejku', () => {
  it('mapuje ruchy kart na akcje wyniku', async () => {
    const { ruchWLejku } = await import('../lib/crmWynik')
    expect(ruchWLejku('oferta', 'oferta')).toBe('nic')
    expect(ruchWLejku(null, 'nowy')).toBe('nic')
    expect(ruchWLejku('oferta', 'wygrany')).toBe('wygrany')
    expect(ruchWLejku('nowy', 'przegrany')).toBe('przegrany')
    expect(ruchWLejku('wygrany', 'przegrany')).toBe('przegrany')
    expect(ruchWLejku('przegrany', 'oferta')).toBe('w_grze')
    expect(ruchWLejku('wygrany', 'nowy')).toBe('w_grze')
    expect(ruchWLejku('nowy', 'oferta')).toBe('systemowy')
    expect(ruchWLejku('oferta', 'nowy')).toBe('systemowy')
  })
})
