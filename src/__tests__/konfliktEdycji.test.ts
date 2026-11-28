import { describe, expect, it } from 'vitest'
import { komunikatKonfliktuEdycji, wykryjKonfliktEdycji } from '../lib/konfliktEdycji'

const baza = {
  id: 1, company: 'A', quantity: 1, notes: null, stock_status: 'ok', production_stages: {},
  updated_at: '2026-11-28T10:00:00+00:00', extra_fields: { wykonawca: 'X', warnings: [] },
}

describe('konflikt edycji zlecenia (D29)', () => {
  it('bez updated_at (przed migracją) albo z tym samym — brak konfliktu', () => {
    const bez: Record<string, unknown> = { ...baza }
    delete bez.updated_at
    expect(wykryjKonfliktEdycji(bez, { ...bez, company: 'B' }).konflikt).toBe(false)
    expect(wykryjKonfliktEdycji(baza, { ...baza, updated_at: '2026-11-28T10:00:00.000Z', company: 'B' }).konflikt).toBe(false)
    expect(wykryjKonfliktEdycji(null, baza).konflikt).toBe(false)
  })
  it('zmiana pola formularza przez kogoś innego — konflikt z nazwą pola', () => {
    const r = wykryjKonfliktEdycji(baza, { ...baza, updated_at: '2026-11-28T10:05:00+00:00', company: 'B' })
    expect(r).toEqual({ konflikt: true, pola: ['firma'] })
    const r2 = wykryjKonfliktEdycji(baza, {
      ...baza, updated_at: '2026-11-28T10:05:00+00:00', extra_fields: { wykonawca: 'Y', warnings: [] },
    })
    expect(r2.pola).toEqual(['wykonawca'])
  })
  it('zmiana tylko pól technicznych (etapy, magazyn, ostrzeżenia) albo null↔"" — brak konfliktu', () => {
    const r = wykryjKonfliktEdycji(baza, {
      ...baza, updated_at: '2026-11-28T10:05:00+00:00', stock_status: 'insufficient', production_stages: { e1: 'X' },
      notes: '', extra_fields: { wykonawca: 'X', warnings: ['nowe'], needs_review: true },
    })
    expect(r.konflikt).toBe(false)
  })
  it('komunikat mówi „odśwież” i skraca długą listę', () => {
    const m = komunikatKonfliktuEdycji(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'])
    expect(m).toContain('odśwież')
    expect(m).toContain('i 2 więcej')
  })
})
