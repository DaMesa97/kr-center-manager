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
