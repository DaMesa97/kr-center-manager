import { describe, expect, it } from 'vitest'
import { bezZamknietychKlientow } from '../hooks/useCrm'

describe('Oferty → Do sprawdzenia (27.11)', () => {
  it('bez ofert klientów, którzy już zamówili albo przegrali', () => {
    const rows = [
      { id: 'a', lead: { status: 'oferta' } },
      { id: 'b', lead: { status: 'wygrany' } },
      { id: 'c', lead: { status: 'przegrany' } },
      { id: 'd', lead: null },
      { id: 'e', lead: { status: 'nowy' } },
    ]
    expect(bezZamknietychKlientow(rows).map((r) => r.id)).toEqual(['a', 'd', 'e'])
  })
})

describe('Do sprawdzenia — oferta zrobiona po wyniku klienta (testy 27.11)', () => {
  it('oferta po wyniku zostaje, sprzed wyniku znika', () => {
    const rows = [
      { id: 'po', created_at: '2026-11-27T12:00:00Z', lead: { status: 'wygrany', wynik_at: '2026-11-26T10:00:00Z' } },
      { id: 'przed', created_at: '2026-11-25T12:00:00Z', lead: { status: 'wygrany', wynik_at: '2026-11-26T10:00:00Z' } },
    ]
    expect(bezZamknietychKlientow(rows).map((r) => r.id)).toEqual(['po'])
  })
})

