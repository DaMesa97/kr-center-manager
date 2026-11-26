import { describe, expect, it } from 'vitest'
import type { InternalDoorItem, Order, WarehouseComponent } from '../types'
import {
  INT_DOOR_FILTER_DEFAULT,
  cancelledReason,
  canMapOptimaCodes,
  formatOptimaDateTime,
  groupUnmappedCodes,
  isIntDoorFilterActive,
  isOptimaOrder,
  matchesIntDoorFilter,
  optimaBaza,
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
  it('źródło, baza, bez komponentu', () => {
    const f = INT_DOOR_FILTER_DEFAULT
    expect(isIntDoorFilterActive(f)).toBe(false)
    expect(matchesIntDoorFilter(manual, f, 0)).toBe(true)
    expect(matchesIntDoorFilter(manual, { ...f, zrodlo: 'optima' }, 0)).toBe(false)
    expect(matchesIntDoorFilter(ro('KR:1'), { ...f, zrodlo: 'manual' }, 0)).toBe(false)
    expect(matchesIntDoorFilter(ro('KR:1'), { ...f, baza: 'MR' }, 0)).toBe(false)
    expect(matchesIntDoorFilter(ro('MR:1'), { ...f, baza: 'MR' }, 0)).toBe(true)
    expect(matchesIntDoorFilter(manual, { ...f, baza: 'KR' }, 0)).toBe(false)
    expect(matchesIntDoorFilter(ro('KR:1'), { ...f, bezKomponentu: true }, 0)).toBe(false)
    expect(matchesIntDoorFilter(ro('KR:1'), { ...f, bezKomponentu: true }, 2)).toBe(true)
  })
})

describe('kody bez komponentu', () => {
  it('pozycje bez komponentu i grupowanie po kodzie (wystąpienia, zlecenia, przykładowa nazwa)', () => {
    const rows = [
      item({ order_id: 1, optima_code: 'DW-RIV-80L', optima_name: 'Rivoli 80 L biały', optima_group: 'Skrzydła' }),
      item({ order_id: 2, optima_code: 'DW-RIV-80L', optima_name: 'Rivoli 80 L biały' }),
      item({ order_id: 2, optima_code: 'DW-RIV-80L' }),
      item({ order_id: 3, optima_code: 'KL-01', optima_name: 'Klamka' }),
      item({ order_id: 3, optima_code: '  ' }),
      item({ order_id: 4, optima_code: 'OS-1', component_id: 7 }),
    ]
    expect(unmappedItems(rows)).toHaveLength(5)
    const g = groupUnmappedCodes(unmappedItems(rows))
    expect(g).toEqual([
      { code: 'DW-RIV-80L', count: 3, orders: 2, sampleName: 'Rivoli 80 L biały', group: 'Skrzydła' },
      { code: 'KL-01', count: 1, orders: 1, sampleName: 'Klamka', group: '' },
    ])
  })
})

describe('wyszukiwarka komponentów', () => {
  const c = (id: number, p: Partial<WarehouseComponent>) =>
    ({ id, code: null, name: '', unit: 'szt', is_active: true, product_category: 'door_wing', ...p }) as WarehouseComponent
  const list = [
    c(1, { name: 'Skrzydło', code: 'SKR-RIV-80', door_model: 'Rivoli', door_size: '80', door_direction: 'L', door_color: 'Biały' }),
    c(2, { name: 'Klamka Łuk', code: 'KL-LUK', product_category: 'door_handle', door_color: 'Czarna' }),
    c(3, { name: 'Wkręt', product_category: 'raw' }),
    c(4, { name: 'Stare skrzydło Rivoli', is_active: false }),
  ]
  it('każde słowo musi pasować, bez ogonków, tylko aktywne, surowce na końcu', () => {
    expect(searchComponents(list, 'rivoli 80').map((x) => x.id)).toEqual([1])
    expect(searchComponents(list, 'luk').map((x) => x.id)).toEqual([2])
    expect(searchComponents(list, 'skr-riv').map((x) => x.id)).toEqual([1])
    expect(searchComponents(list, '').map((x) => x.id)).toEqual([2, 1, 3])
  })
})
