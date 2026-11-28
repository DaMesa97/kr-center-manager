import { describe, expect, it } from 'vitest'
import { extraFieldsPoZapisie } from '../utils'

describe('D51: extra_fields po zapisie flagi problemu', () => {
  it('bierze wynik z bazy (z równoległą zmianą innego stanowiska)', () => {
    const lokalne = { a: 1 }
    const zBazy = { a: 1, route_pin: 'X', problem: { reason: 'brak szyby' } }
    expect(extraFieldsPoZapisie(lokalne, zBazy, { problem: { reason: 'brak szyby' } })).toBe(zBazy)
  })
  it('gdy baza nic nie zwróciła — scalenie lokalne', () => {
    expect(extraFieldsPoZapisie({ a: 1 }, null, { problem: null })).toEqual({ a: 1, problem: null })
    expect(extraFieldsPoZapisie(null, [1], { problem: null })).toEqual({ problem: null })
  })
})
