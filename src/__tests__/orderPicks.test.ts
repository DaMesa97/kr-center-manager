import { describe, expect, it } from 'vitest'
import { canPick, groupPicks, pickKey, pickProgress, type OrderPick } from '../lib/orderPicks'

const pick = (order_id: number, line_key: string): OrderPick => ({ order_id, line_key, picked_at: '2026-11-26T15:00:00Z', picked_by: null, picked_initials: 'TW' })

describe('przygotowanie do pakowania', () => {
  it('klucz linii: id linii z Optimy (przeżywa ponowny import), przy ręcznych id pozycji', () => {
    expect(pickKey({ id: 605, optima_element_id: 3489780 })).toBe('optima:3489780')
    expect(pickKey({ id: 12, optima_element_id: null })).toBe('item:12')
  })

  it('postęp: 0/3 → 2/3 → komplet; odznaczenie linii, której już nie ma w RO, się nie liczy', () => {
    const items = [
      { id: 1, optima_element_id: 10 },
      { id: 2, optima_element_id: 11 },
      { id: 3, optima_element_id: 12 },
    ]
    const byOrder = groupPicks([pick(7, 'optima:10'), pick(7, 'optima:11'), pick(7, 'optima:99'), pick(8, 'optima:10')])
    expect(pickProgress(items, undefined)).toEqual({ done: 0, total: 3, complete: false })
    expect(pickProgress(items, byOrder.get(7))).toEqual({ done: 2, total: 3, complete: false })
    byOrder.get(7)!.set('optima:12', pick(7, 'optima:12'))
    expect(pickProgress(items, byOrder.get(7))).toEqual({ done: 3, total: 3, complete: true })
    expect(pickProgress([], byOrder.get(7)).complete).toBe(false)
  })

  it('kto odznacza: kierownik, magazynier, pracownik działu magazyn — sprzedawca nie', () => {
    expect(canPick({ role: 'magazynier' }, false)).toBe(true)
    expect(canPick({ role: 'worker', department: 'magazyn' }, false)).toBe(true)
    expect(canPick({ role: 'worker', department: 'stalowe' }, false)).toBe(false)
    expect(canPick({ role: 'sprzedawca' }, false)).toBe(false)
    expect(canPick({ role: 'kierownik_magazynu' }, true)).toBe(true)
  })
})
