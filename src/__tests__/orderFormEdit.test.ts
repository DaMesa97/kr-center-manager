import { describe, expect, it } from 'vitest'
import { isOrderFormDirty, omitKeys } from '../utils'

describe('omitKeys — edycja nie wysyła pól, których formularz nie ma', () => {
  it('usuwa podane klucze, resztę zostawia, nie rusza oryginału', () => {
    const mapped = { model: 'X', frame_color: '', decorative_panel: '', handle: 'H' }
    const out = omitKeys(mapped, ['frame_color', 'decorative_panel'])
    expect(out).toEqual({ model: 'X', handle: 'H' })
    expect('frame_color' in out).toBe(false)
    expect(mapped.frame_color).toBe('')
  })
})

describe('isOrderFormDirty — pytanie o niezapisane zmiany', () => {
  const snap = { company: 'ACME', model: 'M1', quantity: 1, intarsja: '', notes: 'x ' }
  it('bez zmian (także białe znaki / liczba vs string) → nie pyta', () => {
    expect(isOrderFormDirty(snap, { ...snap, notes: 'x', quantity: '1' as unknown as number })).toBe(false)
  })
  it('zmiana dowolnego pola formularza (nie tylko z dawnej listy) → pyta', () => {
    expect(isOrderFormDirty(snap, { ...snap, intarsja: 'I-5' })).toBe(true)
  })
  it('brak zrzutu → nie pyta', () => {
    expect(isOrderFormDirty(null, snap)).toBe(false)
  })
})
