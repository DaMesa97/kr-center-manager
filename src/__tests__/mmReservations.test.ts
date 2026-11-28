import { describe, expect, it } from 'vitest'
import { mmReservationPrompt, movedReservationsBy, parseMmReservationPreview } from '../lib/mmReservations'

describe('D16 — MM z rezerwacjami', () => {
  const rows = parseMmReservationPreview([
    { r_component_id: 259, r_orders: 3, r_reservations: 3, r_quantity: '6.000' },
    { r_component_id: 260, r_orders: 1, r_reservations: 1, r_quantity: 2 },
    { r_component_id: 261, r_orders: 0, r_reservations: 0, r_quantity: 0 },
  ])

  it('podgląd z bazy: liczby, puste pozycje odpadają, nie-tablica = brak', () => {
    expect(rows).toEqual([
      { component_id: 259, orders: 3, reservations: 3, quantity: 6 },
      { component_id: 260, orders: 1, reservations: 1, quantity: 2 },
    ])
    expect(parseMmReservationPreview(null)).toEqual([])
  })

  it('pytanie podaje liczbę zleceń i pozycje', () => {
    const txt = mmReservationPrompt(rows, (id) => `K${id}`)
    expect(txt).toContain('rezerwacje 4 zleceń')
    expect(txt).toContain('• K259: 6 szt. dla 3 zleceń')
    expect(txt).toContain('• K260: 2 szt. dla 1 zlecenia')
  })

  it('przeniesione rezerwacje na komponent', () => {
    expect(movedReservationsBy(rows).get(259)).toBe(6)
    expect(movedReservationsBy(rows).get(999)).toBeUndefined()
  })
})
