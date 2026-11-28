// Testy regresyjne krytycznej logiki poprawionej w sesji testów 27–28.11.2026 (noc).
// Każdy test opisuje błąd, który już raz wystąpił — ma nie wrócić.
import { describe, expect, it } from 'vitest'
import type { Order } from '../types'
import { computeCompanyStats, dataWydaniaSzacunkowa, daysBetween } from '../lib/companyStats'
import { isOrderCancelled } from '../lib/optimaRo'
import { czySaNiezapisane, zarejestrujNiezapisane } from '../lib/useUnsavedGuard'
import { getOrderAgeStatus } from '../utils'
import type { LeadTimeRule } from '../types'

const NOW = new Date(2026, 10, 17)

function order(p: Partial<Order>): Order {
  return { id: Math.floor(Math.random() * 1e6), order_number: '1', category: 'ST', company: 'TEST_FIRMA', model: 'M', quantity: 1, ...p } as Order
}

describe('czas realizacji bez dat wydania z dnia synchronizacji Excela (runda 3/4)', () => {
  it('dataWydaniaSzacunkowa rozpoznaje tylko flagę true', () => {
    expect(dataWydaniaSzacunkowa({ extra_fields: { release_date_szacunkowa: true } } as Order)).toBe(true)
    expect(dataWydaniaSzacunkowa({ extra_fields: { release_date_szacunkowa: false } } as Order)).toBe(false)
    expect(dataWydaniaSzacunkowa({ extra_fields: null } as Order)).toBe(false)
  })

  it('karta firmy: średnia liczona tylko z prawdziwych dat (59 dni → 8 dni)', () => {
    const orders = [
      order({ order_date: '2026-09-01', release_date: '2026-11-06', extra_fields: { release_date_szacunkowa: true } }),
      order({ order_date: '2026-09-01', release_date: '2026-11-06', extra_fields: { release_date_szacunkowa: true } }),
      order({ order_date: '2026-10-01', release_date: '2026-10-09' }),
    ]
    const st = computeCompanyStats(orders, [], ['TEST_FIRMA'], 12, NOW)
    expect(st.leadCount).toBe(1)
    expect(st.avgDays).toBe(8)
  })
})

describe('anulowanie zlecenia (runda 3/4)', () => {
  it('isOrderCancelled: tylko boolean true', () => {
    expect(isOrderCancelled({ extra_fields: { cancelled: true } } as Order)).toBe(true)
    expect(isOrderCancelled({ extra_fields: { cancelled: 'true' } } as unknown as Order)).toBe(false)
    expect(isOrderCancelled({ extra_fields: null } as Order)).toBe(false)
    expect(isOrderCancelled(null)).toBe(false)
  })

  it('anulowane zlecenie nigdy nie jest „po terminie” (kafel Pulpitu)', () => {
    const rules: LeadTimeRule[] = []
    const stare = order({ order_date: '2025-01-01', release_date: null })
    expect(getOrderAgeStatus(stare, rules)).toBe('overdue')
    expect(getOrderAgeStatus({ ...stare, extra_fields: { cancelled: true } } as Order, rules)).toBe('ok')
    expect(getOrderAgeStatus({ ...stare, release_date: '2025-02-01' } as Order, rules)).toBe('ok')
  })
})

describe('niezapisane formularze przy zamykaniu programu (runda 3/4)', () => {
  it('rejestr: zgłoszony zmieniony formularz blokuje, wyrejestrowanie zwalnia', () => {
    let zmieniony = false
    const wyrejestruj = zarejestrujNiezapisane(() => zmieniony)
    expect(czySaNiezapisane()).toBe(false)
    zmieniony = true
    expect(czySaNiezapisane()).toBe(true)
    wyrejestruj()
    expect(czySaNiezapisane()).toBe(false)
  })

  it('błąd w sprawdzeniu nie blokuje zamknięcia', () => {
    const wyrejestruj = zarejestrujNiezapisane(() => { throw new Error('x') })
    expect(czySaNiezapisane()).toBe(false)
    wyrejestruj()
  })
})

describe('daysBetween (wspólne dla Statystyk, noc 28.11)', () => {
  it('liczy dni, ujemne i błędne daty → null', () => {
    expect(daysBetween('2026-11-01', '2026-11-09')).toBe(8)
    expect(daysBetween('2026-11-09', '2026-11-01')).toBeNull()
    expect(daysBetween('xx', '2026-11-01')).toBeNull()
    expect(daysBetween('2026-11-01', '2026-11-01')).toBe(0)
  })
})
