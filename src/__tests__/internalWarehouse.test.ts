import { describe, expect, it } from 'vitest'
import type { WarehouseComponent } from '../types'
import {
  DOOR_FILTER_EMPTY,
  distinctValues,
  internalDoorComponents,
  internalReservations,
  internalShortages,
  isInternalDoorComponent,
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
      c(1, { name: 'Skrzydło Verona' }),
      c(2, { name: 'Wkładka 30/35', product_category: 'door_accessory' }),
      c(3, { name: 'Zawias', product_category: 'raw' }),
      c(4, { name: 'BASTION Interior skrzydło' }),
      c(5, { name: 'Stare', is_active: false }),
    ]
    expect(internalDoorComponents(list).map((x) => x.id)).toEqual([1, 2])
  })
})

describe('filtry spisu i stanów', () => {
  const verona = { code: 'SKR-VER-80L', name: 'Skrzydło Verona', product_category: 'door_wing', door_model: 'Verona', door_color: 'Dąb złoty', door_size: '80', door_direction: 'L' }
  it('wyszukiwarka po kodzie, modelu, kolorze, rozmiarze — bez ogonków, każde słowo', () => {
    expect(matchesDoorFilter(verona, { ...DOOR_FILTER_EMPTY, q: 'verona 80' })).toBe(true)
    expect(matchesDoorFilter(verona, { ...DOOR_FILTER_EMPTY, q: 'dab zloty' })).toBe(true)
    expect(matchesDoorFilter(verona, { ...DOOR_FILTER_EMPTY, q: 'skr-ver' })).toBe(true)
    expect(matchesDoorFilter(verona, { ...DOOR_FILTER_EMPTY, q: 'verona 90' })).toBe(false)
  })
  it('kategoria, model, kolor', () => {
    expect(matchesDoorFilter(verona, { ...DOOR_FILTER_EMPTY, category: 'door_frame' })).toBe(false)
    expect(matchesDoorFilter(verona, { ...DOOR_FILTER_EMPTY, model: 'Verona', color: 'Dąb złoty' })).toBe(true)
    expect(matchesDoorFilter(verona, { ...DOOR_FILTER_EMPTY, color: 'Biały' })).toBe(false)
  })
  it('listy modeli / kolorów z zakresu kategorii', () => {
    const rows = [verona, { ...verona, door_model: 'Maleo' }, { product_category: 'door_frame', door_model: 'OR-2', door_color: 'Biały' }]
    expect(distinctValues(rows, 'door_model')).toEqual(['Maleo', 'OR-2', 'Verona'])
    expect(distinctValues(rows, 'door_model', 'door_wing')).toEqual(['Maleo', 'Verona'])
  })
})

describe('braki przy wydaniu zlecenia', () => {
  it('przy stanie 0 brak = cała ilość do wydania; po częściowym WZ tylko reszta', () => {
    const items = [
      { component_id: 863, quantity: 3 },
      { component_id: 597, quantity: 1 },
      { component_id: null, quantity: 2 },
    ]
    const s = internalShortages(items, new Map([[597, 5]]), [{ component_id: 863, movement_type: 'WZ', quantity: 1 }])
    expect(s.get(863)).toEqual({ componentId: 863, toIssue: 2, stock: 0, missing: 2 })
    expect(s.get(597)).toEqual({ componentId: 597, toIssue: 1, stock: 5, missing: 0 })
    expect(s.size).toBe(2)
  })
  it('ujemny stan liczy się jak 0', () => {
    expect(internalShortages([{ component_id: 1, quantity: 2 }], new Map([[1, -3]]), []).get(1)?.missing).toBe(2)
  })
})

describe('niepełne pola door_* z importu', () => {
  it('ościeżnica bez modelu i koloru — szukana po kodzie i nazwie, filtr kategorii działa', () => {
    const frame = { code: 'BAZA OŚC PR KASZMIR PRO PRAWA', name: 'BAZA OŚCIEŻNICY PROSTEJ KASZMIR PRO PRAWA', product_category: 'door_frame', door_model: null, door_color: null, door_size: null, door_direction: null }
    expect(matchesDoorFilter(frame, { ...DOOR_FILTER_EMPTY, q: 'kaszmir prawa' })).toBe(true)
    expect(matchesDoorFilter(frame, { ...DOOR_FILTER_EMPTY, q: 'osc pr' })).toBe(true)
    expect(matchesDoorFilter(frame, { ...DOOR_FILTER_EMPTY, q: 'oscieznicy' })).toBe(true)
    expect(matchesDoorFilter(frame, { ...DOOR_FILTER_EMPTY, category: 'door_frame' })).toBe(true)
    expect(matchesDoorFilter(frame, { ...DOOR_FILTER_EMPTY, model: 'MODERNA BLACK 02' })).toBe(false)
    expect(distinctValues([frame], 'door_model')).toEqual([])
  })
  it('grupa DRZWI WEWNĘTRZNE z importu też należy do magazynu wewnętrznego', () => {
    expect(isInternalDoorComponent({ product_category: 'raw', category: 'DRZWI WEWNĘTRZNE' })).toBe(true)
    expect(isInternalDoorComponent({ product_category: 'door_accessory', category: null })).toBe(true)
    expect(isInternalDoorComponent({ product_category: 'raw', category: 'PROFILE' })).toBe(false)
  })
  it('akcesoria (door_accessory) to też drzwi wewnętrzne', () => {
    expect(internalDoorComponents([c(9, { name: 'ZAMEK WC', product_category: 'door_accessory' })]).map((x) => x.id)).toEqual([9])
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
