import { describe, expect, it } from 'vitest'
import { ROUTE_PLAN_ENABLED } from '../constants'
import { orderRouteMark } from '../utils'
import { isTaskShownByDefault, sortTasks, type MyTask } from '../lib/stationLogic'
import type { Order } from '../types'

// Plan wydań X/XX wyłączony (Tymek 23.10: na razie tylko PILNE) — stare oznaczenia
// w danych nie mogą wpływać na kolejność ani na „zawsze widoczne” na stanowisku.
describe('plan wydań wyłączony', () => {
  const order = (mark: string, extra: Record<string, unknown> = {}) =>
    ({ order_number: 'n', order_date: '2026-10-01', extra_fields: { route_mark: mark }, ...extra }) as unknown as Order
  const task = (o: Order, ready = true) =>
    ({ readyToWork: ready, category: 'STA', stageKey: 'e3', actualStageKey: 'e3', order: o }) as unknown as MyTask

  it('przełącznik wyłączony, oznaczenia ignorowane', () => {
    expect(ROUTE_PLAN_ENABLED).toBe(false)
    expect(orderRouteMark(order('XX'))).toBe('')
  })
  it('niegotowe XX schowane, PILNE wygrywa w kolejności', () => {
    expect(isTaskShownByDefault(task(order('XX'), false))).toBe(false)
    const xx = task(order('XX'))
    const rush = task(order('', { sequence: 'X' }))
    expect(sortTasks([xx, rush])[0]).toBe(rush)
  })
})
