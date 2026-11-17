import { describe, expect, it } from 'vitest'
import type { Order } from '../types'
import {
  ROUTE_OF_PROD, PROD_OF_ROUTE, buildPrintList, defaultRouteForToday, deskNoRo, deskRouteOf, deskSpec, deskWarehouseState,
  deskWarnings, readRoutePin, shippedToday,
} from '../lib/logisticsDesk'

const order = (p: Partial<Order>): Order => ({
  id: 1, order_number: '3888', company: 'MAXDOOR Szydłowiec', order_date: '2026-11-06', quantity: 1, system: 'Disting', model: 'OTELLO 31',
  wing_color: 'Antracyt', frame_color: '', width: '90', direction: 'LEWE', category: 'Disting', notes: '', client_order_number: '95CE70', defects: '',
  production_stages: {}, extra_fields: {}, ...p,
} as unknown as Order)

describe('logisticsDesk — biurko kierownika logistyki', () => {
  it('dzień produkcji ↔ trasa dwa dni robocze później, w obie strony', () => {
    expect(ROUTE_OF_PROD.CZWARTEK).toBe('PONIEDZIAŁEK')
    expect(ROUTE_OF_PROD.PIĄTEK).toBe('WTOREK')
    for (const prod of Object.keys(ROUTE_OF_PROD) as Array<keyof typeof ROUTE_OF_PROD>) {
      expect(PROD_OF_ROUTE[ROUTE_OF_PROD[prod]]).toBe(prod)
    }
    expect(defaultRouteForToday(new Date(2026, 10, 16))).toEqual({ prod: 'PONIEDZIAŁEK', route: 'ŚRODA' }) // 16.11.2026 = poniedziałek
    expect(defaultRouteForToday(new Date(2026, 10, 15)).prod).toBe('PONIEDZIAŁEK') // niedziela → poniedziałek
  })

  it('na magazynie: STA po wydaniu z Excela, reszta po etapach, Techniczne bez etapów', () => {
    expect(deskWarehouseState(order({ category: 'STA', release_date: null })).packed).toBe(false)
    expect(deskWarehouseState(order({ category: 'STA', release_date: '2026-11-13' }))).toMatchObject({ packed: true, source: 'wydanie' })
    const allDone = { e1: 'KS', e2_1: 'KS', e2_2: 'KS', e3: 'KS', e4: 'KS', e5: 'KS' }
    expect(deskWarehouseState(order({ category: 'Disting', production_stages: allDone }))).toMatchObject({ packed: true, source: 'etapy' })
    const partial = deskWarehouseState(order({ category: 'Disting', production_stages: { e1: 'KS' } }))
    expect(partial.packed).toBe(false)
    expect(partial.label).toContain('brakuje')
    expect(deskWarehouseState(order({ category: 'Techniczne' }))).toMatchObject({ packed: false, source: 'brak' })
  })

  it('brak RO tylko przy zleceniach z konfiguratora', () => {
    expect(deskNoRo(order({ source: 'bot', erp_ro_number: null }))).toBe(true)
    expect(deskNoRo(order({ source: 'bot', erp_ro_number: 'ZLEC/204/11/2026' }))).toBe(false)
    expect(deskNoRo(order({ source: 'excel', erp_ro_number: null }))).toBe(false)
  })

  it('ostrzeżenia: szyba zamówiona bez odbioru, niedobór, pilne; nic nie blokuje', () => {
    const w = deskWarnings(order({ glass_order_date: '2026-11-12', glass_received: false, stock_status: 'insufficient', sequence: 'X' }), [])
    expect(w.map((x) => x.kind)).toEqual(['glass', 'stock', 'rush'])
    expect(w[0].text).toContain('12.11')
    expect(deskWarnings(order({ glass_order_date: '2026-11-12', glass_received: true }), [])).toEqual([])
  })

  it('przypięcie do trasy wygrywa nad firmą i wygasa po 7 dniach', () => {
    const company = { production_day: 'CZWARTEK', route_day: 'PONIEDZIAŁEK' }
    expect(deskRouteOf(order({}), company)).toBe('PONIEDZIAŁEK')
    const fresh = order({ extra_fields: { route_pin: { route: 'WTOREK', at: new Date().toISOString() } } })
    expect(deskRouteOf(fresh, company)).toBe('WTOREK')
    const stale = order({ extra_fields: { route_pin: { route: 'WTOREK', at: new Date(Date.now() - 8 * 86_400_000).toISOString() } } })
    expect(readRoutePin(stale)).toBeNull()
    expect(deskRouteOf(stale, company)).toBe('PONIEDZIAŁEK')
  })

  it('spec, wyjechało dziś i lista do druku bez cen', () => {
    expect(deskSpec(order({ system: 'Steel Extra', wing_color: 'Antracyt', width: '90', direction: 'PRAWE' }))).toEqual({ system: 'Steel Extra', color: 'Antracyt', size: '90P' })
    const now = new Date()
    expect(shippedToday(order({ shipped_at: now.toISOString() }), now)).toBe(true)
    expect(shippedToday(order({ shipped_at: new Date(now.getTime() - 2 * 86_400_000).toISOString() }), now)).toBe(false)
    const list = buildPrintList(
      [{ name: 'MAXDOOR', orders: [order({ id: 1, extra_fields: { ready_to_invoice: true }, source: 'bot' }), order({ id: 2, order_number: '4618' })] }],
      (o) => (o.extra_fields as { ready_to_invoice?: boolean }).ready_to_invoice === true,
    )
    expect(list).toHaveLength(1)
    expect(list[0].rows).toHaveLength(1)
    expect(list[0].rows[0]).toMatchObject({ nr: '3888', cat: 'Disting', model: 'OTELLO 31', spec: 'Disting · Antracyt · 90L', qty: 1, client: '95CE70', ro: '', noRo: true })
  })
})
