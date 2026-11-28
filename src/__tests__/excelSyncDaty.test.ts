// 28.11 (runda 10): `excel-sync` — literówka daty w arkuszu („31.11.2026”) dawała „2026-11-31”, a SQL (::date)
// odrzucał wtedy CAŁĄ paczkę reklamacji kategorii. Testujemy PRAWDZIWE funkcje dat z pliku Edge
// (wycięte z pliku i przepuszczone przez esbuild — plik Edge woła Deno.serve, więc nie da się go zaimportować).
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { describe, expect, it } from 'vitest'

// CRLF z checkoutu na Windows → LF
const zrodlo = readFileSync(new URL('../../supabase/functions/excel-sync/index.ts', import.meta.url), 'utf-8').replace(/\r\n/g, '\n')
const wytnij = (nazwa: string): string => {
  const start = zrodlo.indexOf(`const ${nazwa} = `)
  if (start < 0) throw new Error(`brak ${nazwa} w excel-sync/index.ts`)
  const koniec = zrodlo.indexOf(';\n\n', start) + 1
  return zrodlo.slice(start, koniec)
}
const js = transformSync(
  ['serialToIso', 'isoIfReal', 'anyToIso', 'isBadDateText', 'rawIsoGuess'].map(wytnij).join('\n') + '\nreturn { anyToIso, isBadDateText, rawIsoGuess };',
  { loader: 'ts' },
).code
const { anyToIso, isBadDateText, rawIsoGuess } = new Function(js)() as {
  anyToIso: (v: unknown) => string | null
  isBadDateText: (v: unknown) => boolean
  rawIsoGuess: (v: unknown) => string | null
}

describe('excel-sync anyToIso — data musi istnieć', () => {
  it('poprawne daty jak dotąd', () => {
    expect(anyToIso('20.11.2026')).toBe('2026-11-20')
    expect(anyToIso('1.2.2026')).toBe('2026-02-01')
    expect(anyToIso('2026-11-20')).toBe('2026-11-20')
    expect(anyToIso('29.02.2028')).toBe('2028-02-29') // rok przestępny
    expect(anyToIso(46346)).toBe('2026-11-20') // numer seryjny Excela
  })

  it('niemożliwa data → null (zamiast „2026-11-31”)', () => {
    expect(anyToIso('31.11.2026')).toBeNull()
    expect(anyToIso('2026-11-31')).toBeNull()
    expect(anyToIso('29.02.2026')).toBeNull()
    expect(anyToIso('15.13.2026')).toBeNull()
    expect(anyToIso('00.11.2026')).toBeNull()
  })

  it('isBadDateText: tylko tekst wyglądający na datę, ale niemożliwy', () => {
    expect(isBadDateText('31.11.2026')).toBe(true)
    expect(isBadDateText('2026-11-31')).toBe(true)
    expect(isBadDateText('20.11.2026')).toBe(false)
    expect(isBadDateText('X')).toBe(false)
    expect(isBadDateText('ANULOWANE')).toBe(false)
    expect(isBadDateText(46346)).toBe(false)
    expect(isBadDateText('')).toBe(false)
  })
})

// runda 11: niemożliwa data idzie do SQL jako „RRRR-MM-DD” (try_date ją odrzuci i policzy w raporcie przebiegu)
describe('excel-sync rawIsoGuess', () => {
  it('zamienia zapis na RRRR-MM-DD bez sprawdzania kalendarza', () => {
    expect(rawIsoGuess('31.11.2026')).toBe('2026-11-31')
    expect(rawIsoGuess('2026-11-31')).toBe('2026-11-31')
    expect(rawIsoGuess('1.2.2026')).toBe('2026-02-01')
    expect(rawIsoGuess('X')).toBeNull()
    expect(rawIsoGuess(46000)).toBeNull()
  })
})
