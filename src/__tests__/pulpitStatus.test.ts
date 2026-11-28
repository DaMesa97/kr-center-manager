import { describe, expect, it } from 'vitest'
import { kiedyKrotko, procent, statusExcela, statusImportuRo, statusWysylkiErp } from '../lib/pulpitStatus'

const TERAZ = new Date(2026, 10, 28, 14, 0, 0) // sobota 28.11.2026 14:00 (czas lokalny)
const iso = (d: Date) => d.toISOString()

describe('pulpit — synchronizacje', () => {
  it('import RO: świeży przebieg bez błędów = Działa', () => {
    const s = statusImportuRo({ last_run_at: iso(new Date(2026, 10, 28, 13, 30)), last_result: { bledy: [] } }, TERAZ)
    expect(s.ok).toBe(true)
    expect(s.kiedy).toMatch(/^dziś 13:30$/)
  })
  it('import RO: błędy w ostatnim przebiegu = Błąd', () => {
    const s = statusImportuRo({ last_run_at: iso(new Date(2026, 10, 28, 13, 30)), last_result: { bledy: ['x', 'y'] } }, TERAZ)
    expect(s.ok).toBe(false)
    expect(s.opis).toContain('2 błędów')
  })
  it('import RO: brak przebiegu od ponad 2 godzin = Błąd', () => {
    const s = statusImportuRo({ last_run_at: iso(new Date(2026, 10, 28, 11, 0)), last_result: { bledy: [] } }, TERAZ)
    expect(s.ok).toBe(false)
  })
  it('import RO: brak danych = Błąd', () => {
    expect(statusImportuRo(null, TERAZ).ok).toBe(false)
  })
  it('Excel: przeterminowany = Błąd, świeży = Działa', () => {
    expect(statusExcela({ lastSyncAt: iso(new Date(2026, 10, 27, 20, 0)), stale: false }, TERAZ)).toMatchObject({ ok: true, kiedy: 'wczoraj 20:00' })
    expect(statusExcela({ lastSyncAt: iso(new Date(2026, 10, 25, 20, 0)), stale: true }, TERAZ).ok).toBe(false)
    expect(statusExcela(undefined, TERAZ).ok).toBe(false)
  })
  it('wysyłka do Optimy: błędy ERP = Błąd', () => {
    expect(statusWysylkiErp(0).ok).toBe(true)
    expect(statusWysylkiErp(7)).toMatchObject({ ok: false, opis: '7 zamówień nieprzyjętych' })
    expect(statusWysylkiErp(1).opis).toBe('1 zamówienie nieprzyjęte')
  })
})

describe('pulpit — formaty', () => {
  it('kiedyKrotko: starsze niż tydzień = data', () => {
    expect(kiedyKrotko(iso(new Date(2026, 10, 12, 8, 15)), TERAZ)).toBe('12.11 08:15')
    expect(kiedyKrotko(null, TERAZ)).toBe('brak')
  })
  it('procent: zaokrąglenie i dzielenie przez zero', () => {
    expect(procent(237, 282)).toBe(84)
    expect(procent(5, 0)).toBeNull()
  })
})
