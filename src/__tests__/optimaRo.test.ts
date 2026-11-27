import { describe, expect, it } from 'vitest'
import type { InternalDoorItem, Order, WarehouseComponent } from '../types'
import {
  INT_DOOR_FILTER_DEFAULT,
  cancelledReason,
  canMapOptimaCodes,
  formatOptimaDateTime,
  groupItemsByType,
  groupUnmappedCodes,
  isIntDoorFilterActive,
  isKitPart,
  kitCodeOf,
  isOptimaClosed,
  isOptimaOrder,
  isSyncRunning,
  matchesIntDoorFilter,
  qtyByUnit,
  summarizeItems,
  wingCount,
  optimaBaza,
  optimaClosedLabel,
  optimaState,
  recipientAddress,
  syncErrors,
  unmappedItems,
} from '../lib/optimaRo'
import { searchComponents } from '../lib/componentLabel'

const ro = (key: string, extra: Partial<Order> = {}) =>
  ({
    source: 'optima_ro',
    source_metadata: { optima_key: key, baza: key.startsWith('MR') ? 'MR Profil' : 'KR Center', updated: '2026-11-20T07:37:56' },
    extra_fields: {},
    ...extra,
  }) as unknown as Order
const manual = { source: 'manual', source_metadata: null, extra_fields: {} } as unknown as Order

const item = (p: Partial<InternalDoorItem>) =>
  ({ id: 1, order_id: 1, component_id: null, quantity: 1, shorten_enabled: false, shorten_target_height: null, notes: null, created_at: '', ...p }) as InternalDoorItem

describe('zlecenia z Optimy', () => {
  it('źródło i baza z klucza KR:/MR:, awaryjnie z nazwy bazy', () => {
    expect(isOptimaOrder(ro('KR:677707'))).toBe(true)
    expect(isOptimaOrder(manual)).toBe(false)
    expect(optimaBaza(ro('KR:677707'))).toBe('KR')
    expect(optimaBaza(ro('MR:12'))).toBe('MR')
    expect(optimaBaza({ source: 'optima_ro', source_metadata: { baza: 'MR Profil' } } as unknown as Order)).toBe('MR')
    expect(optimaBaza(manual)).toBeNull()
  })

  it('powód anulowania: z importu albo kto/kiedy przy ręcznym', () => {
    expect(cancelledReason(ro('KR:1', { extra_fields: { cancelled: true, cancelled_reason: 'RO bez pozycji drzwi wewnętrznych' } }))).toBe(
      'RO bez pozycji drzwi wewnętrznych',
    )
    expect(cancelledReason({ extra_fields: { cancelled: true, cancelled_at: '2026-11-20T10:00:00Z', cancelled_by: 'TW' } } as unknown as Order)).toBe(
      'Anulowano 2026-11-20 przez TW',
    )
    expect(cancelledReason(manual)).toBe('')
  })

  it('adres odbiorcy i daty Optimy', () => {
    expect(recipientAddress({ name: 'Jan Kowalski', street: 'Długa 1', post_code: '43-300', city: 'Bielsko-Biała' })).toBe(
      'Jan Kowalski, Długa 1, 43-300 Bielsko-Biała',
    )
    expect(recipientAddress(null)).toBe('')
    expect(formatOptimaDateTime('2026-11-20T07:37:56')).toBe('20.11.2026 07:37')
    expect(formatOptimaDateTime('2026-11-20')).toBe('20.11.2026')
    expect(formatOptimaDateTime(null)).toBe('—')
  })

  it('uprawnienia do powiązań jak polityka ocm_write (magazynier tak, kierownik działu nie)', () => {
    expect(canMapOptimaCodes('magazynier')).toBe(true)
    expect(canMapOptimaCodes('kierownik_magazynu')).toBe(true)
    expect(canMapOptimaCodes('kierownik_dzialu')).toBe(false)
    expect(canMapOptimaCodes('sprzedawca')).toBe(false)
    expect(canMapOptimaCodes(undefined)).toBe(false)
  })

  it('błędy synchronizacji z last_result.bledy', () => {
    expect(syncErrors({ baza: 'KR', last_u_date: null, last_run_at: null, last_result: { bledy: ['RO 5: brak kodu', ''] } })).toEqual(['RO 5: brak kodu'])
    expect(syncErrors({ baza: 'MR', last_u_date: null, last_run_at: null, last_result: null })).toEqual([])
  })
})

