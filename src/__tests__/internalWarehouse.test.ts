import { describe, expect, it } from 'vitest'
import type { WarehouseComponent } from '../types'
import {
  DOOR_FILTER_EMPTY,
  distinctValues,
  internalDoorComponents,
  internalReservations,
  isOptimaImportedComponent,
  matchesDoorFilter,
} from '../lib/internalWarehouse'

const c = (id: number, p: Partial<WarehouseComponent>) =>
  ({ id, code: null, name: '', unit: 'szt', is_active: true, product_category: 'door_wing', ...p }) as WarehouseComponent

describe('komponenty magazynu wewnętrznego', () => {
  it('import z kartotek Optimy po notatce', () => {
    expect(isOptimaImportedComponent({ notes: 'Import z kartotek Optimy (KR Center)' })).toBe(true)
    expect(isOptimaImportedComponent({ notes: '  Import z kartotek Optimy (MR Profil)' })).toBe(true)
    expect(isOptimaImportedComponent({ notes: 'ręcznie' })).toBe(false)
    expect(isOptimaImportedComponent(null)).toBe(false)
  })

  it('do powiązań tylko aktywne drzwi wewnętrzne, bez surowców i bez Bastiona', () => {
    const list = [
      c(1, { name: 'Skrzydło Rivoli' }),
      c(2, { name: 'Wkładka 30/35', product_category: 'door_accessory' }),
      c(3, { name: 'Zawias', product_category: 'raw' }),
      c(4, { name: 'BASTION Interior skrzydło' }),
      c(5, { name: 'Stare', is_active: false }),
    ]
    expect(internalDoorComponents(list).map((x) => x.id)).toEqual([1, 2])
  })
})

describe('filtry spisu i stanów', () => {
  const rivoli = { code: 'SKR-RIV-80L', name: 'Skrzydło Rivoli', product_category: 'door_wing', door_model: 'Rivoli', door_color: 'Dąb złoty', door_size: '80', door_direction: 'L' }
  it('wyszukiwarka po kodzie, modelu, kolorze, rozmiarze — bez ogonków, każde słowo', () => {
    expect(matchesDoorFilter(rivoli, { ...DOOR_FILTER_EMPTY, q: 'rivoli 80' })).toBe(true)
    expect(matchesDoorFilter(rivoli, { ...DOOR_FILTER_EMPTY, q: 'dab zloty' })).toBe(true)
    expect(matchesDoorFilter(rivoli, { ...DOOR_FILTER_EMPTY, q: 'skr-riv' })).toBe(true)
    expect(matchesDoorFilter(rivoli, { ...DOOR_FILTER_EMPTY, q: 'rivoli 90' })).toBe(false)
  })
  it('kategoria, model, kolor', () => {
    expect(matchesDoorFilter(rivoli, { ...DOOR_FILTER_EMPTY, category: 'door_frame' })).toBe(false)
    expect(matchesDoorFilter(rivoli, { ...DOOR_FILTER_EMPTY, model: 'Rivoli', color: 'Dąb złoty' })).toBe(true)
    expect(matchesDoorFilter(rivoli, { ...DOOR_FILTER_EMPTY, color: 'Biały' })).toBe(false)
  })
  it('listy modeli / kolorów z zakresu kategorii', () => {
    const rows = [rivoli, { ...rivoli, door_model: 'Maleo' }, { product_category: 'door_frame', door_model: 'OR-2', door_color: 'Biały' }]
    expect(distinctValues(rows, 'door_model')).toEqual(['Maleo', 'OR-2', 'Rivoli'])
    expect(distinctValues(rows, 'door_model', 'door_wing')).toEqual(['Maleo', 'Rivoli'])
  })
})

describe('rezerwacje z otwartych zleceń', () => {
  it('ilość z pozycji minus to, co już zeszło dla zlecenia (WZ − ZWR); bez komponentu nie rezerwuje', () => {
    const items = [
      { order_id: 1, component_id: 10, quantity: 2 }, // z Optimy, jeszcze nie wydane
      { order_id: 2, component_id: 10, quantity: 1 }, // ręczne — zeszło przy zapisie
      { order_id: 3, component_id: 11, quantity: 3 }, // częściowo zeszło, 1 zwrot
      { order_id: 3, component_id: null, quantity: 5 }, // kod z Optimy bez komponentu
    ]
    const moves = [
      { order_id: 2, component_id: 10, movement_type: 'WZ', quantity: 1 },
      { order_id: 3, component_id: 11, movement_type: 'WZ', quantity: 2 },
      { order_id: 3, component_id: 11, movement_type: 'ZWR', quantity: 1 },
      { order_id: 3, component_id: 11, movement_type: 'INW', quantity: 9 },
    ]
    const r = internalReservations(items, moves)
    expect(r.get(10)).toBe(2)
    expect(r.get(11)).toBe(2)
    expect(r.size).toBe(2)
  })
})
