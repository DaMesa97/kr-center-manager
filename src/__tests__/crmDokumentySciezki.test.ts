// D23 (28.11): protokół odbioru we własnym pliku — nie nadpisuje protokołu drugiej umowy o tym samym numerze.
import { describe, expect, it } from 'vitest'
// import dynamiczny: plik Deno bez importów (jak crmUsuwaniePlikow.test.ts)
const sciezka = '../../supabase/functions/crm-dokumenty/sciezki.ts'
const mod = (await import(/* @vite-ignore */ sciezka)) as {
  znacznikCzasu: (d?: Date) => string
  sciezkaUmowy: (leadId: string, numer: string, znacznik?: string) => string
  sciezkaProtokolu: (leadId: string, numer: string | null | undefined, znacznik?: string) => string
  nadpisujPlik: (rodzaj: string) => boolean
}

const L = '11111111-2222-3333-4444-555555555555'

describe('D23: ścieżki plików dokumentów CRM', () => {
  it('znacznik czasu z milisekundami (UTC)', () => {
    expect(mod.znacznikCzasu(new Date('2026-11-28T14:30:15.123Z'))).toBe('20261128-143015-123')
  })

  it('umowa: numer bez ukośników + znacznik', () => {
    expect(mod.sciezkaUmowy(L, '12/11/2026', '20261128-143015-123')).toBe(`${L}/umowa-12-11-2026-20261128-143015-123.pdf`)
  })

  it('protokół: własny plik ze znacznikiem — dwa protokoły tej samej umowy / numeru to dwa pliki', () => {
    const a = mod.sciezkaProtokolu(L, '12/11/2026', '20261128-143015-123')
    const b = mod.sciezkaProtokolu(L, '12/11/2026', '20261128-143015-124')
    expect(a).toBe(`${L}/protokol-12-11-2026-20261128-143015-123.pdf`)
    expect(a).not.toBe(b)
    expect(mod.sciezkaProtokolu(L, null, 'X')).toBe(`${L}/protokol--X.pdf`)
  })

  it('nadpisywanie pliku tylko dla karty pomiarowej', () => {
    expect(mod.nadpisujPlik('karta_pomiarowa')).toBe(true)
    expect(mod.nadpisujPlik('umowa')).toBe(false)
    expect(mod.nadpisujPlik('protokol')).toBe(false)
  })
})
