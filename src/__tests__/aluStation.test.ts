import { describe, expect, it } from 'vitest'
import { aluCanUndo, aluReadyCount, buildAluTasks, mergeAluPositionEvent } from '../lib/aluStation'
import type { AluPosition, Order, WorkerStage } from '../types'

const order = (o: Record<string, unknown>): Order => o as unknown as Order
const pos = (p: Record<string, unknown>): AluPosition =>
  ({ id: 1, order_id: 10, pos_no: 1, description: 'drzwi', construction_type: 'drzwi', system: 'AS75', profile_color: '', hardware_color: '', fillings: '', width_mm: 1000, height_mm: 2000, quantity: 3, weight_kg: null, u_value: null, notes: {}, glass: [], production_stages: {}, created_at: '', ...p }) as AluPosition
const ws = (keys: string[]): WorkerStage[] => keys.map((k, i) => ({ id: i, worker_id: 'w', category: 'Aluminium', stage_key: k }) as unknown as WorkerStage)

describe('aluStation — przepływ sztukowy', () => {
  it('readyCount: pierwszy etap do ilości, kolejne tylko tyle, ile przepuścił poprzedni', () => {
    const st = { ciecie: { done: 2, marks: [] }, okuwanie: { done: 1, marks: [] } }
    expect(aluReadyCount(st, 'ciecie', 3)).toBe(1)
    expect(aluReadyCount(st, 'okuwanie', 3)).toBe(1)
    expect(aluReadyCount(st, 'skladanie', 3)).toBe(1)
    expect(aluReadyCount(st, 'szklenie', 3)).toBe(0)
    expect(aluReadyCount({}, 'okuwanie', 3)).toBe(0)
  })

  it('cofnięcie tylko gdy następny etap nie zużył sztuki', () => {
    const st = { ciecie: { done: 2, marks: [] }, okuwanie: { done: 2, marks: [] } }
    expect(aluCanUndo(st, 'ciecie', 3)).toBe(false)
    expect(aluCanUndo(st, 'okuwanie', 3)).toBe(true)
    expect(aluCanUndo(st, 'skladanie', 3)).toBe(false)
  })

  it('buildAluTasks: tylko przypisane etapy, otwarte zlecenia, niedokończone pozycje; sort po terminie', () => {
    const o1 = order({ id: 10, category: 'Aluminium', order_number: 'OF2/2026', extra_fields: { alu: { deadline: '2026-12-01' } } })
    const o2 = order({ id: 11, category: 'Aluminium', order_number: 'OF1/2026', extra_fields: { alu: { deadline: '2026-11-01' } } })
    const released = order({ id: 12, category: 'Aluminium', order_number: 'OF3/2026', release_date: '2026-10-01' })
    const byOrder = {
      10: [pos({ id: 1, order_id: 10 }), pos({ id: 2, order_id: 10, pos_no: 2, quantity: 1, production_stages: { ciecie: { done: 1, marks: ['T'] } } })],
      11: [pos({ id: 3, order_id: 11 })],
      12: [pos({ id: 4, order_id: 12 })],
    }
    const tasks = buildAluTasks([o1, o2, released], byOrder, ws(['ciecie']))
    expect(tasks.map((t) => `${t.order.order_number}#${t.alu?.posNo}`)).toEqual(['OF1/2026#1', 'OF2/2026#1'])
    expect(tasks[0].readyToWork).toBe(true)
    expect(tasks[0].alu?.readyCount).toBe(3)
    expect(buildAluTasks([o1], byOrder, ws(['e1']))).toEqual([])
    const okuwanie = buildAluTasks([o1], byOrder, ws(['okuwanie']))
    expect(okuwanie.map((t) => [t.alu?.posNo, t.readyToWork])).toEqual([[1, false], [2, true]])
  })

  it('mergeAluPositionEvent scala UPDATE i ignoruje obce zlecenia', () => {
    const byOrder = { 10: [pos({ id: 1, order_id: 10 })] }
    const upd = mergeAluPositionEvent(byOrder, 'UPDATE', { id: 1, order_id: 10, production_stages: { ciecie: { done: 1, marks: ['MK'] } } }, null)
    expect(upd[10][0].production_stages.ciecie?.done).toBe(1)
    expect(mergeAluPositionEvent(byOrder, 'UPDATE', { id: 9, order_id: 99 }, null)).toBe(byOrder)
    expect(mergeAluPositionEvent(byOrder, 'DELETE', null, { id: 1 })[10]).toEqual([])
  })
})
