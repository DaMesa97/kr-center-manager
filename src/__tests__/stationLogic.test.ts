import { describe, expect, it } from 'vitest'
import { buildTasks, isStageReady } from '../lib/stationLogic'
import { STA_DISTING_STAGE_DEFS } from '../constants'
import type { Order, WorkerStage } from '../types'

// „Moje stanowisko" — zadania pracownika, zależności etapów, blokady dla zleceń
// łączonych (Disting Plus / Titan). Zgodnie z Pomocą i architekturą.

const order = (o: Record<string, unknown>): Order => o as unknown as Order
const ws = (category: string, stage_key: string): WorkerStage =>
  ({ id: 1, worker_id: 'u1', category, stage_key, created_at: '', created_by: null }) as WorkerStage

const staOrder = (stages: Record<string, string>, extra: Record<string, unknown> = {}) =>
  order({ id: 1, category: 'STA', order_number: '100', production_stages: stages, ...extra })

describe('isStageReady — graf zależności (produkcja równoległa, nie liniowa)', () => {
  const defs = STA_DISTING_STAGE_DEFS
  it('etapy startowe zawsze gotowe (e1, e2_2, e3)', () => {
    expect(isStageReady('STA', 'e1', {}, defs)).toBe(true)
    expect(isStageReady('STA', 'e3', {}, defs)).toBe(true)
  })
  it('e2_1 wymaga e1; e4 wymaga e3', () => {
    expect(isStageReady('STA', 'e2_1', { e1: '' }, defs)).toBe(false)
    expect(isStageReady('STA', 'e2_1', { e1: 'TW' }, defs)).toBe(true)
    expect(isStageReady('STA', 'e4', { e3: '' }, defs)).toBe(false)
    expect(isStageReady('STA', 'e4', { e3: 'XY' }, defs)).toBe(true)
  })
  it('e5 (pakowanie) wymaga e2_1 + e2_2 + e4', () => {
    expect(isStageReady('STA', 'e5', { e2_1: 'A', e2_2: 'B', e4: '' }, defs)).toBe(false)
    expect(isStageReady('STA', 'e5', { e2_1: 'A', e2_2: 'B', e4: 'C' }, defs)).toBe(true)
  })
  it('„zrobione" = niepuste (inicjały), nie tylko literka T', () => {
    expect(isStageReady('STA', 'e2_1', { e1: 'MK' }, defs)).toBe(true)
  })
  it('Bastion — zawsze klikalny (decyzja: bez wymuszania kolejności)', () => {
    expect(isStageReady('Bastion', 'tit_pak', {}, [])).toBe(true)
  })
})

describe('buildTasks — zadania pracownika', () => {
  it('pokazuje tylko niezrobione etapy z przypisanych', () => {
    const tasks = buildTasks(
      [staOrder({ e1: 'TW', e3: '' })],
      [ws('STA', 'e1'), ws('STA', 'e3')],
    )
    expect(tasks.map((t) => t.actualStageKey)).toEqual(['e3'])
  })

  it('Disting Plus STA — etapy ościeżnicy (e1/e2_1/e2_2) robione po stronie Disting → brak zadań', () => {
    const linked = staOrder({ e1: '', e3: '' }, { linked_order_id: 55 })
    const tasks = buildTasks([linked], [ws('STA', 'e1'), ws('STA', 'e3')])
    expect(tasks.map((t) => t.actualStageKey)).toEqual(['e3'])
  })

  it('Titan STA — e1/e2_1/e4 zablokowane (ST/Bastion), zostaje skrzydło (e3)', () => {
    const titan = staOrder({ e1: '', e3: '', e4: '' }, { extra_fields: { titan_group: 1 } })
    const tasks = buildTasks([titan], [ws('STA', 'e1'), ws('STA', 'e3'), ws('STA', 'e4')])
    expect(tasks.map((t) => t.actualStageKey)).toEqual(['e3'])
  })

  it('Titan Bastion — standardowe etapy (ościeżnica, CNC…) NIE są zadaniami; zostają tit_* (zgłoszenie Mariusza)', () => {
    const titanBastion = order({
      id: 9,
      category: 'Bastion',
      order_number: '900',
      production_stages: {},
      extra_fields: { titan_group: 7 },
    })
    // pracownik od składania ościeżnic + od okuwania Titana
    const tasks = buildTasks(
      [titanBastion],
      [ws('Bastion', 'oscieznica_skrecanie'), ws('Bastion', 'oscieznica_cnc'), ws('Bastion', 'tit_oku')],
    )
    expect(tasks.map((t) => t.actualStageKey)).toEqual(['tit_oku'])
  })

  it('zwykły Bastion — etapy ościeżnicy działają normalnie', () => {
    const bastion = order({
      id: 10,
      category: 'Bastion',
      order_number: '901',
      production_stages: {},
      extra_fields: {},
    })
    const tasks = buildTasks([bastion], [ws('Bastion', 'oscieznica_skrecanie'), ws('Bastion', 'tit_oku')])
    expect(tasks.map((t) => t.actualStageKey)).toEqual(['oscieznica_skrecanie'])
  })

  it('Titan ST — tylko ościeżnica (e1); e2/e3/e4 robią inni', () => {
    const stTitan = order({
      id: 2, category: 'ST', order_number: '7', system: 'CORE',
      linked_order_id: 9, production_stages: { e1: '', e2: '', e3: '', e4: '' },
    })
    const tasks = buildTasks(
      [stTitan],
      [ws('ST', 'titan_e1'), ws('ST', 'titan_e2'), ws('ST', 'titan_e4')],
    )
    expect(tasks.map((t) => t.actualStageKey)).toEqual(['e1'])
  })

  it('e2_2 (szklenie dostawki/naświetla) pomijane, gdy zlecenie nie ma szklonych dodatków', () => {
    const noGlass = staOrder({ e2_2: '' })
    const withGlass = staOrder({ e2_2: '' }, { id: 3, side_panel_a: '370×2080' })
    expect(buildTasks([noGlass], [ws('STA', 'e2_2')])).toHaveLength(0)
    expect(buildTasks([withGlass], [ws('STA', 'e2_2')])).toHaveLength(1)
  })

  it('sortowanie: najpierw gotowe do pracy', () => {
    // ten sam etap (e2_1) na dwóch zleceniach: jedno ma zrobione e1 (gotowe), drugie nie (czeka)
    const ready = staOrder({ e1: 'TW', e2_1: '' }, { id: 10, order_date: '2026-07-02' })
    const waiting = staOrder({ e1: '', e2_1: '' }, { id: 11, order_date: '2026-07-01' })
    const tasks = buildTasks([waiting, ready], [ws('STA', 'e2_1')])
    expect(tasks).toHaveLength(2)
    expect(tasks[0].readyToWork).toBe(true)
    expect(tasks[0].order.id).toBe(10)
    expect(tasks[1].readyToWork).toBe(false)
  })
})
