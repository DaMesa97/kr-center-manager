// D25 (28.11): `excel-sync` — hala może wpisywać w Excelu datę zamiast samego „X” (ST / Bastion).
// Testujemy PRAWDZIWY parser komórki z pliku Edge (supabase/functions/excel-sync/daty.ts — bez zależności od Deno).
import { describe, expect, it } from 'vitest'
import { czytajDateKomorki, isoJesliIstnieje, seryjnaNaIso } from '../../supabase/functions/excel-sync/daty'

const DZIS = '2026-11-28'
const c = (v: unknown, dzis = DZIS) => czytajDateKomorki(v, dzis)

describe('excel-sync czytajDateKomorki — „X” jak dotąd', () => {
  it('X / XX / x = znacznik bez daty', () => {
    expect(c('X')).toEqual({ rodzaj: 'x' })
    expect(c(' xx ')).toEqual({ rodzaj: 'x' })
  })
  it('pusta komórka', () => {
    expect(c(null)).toEqual({ rodzaj: 'pusta' })
    expect(c(undefined)).toEqual({ rodzaj: 'pusta' })
    expect(c('   ')).toEqual({ rodzaj: 'pusta' })
  })
  it('inicjały i inne teksty to nie data', () => {
    expect(c('KS')).toEqual({ rodzaj: 'inne', tekst: 'KS' })
    expect(c('ANULOWANE')).toEqual({ rodzaj: 'inne', tekst: 'ANULOWANE' })
    expect(c('S2')).toEqual({ rodzaj: 'inne', tekst: 'S2' })
    expect(c('15.11 KS')).toEqual({ rodzaj: 'inne', tekst: '15.11 KS' })
  })
})

describe('excel-sync czytajDateKomorki — formaty daty', () => {
  it('liczba seryjna Excela (komórka sformatowana jako data)', () => {
    expect(c(46346)).toEqual({ rodzaj: 'data', iso: '2026-11-20' })
    expect(c(46346.75)).toEqual({ rodzaj: 'data', iso: '2026-11-20' }) // godzina pomijana
    expect(seryjnaNaIso(46346)).toBe('2026-11-20')
  })
  it('liczba spoza zakresu dat to nie data', () => {
    expect(c(3)).toEqual({ rodzaj: 'inne', tekst: '3' })
    expect(seryjnaNaIso(3)).toBeNull()
  })
  it('dd.mm.rrrr, d.m.rrrr, dd/mm/rrrr, dd-mm-rrrr', () => {
    expect(c('20.11.2026')).toEqual({ rodzaj: 'data', iso: '2026-11-20' })
    expect(c('1.2.2026')).toEqual({ rodzaj: 'data', iso: '2026-02-01' })
    expect(c('20/11/2026')).toEqual({ rodzaj: 'data', iso: '2026-11-20' })
    expect(c('20-11-2026')).toEqual({ rodzaj: 'data', iso: '2026-11-20' })
  })
  it('dd.mm.rr = 20rr', () => {
    expect(c('20.11.26')).toEqual({ rodzaj: 'data', iso: '2026-11-20' })
  })
  it('ISO, także z godziną', () => {
    expect(c('2026-11-20')).toEqual({ rodzaj: 'data', iso: '2026-11-20' })
    expect(c('2026-11-20T08:15:00')).toEqual({ rodzaj: 'data', iso: '2026-11-20' })
    expect(c('2026-11-20 08:15')).toEqual({ rodzaj: 'data', iso: '2026-11-20' })
  })
  it('dd.mm bez roku: rok bieżący, a gdy wypada w przyszłości — poprzedni', () => {
    expect(c('20.11')).toEqual({ rodzaj: 'data', iso: '2026-11-20' })
    expect(c('20.11.')).toEqual({ rodzaj: 'data', iso: '2026-11-20' })
    expect(c('28.11')).toEqual({ rodzaj: 'data', iso: '2026-11-28' }) // dziś
    expect(c('15.12')).toEqual({ rodzaj: 'data', iso: '2025-12-15' })
    expect(c('3.1', '2027-01-05')).toEqual({ rodzaj: 'data', iso: '2027-01-03' })
    expect(c('30.12', '2027-01-05')).toEqual({ rodzaj: 'data', iso: '2026-12-30' })
  })
})

describe('excel-sync czytajDateKomorki — złe daty (raport zle_daty, bez zapisu)', () => {
  it('data niemożliwa w kalendarzu', () => {
    expect(c('31.11.2026')).toEqual({ rodzaj: 'zla_data', tekst: '31.11.2026' })
    expect(c('31.11')).toEqual({ rodzaj: 'zla_data', tekst: '31.11' })
    expect(c('15.13')).toEqual({ rodzaj: 'zla_data', tekst: '15.13' })
    expect(c('00.11.2026')).toEqual({ rodzaj: 'zla_data', tekst: '00.11.2026' })
    expect(c('2026-02-30')).toEqual({ rodzaj: 'zla_data', tekst: '2026-02-30' })
    expect(c('29.02.2026')).toEqual({ rodzaj: 'zla_data', tekst: '29.02.2026' })
  })
  it('29.02 bez roku: w roku nieprzestępnym zła, w przestępnym dobra', () => {
    expect(c('29.02', '2026-11-28')).toEqual({ rodzaj: 'zla_data', tekst: '29.02' })
    expect(c('29.02', '2028-03-10')).toEqual({ rodzaj: 'data', iso: '2028-02-29' })
  })
  it('data z przyszłości (pełna albo seryjna)', () => {
    expect(c('15.12.2026')).toEqual({ rodzaj: 'zla_data', tekst: '15.12.2026' })
    expect(c('2027-01-02')).toEqual({ rodzaj: 'zla_data', tekst: '2027-01-02' })
    expect(c(46400)).toEqual({ rodzaj: 'zla_data', tekst: '2027-01-13' })
  })
  it('isoJesliIstnieje pilnuje kalendarza', () => {
    expect(isoJesliIstnieje(2028, 2, 29)).toBe('2028-02-29')
    expect(isoJesliIstnieje(2026, 2, 29)).toBeNull()
    expect(isoJesliIstnieje(2026, 4, 31)).toBeNull()
  })
})
