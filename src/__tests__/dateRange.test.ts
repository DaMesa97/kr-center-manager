import { describe, expect, it } from 'vitest'
import { dateInRange, describeDateRange, isDateFilterActive, resolveDateRange } from '../lib/dateRange'

// Filtr dat w tabelach zleceń — presety liczone lokalnie od podanego „dziś".
const now = new Date(2026, 10, 4, 10, 30) // środa 4.11.2026

describe('dateRange — presety', () => {
  it('all = bez ograniczeń', () => {
    expect(resolveDateRange({ preset: 'all', from: '', to: '' }, now)).toEqual({ from: null, to: null })
  })
  it('dziś / ten tydzień (pn–nd) / ten miesiąc', () => {
    expect(resolveDateRange({ preset: 'today', from: '', to: '' }, now)).toEqual({ from: '2026-11-04', to: '2026-11-04' })
    expect(resolveDateRange({ preset: 'week', from: '', to: '' }, now)).toEqual({ from: '2026-11-02', to: '2026-11-08' })
    expect(resolveDateRange({ preset: 'month', from: '', to: '' }, now)).toEqual({ from: '2026-11-01', to: '2026-11-30' })
  })
  it('poprzedni miesiąc / ostatnie 30 dni / kwartał / rok', () => {
    expect(resolveDateRange({ preset: 'prev_month', from: '', to: '' }, now)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(resolveDateRange({ preset: 'last30', from: '', to: '' }, now)).toEqual({ from: '2026-10-06', to: '2026-11-04' })
    expect(resolveDateRange({ preset: 'quarter', from: '', to: '' }, now)).toEqual({ from: '2026-10-01', to: '2026-12-31' })
    expect(resolveDateRange({ preset: 'year', from: '', to: '' }, now)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })
  it('poprzedni miesiąc przez granicę roku', () => {
    expect(resolveDateRange({ preset: 'prev_month', from: '', to: '' }, new Date(2027, 0, 15))).toEqual({ from: '2026-12-01', to: '2026-12-31' })
  })
  it('zakres własny: puste = otwarty koniec', () => {
    expect(resolveDateRange({ preset: 'custom', from: '2026-10-15', to: '' }, now)).toEqual({ from: '2026-10-15', to: null })
    expect(isDateFilterActive({ preset: 'custom', from: '', to: '' })).toBe(false)
    expect(isDateFilterActive({ preset: 'custom', from: '2026-10-15', to: '' })).toBe(true)
    expect(isDateFilterActive({ preset: 'month', from: '', to: '' })).toBe(true)
  })
})

describe('dateRange — dopasowanie zlecenia', () => {
  const r = { from: '2026-11-01', to: '2026-11-30' }
  it('data w zakresie, poza zakresem, ISO z czasem, brak daty', () => {
    expect(dateInRange('2026-11-04', r)).toBe(true)
    expect(dateInRange('2026-10-31', r)).toBe(false)
    expect(dateInRange('2026-12-01', r)).toBe(false)
    expect(dateInRange('2026-11-30T23:10:00+01:00', r)).toBe(true)
    expect(dateInRange('', r)).toBe(false)
    expect(dateInRange('', { from: null, to: null })).toBe(true)
  })
  it('opis zakresu', () => {
    expect(describeDateRange({ preset: 'month', from: '', to: '' }, now)).toBe('1.11.2026 – 30.11.2026')
    expect(describeDateRange({ preset: 'today', from: '', to: '' }, now)).toBe('4.11.2026')
    expect(describeDateRange({ preset: 'custom', from: '2026-10-15', to: '' }, now)).toBe('od 15.10.2026')
  })
})
