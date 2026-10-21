import { describe, expect, it } from 'vitest'
import {
  PERSONAL_PICKUP_ROUTE,
  cleanCompanyValue,
  findCompanyInfo,
  getOrderProductionDay,
  getOrderRouteDay,
  isPersonalPickup,
} from '../lib/companyMatch'
import type { Order } from '../types'

const map = new Map([
  ['po drzwi', { production_day: 'WTOREK', route_day: 'Śląsk' }],
  ['drzwi kowalski', { production_day: '#N/A', route_day: '' }],
  ['abc gliwice', { production_day: 'PIĄTEK', route_day: 'Gliwice' }],
  ['abc zabrze', { production_day: 'PIĄTEK', route_day: 'Zabrze' }],
])

const order = (o: Partial<Order>) => ({ notes: '', extra_fields: null, production_day: '', ...o }) as Order

describe('companyMatch', () => {
  it('dokładne i tolerancyjne dopasowanie firmy', () => {
    expect(findCompanyInfo(map, ' PO DRZWI ')?.route_day).toBe('Śląsk')
    expect(findCompanyInfo(map, 'PO DRZWI ŻORY')?.route_day).toBe('Śląsk')
    expect(findCompanyInfo(map, 'PO DRZWI # ŻORY')?.route_day).toBe('Śląsk')
    expect(findCompanyInfo(map, 'INNA FIRMA')).toBeNull()
    // niejednoznaczne (dwie firmy ABC z różnymi trasami) — nie zgadujemy
    expect(findCompanyInfo(map, 'ABC')).toBeNull()
  })

  it('#N/A traktowane jak puste', () => {
    expect(cleanCompanyValue('#N/A')).toBe('')
    expect(cleanCompanyValue(' - ')).toBe('')
    expect(cleanCompanyValue('PONIEDZIAŁEK')).toBe('PONIEDZIAŁEK')
  })

  it('dzień produkcji: najpierw z zamówienia, firma jako fallback', () => {
    const info = findCompanyInfo(map, 'PO DRZWI ŻORY')
    expect(getOrderProductionDay(order({ production_day: 'ŚRODA' }), info)).toBe('ŚRODA')
    expect(getOrderProductionDay(order({}), info)).toBe('WTOREK')
    expect(getOrderProductionDay(order({}), findCompanyInfo(map, 'Drzwi Kowalski'))).toBe('')
  })

  it('odbiór osobisty = osobna grupa, bez dnia z firmy', () => {
    const info = findCompanyInfo(map, 'PO DRZWI')
    const pickup = order({ notes: 'klient: odbior osobisty w piątek' })
    expect(isPersonalPickup(pickup)).toBe(true)
    expect(isPersonalPickup(order({ extra_fields: { uwagi: 'ODBIÓR OSOBISTY' } as Order['extra_fields'] }))).toBe(true)
    expect(getOrderRouteDay(pickup, info)).toBe(PERSONAL_PICKUP_ROUTE)
    expect(getOrderProductionDay(pickup, info)).toBe('')
    expect(getOrderRouteDay(order({}), info)).toBe('Śląsk')
  })
})
