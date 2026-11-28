// D10 (28.11.2026): MR Profil — numer zlecenia z przedrostkiem „MR/” (prawdziwa funkcja z pliku Edge,
// wycięta i przepuszczona przez esbuild jak w optimaRoZastosujStan.test.ts) i opisy nieudanych RO.
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../supabaseClient', () => ({ supabase: {} }))

import { failureLabel, failureStatus, isMissingRelation, OPTIMA_RO_MAX_AUTO } from '../lib/optimaRoFailures'
import { isMrProfilOrder } from '../lib/optimaRo'
import { isInternalWarehouseCode } from '../utils'
import { firmaArgs } from '../lib/wewFirma'

const zrodlo = readFileSync(new URL('../../supabase/functions/optima-ro-import/index.ts', import.meta.url), 'utf-8').replace(/\r\n/g, '\n')

function wytnij(nazwa: string): string {
  const start = zrodlo.indexOf(`function ${nazwa}(`)
  const koniec = zrodlo.indexOf('\n}\n', start) + 2
  return zrodlo.slice(start, koniec)
}

const js = transformSync(`${wytnij('numerZlecenia')}\nreturn numerZlecenia;`, { loader: 'ts' }).code
const numerZlecenia = new Function(js)() as (baza: string, fullNumber: string) => string

describe('optima-ro-import: numer zlecenia (D10)', () => {
  it('KR Center bez zmian, MR Profil z „MR/”', () => {
    expect(numerZlecenia('KR', 'ZLEC/2071/11/2026')).toBe('ZLEC/2071/11/2026')
    expect(numerZlecenia('MR', 'ZLEC/2071/11/2026')).toBe('MR/ZLEC/2071/11/2026')
  })
  it('bez podwójnego przedrostka i bez „MR/” dla pustego numeru', () => {
    expect(numerZlecenia('MR', 'MR/ZLEC/1/11/2026')).toBe('MR/ZLEC/1/11/2026')
    expect(numerZlecenia('MR', '  ')).toBe('')
  })
  it('order_number zlecenia z importu idzie przez numerZlecenia, erp_ro_number zostaje numerem z Optimy', () => {
    expect(zrodlo).toContain('order_number: numerZlecenia(baza, doc.fullNumber), erp_ro_number: doc.fullNumber')
  })
  it('błąd zapisu RO trafia do optima_ro_failures, nie tylko do last_result', () => {
    expect(zrodlo).toMatch(/catch \(e\) \{\n\s+bledy\.push\(`\$\{d\.fullNumber\}[^\n]+\n[^\n]+\n\s+await zapiszBladRo\(baza, d, String\(e\)\);/)
  })
})

describe('nieudane RO w Weryfikacji (D10)', () => {
  it('etykieta jak numer zlecenia w aplikacji', () => {
    expect(failureLabel({ baza: 'MR', full_number: 'ZLEC/5/11/2026', document_id: 1 })).toBe('MR/ZLEC/5/11/2026')
    expect(failureLabel({ baza: 'KR', full_number: 'ZLEC/5/11/2026', document_id: 1 })).toBe('ZLEC/5/11/2026')
    expect(failureLabel({ baza: 'KR', full_number: null, document_id: 77 })).toBe('dokument #77')
  })
  it('stan: automatyczne próby, po limicie tylko ręcznie, oznaczone do ponowienia', () => {
    expect(failureStatus({ attempts: 1, retry_requested_at: null })).toContain(`1/${OPTIMA_RO_MAX_AUTO}`)
    expect(failureStatus({ attempts: OPTIMA_RO_MAX_AUTO, retry_requested_at: null })).toContain('Ponów')
    expect(failureStatus({ attempts: 9, retry_requested_at: '2026-11-28T10:00:00Z' })).toBe('czeka na ponowienie')
  })
  it('brak tabeli (migracja niewgrana) rozpoznany — sekcja ukryta zamiast błędu', () => {
    expect(isMissingRelation({ code: 'PGRST205', message: "Could not find the table 'public.optima_ro_failures'" })).toBe(true)
    expect(isMissingRelation({ code: '42P01', message: 'relation does not exist' })).toBe(true)
    expect(isMissingRelation({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isMissingRelation(null)).toBe(false)
  })
})

describe('magazyn MR Profil (D10)', () => {
  it('zlecenie MR rozpoznane po optima_key (kolumna albo source_metadata), tylko z importu RO', () => {
    expect(isMrProfilOrder({ source: 'optima_ro', optima_key: 'MR:123' })).toBe(true)
    expect(isMrProfilOrder({ source: 'optima_ro', source_metadata: { optima_key: 'MR:5' } })).toBe(true)
    expect(isMrProfilOrder({ source: 'optima_ro', optima_key: 'KR:123' })).toBe(false)
    expect(isMrProfilOrder({ source: 'manual', optima_key: 'MR:1' })).toBe(false)
    expect(isMrProfilOrder({ source: 'optima_ro' })).toBe(false)
  })
  it('MR_WEW to magazyn drzwi wewnętrznych (nie surowców), ale nie pasuje do wzorca KR WEW%', () => {
    expect(isInternalWarehouseCode('MR_WEW')).toBe(true)
    expect(isInternalWarehouseCode('mr_wew')).toBe(true)
    expect(isInternalWarehouseCode('MARKLOWICKA')).toBe(false)
    expect('MR_WEW'.startsWith('WEW')).toBe(false)
  })
})

describe('statystyki drzwi wewnętrznych — filtr firmy (D10)', () => {
  it('p_firma dokładany tylko, gdy baza go zna (po PGRST202 — bez)', () => {
    expect(firmaArgs({ p_months: 13 }, 'MR', true)).toEqual({ p_months: 13, p_firma: 'MR' })
    expect(firmaArgs({ p_months: 13 }, 'MR', false)).toEqual({ p_months: 13 })
  })
})
