import { describe, expect, it } from 'vitest'
import { aluTaskKey, applyAluPositionStages, buildAluTasks } from '../lib/aluStation'
import { buildTasks } from '../lib/stationLogic'
import type { AluPosition, Order, WorkerStage } from '../types'

// Mobilne stanowisko składa listę z buildTasks (zwykłe kategorie) + buildAluTasks
// (aluminium). Te testy pilnują, że alu nie dubluje się i że karty mają unikalne klucze.
const order = (o: Record<string, unknown>): Order => o as unknown as Order
const pos = (p: Record<string, unknown>): AluPosition =>
  ({ id: 1, order_id: 10, pos_no: 1, description: 'drzwi', construction_type: 'drzwi', system: 'AS75', profile_color: '', hardware_color: '', fillings: '', width_mm: 1000, height_mm: 2000, quantity: 3, weight_kg: null, u_value: null, notes: {}, glass: [], production_stages: {}, created_at: '', ...p }) as AluPosition
const ws = (keys: string[]): WorkerStage[] => keys.map((k, i) => ({ id: i, worker_id: 'w', category: 'Aluminium', stage_key: k }) as unknown as WorkerStage)

describe('mobilne stanowisko — aluminium', () => {
  it('buildTasks nie tworzy zadań dla zleceń alu (etapy są na pozycjach, nie w orders.production_stages)', () => {
    const o = order({ id: 10, category: 'Aluminium', order_number: 'OF1/2026', production_stages: {} })
    expect(buildTasks([o], ws(['ciecie', 'okuwanie']))).toEqual([])
  })

  it('klucz karty alu jest unikalny per pozycja + etap w tym samym zleceniu', () => {
    const o = order({ id: 10, category: 'Aluminium', order_number: 'OF1/2026' })
    const byOrder = { 10: [pos({ id: 1, order_id: 10 }), pos({ id: 2, order_id: 10, pos_no: 2 })] }
    const tasks = buildAluTasks([o], byOrder, ws(['ciecie', 'okuwanie']))
    const keys = tasks.map(aluTaskKey)
    expect(new Set(keys).size).toBe(tasks.length)
    expect(keys).toContain('alu-1-ciecie')
    expect(keys).toContain('alu-2-okuwanie')
  })

  it('po RPC mark: scalenie production_stages zmniejsza liczbę zadań, gdy pozycja dostała wszystkie sztuki', () => {
    const o = order({ id: 10, category: 'Aluminium', order_number: 'OF1/2026' })
    const before = { 10: [pos({ id: 1, order_id: 10, quantity: 2 })] }
    expect(buildAluTasks([o], before, ws(['ciecie'])).map((t) => t.alu?.done)).toEqual([0])
    const after = applyAluPositionStages(before, 1, { ciecie: { done: 2, marks: ['MK', 'MK'] } })
    expect(buildAluTasks([o], after, ws(['ciecie']))).toEqual([])
    // pozycja spoza mapy — stan bez zmian (ta sama referencja)
    expect(applyAluPositionStages(before, 999, { ciecie: { done: 1, marks: [] } })).toBe(before)
  })
})
