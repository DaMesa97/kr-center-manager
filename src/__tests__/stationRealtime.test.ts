import { describe, expect, it } from 'vitest'
import { mergeStationOrderEvent, stationEventNeedsRefetch } from '../lib/stationLogic'
import { markLocalStageWrite } from '../lib/stageWrites'
import type { Order } from '../types'

const order = (o: Record<string, unknown>): Order => o as unknown as Order
const scope = new Set(['STA'])

describe('mergeStationOrderEvent — realtime stanowiska bez pełnego refetchu', () => {
  it('UPDATE znanego zlecenia podmienia wiersz, zachowując kolumny pominięte w zdarzeniu', () => {
    const prev = [order({ id: 1, category: 'STA', notes: 'stare', model: 'X', production_stages: {} })]
    const next = mergeStationOrderEvent(
      prev,
      { eventType: 'UPDATE', row: { id: 1, category: 'STA', notes: 'nowe', production_stages: { e1: 'MK' } }, oldRow: null },
      scope,
    )
    expect(next[0].notes).toBe('nowe')
    expect(next[0].model).toBe('X')
    expect((next[0].production_stages as Record<string, string>).e1).toBe('MK')
  })

  it('wydane / anulowane zlecenie z naszej kategorii znika z listy', () => {
    const prev = [order({ id: 1, category: 'STA' }), order({ id: 2, category: 'STA' })]
    const released = mergeStationOrderEvent(
      prev,
      { eventType: 'UPDATE', row: { id: 1, category: 'STA', release_date: '2026-10-21' }, oldRow: null },
      scope,
    )
    expect(released.map((o) => o.id)).toEqual([2])
    const cancelled = mergeStationOrderEvent(
      prev,
      { eventType: 'UPDATE', row: { id: 2, category: 'STA', extra_fields: { cancelled: true } }, oldRow: null },
      scope,
    )
    expect(cancelled.map((o) => o.id)).toEqual([1])
  })

  it('partner spoza scope zostaje po wydaniu (blokady etapów Titana)', () => {
    const prev = [order({ id: 1, category: 'STA', linked_order_id: 2 }), order({ id: 2, category: 'ST' })]
    const next = mergeStationOrderEvent(
      prev,
      { eventType: 'UPDATE', row: { id: 2, category: 'ST', release_date: '2026-10-21' }, oldRow: null },
      scope,
    )
    expect(next.map((o) => o.id)).toEqual([1, 2])
  })

  it('nowe otwarte zlecenie z naszej kategorii jest dodawane, obce ignorowane', () => {
    const prev = [order({ id: 1, category: 'STA' })]
    const added = mergeStationOrderEvent(prev, { eventType: 'INSERT', row: { id: 5, category: 'STA' }, oldRow: null }, scope)
    expect(added.map((o) => o.id)).toEqual([5, 1])
    const foreign = mergeStationOrderEvent(prev, { eventType: 'INSERT', row: { id: 6, category: 'Bastion' }, oldRow: null }, scope)
    expect(foreign).toBe(prev)
  })

  it('DELETE usuwa po id ze starego rekordu', () => {
    const prev = [order({ id: 1, category: 'STA' }), order({ id: 2, category: 'STA' })]
    const next = mergeStationOrderEvent(prev, { eventType: 'DELETE', row: null, oldRow: { id: 1 } }, scope)
    expect(next.map((o) => o.id)).toEqual([2])
  })

  it('świeży lokalny zapis etapu nie jest kasowany starym stanem z realtime', () => {
    markLocalStageWrite(10, 'e3')
    const prev = [order({ id: 10, category: 'STA', production_stages: { e3: 'MK' } })]
    const next = mergeStationOrderEvent(
      prev,
      { eventType: 'UPDATE', row: { id: 10, category: 'STA', production_stages: { e3: '' } }, oldRow: null },
      scope,
    )
    expect((next[0].production_stages as Record<string, string>).e3).toBe('MK')
  })
})

describe('stationEventNeedsRefetch', () => {
  it('true tylko dla otwartego zlecenia łączonego z naszej kategorii bez partnera na liście', () => {
    const prev = [order({ id: 1, category: 'STA' })]
    const ev = (row: Record<string, unknown>) => ({ eventType: 'INSERT', row: row as Partial<Order>, oldRow: null })
    expect(stationEventNeedsRefetch(prev, ev({ id: 5, category: 'STA', linked_order_id: 9 }), scope)).toBe(true)
    expect(stationEventNeedsRefetch(prev, ev({ id: 5, category: 'STA', linked_order_id: 1 }), scope)).toBe(false)
    expect(stationEventNeedsRefetch(prev, ev({ id: 5, category: 'STA' }), scope)).toBe(false)
    expect(stationEventNeedsRefetch(prev, ev({ id: 5, category: 'Bastion', linked_order_id: 9 }), scope)).toBe(false)
  })
})
