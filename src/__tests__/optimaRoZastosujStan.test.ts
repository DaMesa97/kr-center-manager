// 28.11 (testy, runda 6): `optima-ro-import` — ręczne „Wydaj” z programu było kasowane, gdy RO zostało
// anulowane w Optimie, a potem wróciło do realizacji (anulowanie przez import ustawiało closed_by='optima_ro').
// Testujemy PRAWDZIWĄ funkcję `zastosujStan` z pliku Edge (wycięta z pliku i przepuszczona przez esbuild).
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { describe, expect, it } from 'vitest'

// CRLF z checkoutu na Windows → LF
const zrodlo = readFileSync(new URL('../../supabase/functions/optima-ro-import/index.ts', import.meta.url), 'utf-8').replace(/\r\n/g, '\n')
const start = zrodlo.indexOf('function zastosujStan(')
const koniec = zrodlo.indexOf('\n}\n', start) + 2
const stale = ['STAN_ZREALIZOWANE', 'STAN_ANULOWANE', 'POWOD_ANUL_RO', 'POWOD_BRAK_POZ']
  .map((n) => zrodlo.match(new RegExp(`const ${n} = [^;]+;`))?.[0] ?? '')
  .join('\n')
const js = transformSync(`${stale}\n${zrodlo.slice(start, koniec)}\nreturn zastosujStan;`, { loader: 'ts' }).code
type Fn = (doc: { state: number; updated?: string }, ef: Record<string, unknown>, releaseDate: string | null, brakPozycji: boolean) => string | null | undefined
const zastosujStan = new Function(js)() as Fn

describe('optima-ro-import: zastosujStan', () => {
  it('ręczne wydanie przetrwa anulowanie RO w Optimie i jego powrót do realizacji', () => {
    const ef: Record<string, unknown> = {}
    // 1) RO anulowane w Optimie (zlecenie ma ręczną datę wydania z programu)
    expect(zastosujStan({ state: 4 }, ef, '2026-11-20', false)).toBeUndefined()
    expect(ef.cancelled).toBe(true)
    expect(ef.closed_by).toBeUndefined()
    // 2) RO wraca do realizacji — data wydania NIE jest kasowana
    expect(zastosujStan({ state: 1 }, ef, '2026-11-20', false)).toBeUndefined()
    expect(ef.cancelled).toBeUndefined()
    expect(ef.cancelled_by_import).toBeUndefined()
  })

  it('zamknięcie przez import (stan 3) nadal cofa się, gdy RO wraca do realizacji', () => {
    const ef: Record<string, unknown> = {}
    expect(zastosujStan({ state: 3, updated: '2026-11-21T10:00:00' }, ef, null, false)).toBe('2026-11-21')
    expect(ef.closed_by).toBe('optima_ro')
    expect(zastosujStan({ state: 1 }, ef, '2026-11-21', false)).toBeNull()
    expect(ef.closed_by).toBeUndefined()
  })

  it('zamknięte importem, potem anulowane, potem z powrotem — zamknięcie importu cofnięte', () => {
    const ef: Record<string, unknown> = {}
    zastosujStan({ state: 3, updated: '2026-11-21T10:00:00' }, ef, null, false)
    zastosujStan({ state: 4 }, ef, '2026-11-21', false)
    expect(ef.closed_by).toBe('optima_ro')
    expect(zastosujStan({ state: 1 }, ef, '2026-11-21', false)).toBeNull()
  })
})
