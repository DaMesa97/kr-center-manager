// testy 27.11 (runda 3): 504/timeout przy zapisie = „nie wiadomo, czy się zapisało”
import { describe, expect, it } from 'vitest'
import { isUncertainWriteError } from '../utils'

describe('isUncertainWriteError', () => {
  it('504 / 502 / 503 / 408 / brak statusu → niepewne', () => {
    for (const st of [504, 502, 503, 408, 0, 522]) {
      expect(isUncertainWriteError({ message: 'x' }, st)).toBe(true)
    }
  })
  it('zerwane połączenie / timeout w treści → niepewne', () => {
    expect(isUncertainWriteError({ message: 'TypeError: Failed to fetch' }, null)).toBe(true)
    expect(isUncertainWriteError({ message: 'upstream request timeout' }, 400)).toBe(true)
    expect(isUncertainWriteError({ message: 'Gateway Time-out' })).toBe(true)
  })
  it('zwykły błąd bazy (RLS, walidacja) → pewna porażka', () => {
    expect(isUncertainWriteError({ message: 'new row violates row-level security policy', code: '42501' }, 403)).toBe(false)
    expect(isUncertainWriteError({ message: 'invalid input syntax for type date' }, 400)).toBe(false)
  })
  it('brak błędu → false', () => {
    expect(isUncertainWriteError(null, 504)).toBe(false)
  })
})
