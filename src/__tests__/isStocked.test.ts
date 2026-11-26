import { describe, expect, it } from 'vitest'
import type { Order } from '../types'
import { groupInventoryLines, internalShortages, sortInventoryLines } from '../lib/internalWarehouse'
import { INT_DOOR_FILTER_DEFAULT, isOptimaClosed, matchesIntDoorFilter, optimaClosedLabel, optimaStatusNote } from '../lib/optimaRo'
import { canSetStocked, isStocked } from '../lib/warehouseStocked'

const ro = (p: Partial<Order>) =>
  ({ source: 'optima_ro', source_metadata: { optima_key: 'KR:1', state: 0 }, extra_fields: {}, release_date: null, ...p }) as unknown as Order

describe('is_stocked — trzymamy na magazynie / kartoteka w tle', () => {
  it('brak pola = na magazynie (DEFAULT true); false = w tle', () => {
    expect(isStocked({})).toBe(true)
    expect(isStocked({ is_stocked: true })).toBe(true)
    expect(isStocked({ is_stocked: false })).toBe(false)
  })
  it('przestawia kierownik i magazyn, zwykły użytkownik nie', () => {
    expect(canSetStocked({ role: 'magazynier' }, false)).toBe(true)
    expect(canSetStocked({ role: 'worker', department: 'magazyn' }, false)).toBe(true)
    expect(canSetStocked({ role: 'sprzedawca' }, false)).toBe(false)
    expect(canSetStocked({ role: 'pracownik_produkcji' }, false)).toBe(false)
    expect(canSetStocked({ role: 'kierownik_magazynu' }, true)).toBe(true)
  })
  it('braki liczone tylko z pozycji trzymanych na magazynie (aplikacja filtruje przed internalShortages)', () => {
    const items = [
      { component_id: 1, quantity: 2, component_is_stocked: true },
      { component_id: 2, quantity: 5, component_is_stocked: false },
    ]
    const s = internalShortages(items.filter((i) => i.component_is_stocked !== false), new Map(), [])
    expect([...s.keys()]).toEqual([1])
  })
})

describe('spis z natury magazynu wewnętrznego', () => {
  const l = (component_category: string, component_name: string) => ({ component_category, component_name })
  it('grupy: skrzydła, ościeżnice, klamki, akcesoria, osłonki — w grupie po nazwie', () => {
    const lines = [l('door_handle', 'KLAMKA B'), l('door_wing', 'SKRZYDŁO Z'), l('door_hinge_cover', 'OSŁONKA'), l('door_wing', 'SKRZYDŁO A'), l('door_accessory', 'ZAMEK'), l('door_frame', 'BAZA')]
    expect(sortInventoryLines(lines).map((x) => x.component_name)).toEqual(['SKRZYDŁO A', 'SKRZYDŁO Z', 'BAZA', 'KLAMKA B', 'ZAMEK', 'OSŁONKA'])
    expect(groupInventoryLines(lines).map((g) => [g.key, g.lines.length])).toEqual([
      ['door_wing', 2], ['door_frame', 1], ['door_handle', 1], ['door_accessory', 1], ['door_hinge_cover', 1],
    ])
  })
  it('surowce bez grup i bez zmiany kolejności', () => {
    const raw = [l('raw', 'B'), l('raw', 'A')]
    expect(sortInventoryLines(raw)).toBe(raw)
    expect(groupInventoryLines(raw)).toEqual([{ key: '', lines: raw }])
  })
})

describe('statusy z Optimy (import co godzinę)', () => {
  it('release_date + closed_by = optima_ro → zamknięte wg Optimy', () => {
    const o = ro({ release_date: '2026-11-20', extra_fields: { closed_by: 'optima_ro' }, source_metadata: { optima_key: 'KR:1', state: 0 } as Order['source_metadata'] })
    expect(isOptimaClosed(o)).toBe(true)
    expect(optimaClosedLabel(o)).toBe('Zrealizowane w Optimie')
    expect(optimaStatusNote(o)).toBe('zamknięte wg Optimy (RO zrealizowane)')
  })
  it('anulowane w Optimie (ZLEC/1730/11/2026) — adnotacja, a ukrywa je ogólny filtr „Pokaż anulowane”, nie przełącznik zrealizowanych', () => {
    const o = ro({ extra_fields: { cancelled: true, closed_by: 'optima_ro', cancelled_reason: 'RO anulowane w Optimie' }, source_metadata: { optima_key: 'KR:1', state: 4 } as Order['source_metadata'] })
    expect(optimaStatusNote(o)).toBe('anulowane wg Optimy')
    expect(matchesIntDoorFilter(o, INT_DOOR_FILTER_DEFAULT, null)).toBe(true)
  })
  it('ręczne zamknięcie w programie (bez closed_by) to nie „wg Optimy”', () => {
    const o = ro({ release_date: '2026-11-20' })
    expect(isOptimaClosed(o)).toBe(false)
    expect(optimaStatusNote(o)).toBeNull()
  })
})