describe('filtry listy drzwi wewnętrznych', () => {
  const none = { unmapped: 0, wings: 0, frames: 0 }
  it('źródło, baza, bez komponentu', () => {
    const f = INT_DOOR_FILTER_DEFAULT
    expect(isIntDoorFilterActive(f)).toBe(false)
    expect(matchesIntDoorFilter(manual, f, none)).toBe(true)
    expect(matchesIntDoorFilter(manual, { ...f, zrodlo: 'optima' }, none)).toBe(false)
    expect(matchesIntDoorFilter(ro('KR:1'), { ...f, zrodlo: 'manual' }, none)).toBe(false)
    expect(matchesIntDoorFilter(ro('KR:1'), { ...f, baza: 'MR' }, none)).toBe(false)
    expect(matchesIntDoorFilter(ro('MR:1'), { ...f, baza: 'MR' }, none)).toBe(true)
    expect(matchesIntDoorFilter(manual, { ...f, baza: 'KR' }, none)).toBe(false)
    expect(matchesIntDoorFilter(ro('KR:1'), { ...f, bezKomponentu: true }, none)).toBe(false)
    expect(matchesIntDoorFilter(ro('KR:1'), { ...f, bezKomponentu: true }, { ...none, unmapped: 2 })).toBe(true)
  })

  it('zawiera: skrzydła (RO — z orders.quantity) / tylko ościeżnice', () => {
    const f = { ...INT_DOOR_FILTER_DEFAULT, zawartosc: 'wings' as const }
    const g = { ...INT_DOOR_FILTER_DEFAULT, zawartosc: 'frames_only' as const }
    expect(isIntDoorFilterActive(f)).toBe(true)
    const ro4 = ro('KR:679231', { quantity: 4 })
    const roFrames = ro('KR:2', { quantity: 0 })
    expect(matchesIntDoorFilter(ro4, f, { ...none, frames: 7 })).toBe(true)
    expect(matchesIntDoorFilter(ro4, g, { ...none, frames: 7 })).toBe(false)
    expect(matchesIntDoorFilter(roFrames, f, { ...none, frames: 2 })).toBe(false)
    expect(matchesIntDoorFilter(roFrames, g, { ...none, frames: 2 })).toBe(true)
    expect(matchesIntDoorFilter(roFrames, g, none)).toBe(false)
    // ręczne: skrzydła z pozycji
    expect(matchesIntDoorFilter(manual, f, { ...none, wings: 1 })).toBe(true)
    expect(wingCount(ro4, { ...none, wings: 99 })).toBe(4)
    expect(wingCount(manual, { ...none, wings: 3 })).toBe(3)
  })
})

