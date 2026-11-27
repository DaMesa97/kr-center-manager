import { describe, expect, it } from 'vitest'
import {
  blFromClientOrder,
  blOrderId,
  canEditPallets,
  clientFromClientOrder,
  commonBl,
  daySummary,
  groupByBl,
  groupByDate,
  isPendingForShipment,
  nextWorkingDay,
} from '../lib/shipments'

describe('numer BL i klient z client_order_number', () => {
  it('przed i po „/”', () => {
    expect(blFromClientOrder('57857794/GNIEWEK')).toBe('57857794')
    expect(clientFromClientOrder('57857794/GNIEWEK')).toBe('GNIEWEK')
    expect(blFromClientOrder(' 57874197 / MUSIAŁ ')).toBe('57874197')
    expect(clientFromClientOrder(' 57874197 / MUSIAŁ ')).toBe('MUSIAŁ')
  })
  it('bez „/” albo pusto', () => {
    expect(blFromClientOrder('57857794')).toBe('57857794')
    expect(clientFromClientOrder('57857794')).toBe('')
    expect(blFromClientOrder(null)).toBe('')
  })
  it('bl_order_id tylko z cyfr', () => {
    expect(blOrderId('57857794')).toBe(57857794)
    expect(blOrderId('RO/12')).toBeNull()
    expect(blOrderId('')).toBeNull()
  })
})

describe('grupowanie', () => {
  it('po BL (RACINOWSKI_1 + _2 razem), bez BL osobno', () => {
    const g = groupByBl([
      { id: 1, bl: '111' },
      { id: 2, bl: '' },
      { id: 3, bl: '111' },
      { id: 4, bl: '' },
    ])
    expect(g.map((x) => x.rows.map((r) => r.id))).toEqual([[1, 3], [2], [4]])
    expect(commonBl([{ bl: '111' }, { bl: '111' }])).toBe('111')
    expect(commonBl([{ bl: '111' }, { bl: '222' }])).toBe('')
  })
  it('po dacie rosnąco, bez daty na końcu', () => {
    const g = groupByDate([{ ship_date: '2026-12-02' }, { ship_date: null }, { ship_date: '2026-11-30' }, { ship_date: '2026-12-02' }])
    expect(g.map((x) => [x.date, x.rows.length])).toEqual([['2026-11-30', 1], ['2026-12-02', 2], [null, 1]])
  })
})

describe('najbliższy dzień roboczy', () => {
  it('piątek → poniedziałek, z dniami wolnymi', () => {
    expect(nextWorkingDay(new Date(2026, 10, 27))).toBe('2026-11-30') // pt 27.11 → pn 30.11
    expect(nextWorkingDay(new Date(2026, 10, 27), new Set(['2026-11-30']))).toBe('2026-12-01')
    expect(nextWorkingDay(new Date(2026, 10, 24))).toBe('2026-11-25')
  })
})

describe('podsumowanie dnia i statusy', () => {
  it('liczy wysyłki i palety bez anulowanych', () => {
    const s = daySummary(
      [
        { id: 1, ship_date: '2026-11-30', status: 'zaplanowana', pallets_vertical: 1, pallets_horizontal: 0 },
        { id: 2, ship_date: '2026-11-30', status: 'gotowa', pallets_vertical: 0, pallets_horizontal: 2 },
        { id: 3, ship_date: '2026-11-30', status: 'anulowana', pallets_vertical: 5, pallets_horizontal: 5 },
        { id: 4, ship_date: '2026-12-01', status: 'nadana', pallets_vertical: 3, pallets_horizontal: 0 },
      ],
      '2026-11-30',
    )
    expect(s).toEqual({ count: 2, vertical: 1, horizontal: 2 })
  })
  it('palety edytowalne do nadania', () => {
    expect(canEditPallets('zaplanowana')).toBe(true)
    expect(canEditPallets('gotowa')).toBe(true)
    expect(canEditPallets('nadana')).toBe(false)
    expect(canEditPallets('anulowana')).toBe(false)
  })
  it('zlecenie do wysyłki: nieanulowane, wydanie od dziś, nieprzypięte', () => {
    const today = '2026-11-27'
    const att = new Set([5])
    expect(isPendingForShipment({ id: 1, release_date: null }, today, att)).toBe(true)
    expect(isPendingForShipment({ id: 2, release_date: '2026-11-27' }, today, att)).toBe(true)
    expect(isPendingForShipment({ id: 3, release_date: '2026-11-26' }, today, att)).toBe(false)
    expect(isPendingForShipment({ id: 4, release_date: null, extra_fields: { cancelled: true } }, today, att)).toBe(false)
    expect(isPendingForShipment({ id: 5, release_date: null }, today, att)).toBe(false)
  })
})
