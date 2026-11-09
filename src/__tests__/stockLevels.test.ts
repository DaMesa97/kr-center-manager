import { describe, expect, it } from 'vitest'
import {
  aggregateStockLevels, buildStockShortageCsv, compareByStockLevel, countStockLevels, parseMinInput, stockLevelRank,
} from '../lib/stockLevels'
import type { StockLevelRow } from '../types'

const row = (p: Partial<StockLevelRow>): StockLevelRow => ({
  stock_id: 1, warehouse_id: 1, warehouse_code: 'MARKLOWICKA', component_id: 1, component_code: 'K1', component_name: 'Komponent',
  component_unit: 'szt', component_category: null, supplier_id: null, is_active: true, quantity: 0, reserved_quantity: 0,
  available_quantity: 0, incoming_qty: 0, earliest_eta: null, open_pos: 0, min_quantity: null, min_source: null, min_effective: null,
  level: 'inactive', shortage: 0, updated_at: null, ...p,
})

describe('stockLevels — agregacja i kolejność', () => {
  it('agregat: najgorszy poziom z półek, sumy, najniższe dostępne, minimum per magazyn', () => {
    const rows = [
      row({ stock_id: 1, warehouse_id: 1, quantity: 6, reserved_quantity: 8, available_quantity: -2, incoming_qty: 8, level: 'covered', min_quantity: 10, min_effective: 10, min_source: 'shelf' }),
      row({ stock_id: 2, warehouse_id: 2, warehouse_code: 'BUKOWA', quantity: 0, level: 'inactive' }),
      row({ stock_id: 3, warehouse_id: 1, component_id: 2, component_code: 'K2', component_name: 'Winchester', reserved_quantity: 18, available_quantity: -18, level: 'critical', shortage: 18 }),
    ]
    const agg = aggregateStockLevels(rows)
    expect(agg).toHaveLength(2)
    const k1 = agg.find((a) => a.component_id === 1)!
    expect(k1.level).toBe('covered')
    expect(k1.total).toBe(6)
    expect(k1.available).toBe(-2)
    expect(k1.incoming).toBe(8)
    expect(k1.worstAvailable).toBe(-2)
    expect(k1.minByWarehouse).toEqual({ 1: 10, 2: null })
    expect(k1.quantities).toEqual({ 1: 6, 2: 0 })
    expect(agg.find((a) => a.component_id === 2)!.shortage).toBe(18)
  })

  it('sortowanie od najgorszych: krytyczne wg największego minusa, niskie wg braku, potem OK i nieaktywne', () => {
    const rows = [
      row({ component_name: 'ok', level: 'ok' }),
      row({ component_name: 'low2', level: 'low', shortage: 2 }),
      row({ component_name: 'crit-2', level: 'critical', available_quantity: -2 }),
      row({ component_name: 'inactive', level: 'inactive' }),
      row({ component_name: 'crit-18', level: 'critical', available_quantity: -18 }),
      row({ component_name: 'covered', level: 'covered', available_quantity: -5 }),
      row({ component_name: 'low5', level: 'low', shortage: 5 }),
    ]
    expect([...rows].sort(compareByStockLevel).map((r) => r.component_name)).toEqual([
      'crit-18', 'crit-2', 'covered', 'low5', 'low2', 'ok', 'inactive',
    ])
    expect(stockLevelRank('critical')).toBe(0)
  })

  it('liczniki, pole minimum i CSV braków', () => {
    const rows = [row({ level: 'critical' }), row({ level: 'critical' }), row({ level: 'low' }), row({ level: 'ok' })]
    expect(countStockLevels(rows)).toEqual({ critical: 2, covered: 0, low: 1, ok: 1, inactive: 0 })
    expect(parseMinInput('')).toBeNull()
    expect(parseMinInput('-')).toBeNull()
    expect(parseMinInput('12,5')).toBe(12.5)
    expect(parseMinInput('-3')).toBe('invalid')
    expect(parseMinInput('abc')).toBe('invalid')
    const csv = buildStockShortageCsv([
      row({ component_name: 'Skrzydło; test', level: 'critical', available_quantity: -18, reserved_quantity: 18, shortage: 18, earliest_eta: '2026-11-20', min_effective: null }),
    ])
    const lines = csv.split('\r\n')
    expect(lines[0].startsWith('﻿Komponent;Kod;Magazyn;Poziom')).toBe(true)
    expect(lines[1]).toBe('"Skrzydło; test";K1;MARKLOWICKA;Krytyczny;0;18;-18;0;20.11.2026;;18;szt')
  })
})
