// =====================================================================
// Regresja zwiadu #3: E5 (pakowanie) nie może wisieć jako "Czeka na
// poprzedni etap" dla par Disting Plus, Titanów i zamówień bez szklanych
// dodatków + jedno kryterium "ma szklany dodatek" dla tabeli i stanowiska.
// =====================================================================
import { describe, expect, it } from 'vitest'
import { buildTasks } from '../lib/stationLogic'
import { hasGlassExtra, isE22StageLockedNoAddons, splitWxH } from '../utils'
import type { Order, WorkerStage } from '../types'

const ws = (category: string, stage_key: string): WorkerStage =>
  ({ id: 1, worker_id: 'w', category, stage_key } as unknown as WorkerStage)

const order = (patch: Partial<Order>): Order =>
  ({
    id: 1,
    order_number: '100',
    category: 'STA',
    sequence: '',
    order_date: '2026-10-01',
    production_stages: {},
    extra_fields: null,
    linked_order_id: null,
    ...patch,
  }) as unknown as Order

const taskFor = (o: Order, category: string, key: string) =>
  buildTasks([o], [ws(category, key)]).find((t) => t.actualStageKey === key)

describe('E5 gotowe do pracy (pakowanie nie może wisieć wiecznie)', () => {
  it('zwykłe STA bez szklanych dodatków: e5 gotowe po e2_1 i e4 (e2_2 nie istnieje)', () => {
    const o = order({ production_stages: { e1: 'T', e2_1: 'AB', e3: 'T', e4: 'CD' } })
    expect(taskFor(o, 'STA', 'e5')?.readyToWork).toBe(true)
  })

  it('zwykłe STA ze szklanym dodatkiem: e5 czeka na e2_2', () => {
    const o = order({
      top_light: '900×400',
      production_stages: { e1: 'T', e2_1: 'AB', e3: 'T', e4: 'CD' },
    })
    expect(taskFor(o, 'STA', 'e5')?.readyToWork).toBe(false)
  })

  it('para Disting Plus (STA): e1/e2_1/e2_2 robi Disting — e5 gotowe po własnym e4', () => {
    const o = order({ linked_order_id: 77, production_stages: { e3: 'T', e4: 'CD' } })
    expect(taskFor(o, 'STA', 'e5')?.readyToWork).toBe(true)
  })

  it('Titan (STA z titan_group): e2_1 robi ST, e4 Bastion — e5 gotowe po własnym e3', () => {
    const o = order({
      extra_fields: { titan_group: 10, titan_role: 'STA' },
      production_stages: { e3: 'T' },
    })
    expect(taskFor(o, 'STA', 'e5')?.readyToWork).toBe(true)
  })

  it('Titan (STA): e5 NIE jest gotowe przed własnym e3', () => {
    const o = order({
      extra_fields: { titan_group: 10, titan_role: 'STA' },
      production_stages: {},
    })
    expect(taskFor(o, 'STA', 'e5')?.readyToWork).toBe(false)
  })

  it('para Disting Plus (Disting): e5 gotowe po własnych e2_1 (e3/e4 robi STA)', () => {
    const o = order({
      category: 'Disting',
      linked_order_id: 55,
      production_stages: { e1: 'T', e2_1: 'AB' },
    })
    expect(taskFor(o, 'Disting', 'e5')?.readyToWork).toBe(true)
  })
})

describe('jedno kryterium "ma szklany dodatek" (tabela = stanowisko)', () => {
  it('dostawka A liczy się jako dodatek w OBU miejscach', () => {
    const o = order({ side_panel_a: '400×2080' })
    expect(hasGlassExtra(o)).toBe(true)
    expect(isE22StageLockedNoAddons(o)).toBe(false)
  })
  it('brak dodatków / "NIE" / "-" = e2_2 zablokowane w obu miejscach', () => {
    for (const v of ['', 'NIE', '-']) {
      const o = order({ top_light: v, side_panel: v, side_panel_a: v, side_panel_b: v })
      expect(hasGlassExtra(o)).toBe(false)
      expect(isE22StageLockedNoAddons(o)).toBe(true)
    }
  })
})

describe('splitWxH — jeden parser wymiarów dla szklarza i widoków', () => {
  it.each([
    ['900×400', '900', '400'],
    ['900x400', '900', '400'],
    ['900 x 400', '900', '400'],
    ['900*400', '900', '400'],
    ['900X400', '900', '400'],
  ])('%s → %s × %s', (raw, w, h) => {
    const p = splitWxH(raw)
    expect(p.w).toBe(w)
    expect(p.h).toBe(h)
  })
})