describe('stan RO w Optimie', () => {
  const st = (state: unknown) => ({ source: 'optima_ro', source_metadata: { optima_key: 'KR:1', state } }) as unknown as Order
  it('3 = zrealizowane, 4 = zamknięte, 0–2 otwarte; ręczne nie mają stanu', () => {
    expect(optimaState(st(3))).toBe(3)
    expect(isOptimaClosed(st(3))).toBe(true)
    expect(isOptimaClosed(st(4))).toBe(true)
    expect(isOptimaClosed(st(0))).toBe(false)
    expect(isOptimaClosed(st(2))).toBe(false)
    expect(isOptimaClosed(st(null))).toBe(false)
    expect(isOptimaClosed(manual)).toBe(false)
    expect(optimaClosedLabel(st(3))).toBe('Zrealizowane w Optimie')
    expect(optimaClosedLabel(st(4))).toBe('Zamknięte w Optimie')
    expect(optimaClosedLabel(st(1))).toBeNull()
    // PostgREST ->> oddaje tekst
    expect(isOptimaClosed(st('3'))).toBe(true)
  })
  it('lista domyślnie bez zamkniętych; „Pokaż zrealizowane” je pokazuje', () => {
    const none = { unmapped: 0, wings: 0, frames: 0 }
    expect(matchesIntDoorFilter(st(3), INT_DOOR_FILTER_DEFAULT, none)).toBe(false)
    expect(matchesIntDoorFilter(st(0), INT_DOOR_FILTER_DEFAULT, none)).toBe(true)
    expect(matchesIntDoorFilter(st(3), { ...INT_DOOR_FILTER_DEFAULT, zamkniete: true }, none)).toBe(true)
    expect(matchesIntDoorFilter(manual, INT_DOOR_FILTER_DEFAULT, none)).toBe(true)
  })
})

describe('pozycje wg typu (ZLEC/1861/11/2026)', () => {
  const its = [
    item({ item_type: 'door_wing', quantity: 1, unit: 'szt', component_id: 597 }),
    item({ item_type: 'door_frame', quantity: 1, unit: 'szt', component_id: 593 }),
    item({ item_type: 'door_frame', quantity: 1, unit: 'szt', component_id: 862 }),
    item({ item_type: 'door_wing', quantity: 3, unit: 'szt', component_id: 863 }),
    item({ item_type: 'door_frame', quantity: 3, unit: 'szt', component_id: 864 }),
    item({ item_type: 'door_frame', quantity: 3, unit: 'szt', component_id: 594 }),
    item({ item_type: 'door_frame', quantity: 4, unit: 'kpl', component_id: 865 }),
    item({ item_type: 'door_handle', quantity: 4, unit: 'szt', component_id: 779 }),
    item({ item_type: 'door_handle', quantity: 3, unit: 'szt', component_id: 547 }),
    item({ item_type: 'door_handle', quantity: 1, unit: 'szt', component_id: 548 }),
  ]
  it('grupy w stałej kolejności z sumą sztuk (listwy w kpl osobno)', () => {
    const g = groupItemsByType(its)
    expect(g.map((x) => [x.label, x.items.length, x.total])).toEqual([
      ['Skrzydła', 2, '4 szt.'],
      ['Ościeżnice i opaski', 5, '8 szt. · 4 kpl'],
      ['Klamki', 3, '8 szt.'],
    ])
    expect(summarizeItems(its)).toEqual({ unmapped: 0, wings: 4, frames: 12 })
  })
  it('ręczne bez item_type — typ z kategorii komponentu, nieznany → Pozostałe', () => {
    const g = groupItemsByType([item({ component_category: 'door_hinge_cover', quantity: 2 }), item({ quantity: 1, unit: 'szt.' })])
    expect(g.map((x) => [x.label, x.total])).toEqual([['Osłonki', '2 szt.'], ['Pozostałe', '1 szt.']])
    expect(qtyByUnit([])).toBe('')
  })
  it('komplet przesuwny (ZLEC 29235): SYSTEM PRZESUWNY stoi pod swoim skrzydłem, nie w Akcesoriach, i nie wlicza się do sumy skrzydeł', () => {
    const maleo = item({ id: 54886, optima_element_id: 3492258, item_type: 'door_wing', optima_code: 'MALEO 06 BIAŁY 80 Z SYSTEMEM PRZESUWNYM', component_id: 3391, notes: 'skrzydło przesuwne, prowadnica' })
    const system = item({ id: 55044, optima_element_id: 3492258, item_type: 'door_accessory', optima_code: 'SYSTEM PRZESUWNY', component_id: 3386, notes: 'Część kompletu MALEO 06 BIAŁY 80 Z SYSTEMEM PRZESUWNYM' })
    const prato = item({ id: 54881, optima_element_id: 3492253, item_type: 'door_wing', component_id: 952 })
    const g = groupItemsByType([prato, system, maleo])
    expect(g.map((x) => [x.label, x.items.map((i) => i.id), x.total])).toEqual([['Skrzydła', [54881, 54886, 55044], '2 szt.']])
    expect(isKitPart(system)).toBe(true)
    expect(isKitPart(maleo)).toBe(false)
    expect(kitCodeOf(system)).toBe('MALEO 06 BIAŁY 80 Z SYSTEMEM PRZESUWNYM')
    // część bez pozycji z RO (osierocona) — zostaje w grupie swojego typu
    expect(groupItemsByType([system]).map((x) => x.label)).toEqual(['Akcesoria'])
    // zwykłe uwagi z RO to nie część kompletu
    expect(isKitPart(item({ optima_element_id: 1, notes: 'Część zamówienia klienta' }))).toBe(false)
  })
  it('trwa synchronizacja, gdy running_until > teraz', () => {
    const now = Date.parse('2026-11-26T12:00:00Z')
    expect(isSyncRunning({ running_until: '2026-11-26T12:01:00Z' }, now)).toBe(true)
    expect(isSyncRunning({ running_until: '2026-11-26T11:59:00Z' }, now)).toBe(false)
    expect(isSyncRunning({ running_until: null }, now)).toBe(false)
  })
})

describe('kody bez komponentu', () => {
  it('pozycje bez komponentu i grupowanie po kodzie (wystąpienia, zlecenia, przykładowa nazwa)', () => {
    const rows = [
      item({ order_id: 1, optima_code: 'DW-VER-80L', optima_name: 'Verona 80 L biały', optima_group: 'Skrzydła' }),
      item({ order_id: 2, optima_code: 'DW-VER-80L', optima_name: 'Verona 80 L biały' }),
      item({ order_id: 2, optima_code: 'DW-VER-80L' }),
      item({ order_id: 3, optima_code: 'KL-01', optima_name: 'Klamka' }),
      item({ order_id: 3, optima_code: '  ' }),
      item({ order_id: 4, optima_code: 'OS-1', component_id: 7 }),
    ]
    expect(unmappedItems(rows)).toHaveLength(5)
    const g = groupUnmappedCodes(unmappedItems(rows))
    expect(g).toEqual([
      { code: 'DW-VER-80L', count: 3, orders: 2, sampleName: 'Verona 80 L biały', group: 'Skrzydła' },
      { code: 'KL-01', count: 1, orders: 1, sampleName: 'Klamka', group: '' },
    ])
  })
})

describe('wyszukiwarka komponentów', () => {
  const c = (id: number, p: Partial<WarehouseComponent>) =>
    ({ id, code: null, name: '', unit: 'szt', is_active: true, product_category: 'door_wing', ...p }) as WarehouseComponent
  const list = [
    c(1, { name: 'Skrzydło', code: 'SKR-VER-80', door_model: 'Verona', door_size: '80', door_direction: 'L', door_color: 'Biały' }),
    c(2, { name: 'Klamka Łuk', code: 'KL-LUK', product_category: 'door_handle', door_color: 'Czarna' }),
    c(3, { name: 'Wkręt', product_category: 'raw' }),
    c(4, { name: 'Stare skrzydło Verona', is_active: false }),
  ]
  it('każde słowo musi pasować, bez ogonków, tylko aktywne, surowce na końcu', () => {
    expect(searchComponents(list, 'verona 80').map((x) => x.id)).toEqual([1])
    expect(searchComponents(list, 'luk').map((x) => x.id)).toEqual([2])
    expect(searchComponents(list, 'skr-ver').map((x) => x.id)).toEqual([1])
    expect(searchComponents(list, '').map((x) => x.id)).toEqual([2, 1, 3])
  })
})
