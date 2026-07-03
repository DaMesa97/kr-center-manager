import { describe, expect, it } from 'vitest'
import {
  countCompletedStages,
  getOrderAgeStatus,
  isStaTitanLinked,
  normalizeProfileDepartment,
  stStageCellKind,
} from '../utils'
import { LABEL_FIELDS } from '../lib/labelRender'
import { ST_TITAN_STAGE_DEFS } from '../constants'
import type { LeadTimeRule, Order } from '../types'

const order = (o: Record<string, unknown>): Order => o as unknown as Order
const daysAgo = (n: number): string => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

describe('stStageCellKind — kolumny etapów w tabeli ST', () => {
  it('tryb titan: klikalny tylko E1 (ościeżnica), reszta wyłączona', () => {
    const defs = ST_TITAN_STAGE_DEFS
    expect(stStageCellKind(defs[0], true, 'titan')).toMatchObject({ kind: 'click', stageKey: 'e1' })
    expect(stStageCellKind(defs[1], true, 'titan')).toMatchObject({ kind: 'none' })
    expect(stStageCellKind(defs[3], true, 'titan')).toMatchObject({ kind: 'none' })
  })
})

describe('isStaTitanLinked — STA połączone z partnerem ST', () => {
  it('true gdy partner ma kategorię ST; false dla partnera Disting', () => {
    const sta = order({ id: 1, category: 'STA', linked_order_id: 2 })
    const stPartner = order({ id: 2, category: 'ST' })
    const distingPartner = order({ id: 2, category: 'Disting' })
    expect(isStaTitanLinked(sta, [sta, stPartner])).toBe(true)
    expect(isStaTitanLinked(sta, [sta, distingPartner])).toBe(false)
    expect(isStaTitanLinked(order({ id: 3, category: 'STA' }), [])).toBe(false)
  })
})

describe('countCompletedStages — Bastion standard vs Titan (bug „0/7 vs /9")', () => {
  it('Bastion standardowy liczy pełny zestaw etapów', () => {
    const res = countCompletedStages(order({ category: 'Bastion', production_stages: { cnc: 'TW' } }))
    expect(res.total).toBe(9)
    expect(res.completed).toBe(1)
  })
  it('Bastion Titan (titan_group) liczy tylko 3 etapy Titana', () => {
    const res = countCompletedStages(
      order({
        category: 'Bastion',
        extra_fields: { titan_group: 7 },
        production_stages: { tit_oku: 'AB', tit_mon: '', tit_pak: '' },
      }),
    )
    expect(res.total).toBe(3)
    expect(res.completed).toBe(1)
  })
  it('STA bez szklonych dodatków: e2_2 zaliczone automatycznie (nie blokuje 100%)', () => {
    const res = countCompletedStages(
      order({
        category: 'STA',
        production_stages: { e1: 'A', e2_1: 'B', e2_2: '', e3: 'C', e4: 'D', e5: 'E' },
      }),
    )
    expect(res.percent).toBe(100)
  })
})

describe('getOrderAgeStatus — zaległości (Wysyłka)', () => {
  const rules: LeadTimeRule[] = []
  it('domyślnie: 7 dni = warning, 14 dni = overdue', () => {
    expect(getOrderAgeStatus(order({ order_date: daysAgo(2) }), rules)).toBe('ok')
    expect(getOrderAgeStatus(order({ order_date: daysAgo(8) }), rules)).toBe('warning')
    expect(getOrderAgeStatus(order({ order_date: daysAgo(20) }), rules)).toBe('overdue')
  })
  it('wydane i anulowane nigdy nie są zaległe', () => {
    expect(getOrderAgeStatus(order({ order_date: daysAgo(30), release_date: '2026-07-01' }), rules)).toBe('ok')
    expect(getOrderAgeStatus(order({ order_date: daysAgo(30), extra_fields: { cancelled: true } }), rules)).toBe('ok')
  })
  it('reguła per kategoria nadpisuje progi', () => {
    const custom = [
      { id: 1, is_active: true, priority: 10, match_category: 'Bastion', match_has_glass_extra: null, match_bastion_frame_type: null, warning_days: 3, overdue_days: 5 },
    ] as unknown as LeadTimeRule[]
    expect(getOrderAgeStatus(order({ category: 'Bastion', order_date: daysAgo(4) }), custom)).toBe('warning')
    expect(getOrderAgeStatus(order({ category: 'STA', order_date: daysAgo(4) }), custom)).toBe('ok')
  })
})

describe('normalizeProfileDepartment / LABEL_FIELDS — sanity', () => {
  it('manager zawsze widzi wszystko; śmieciowy dział → all', () => {
    expect(normalizeProfileDepartment('manager', 'bastion')).toBe('all')
    expect(normalizeProfileDepartment('worker', 'bastion')).toBe('bastion')
    expect(normalizeProfileDepartment('worker', 'xyz')).toBe('all')
  })
  it('pola etykiet: unikalne klucze, żadne nie wybucha na pustym zleceniu', () => {
    const keys = LABEL_FIELDS.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
    const empty = order({})
    for (const f of LABEL_FIELDS) {
      expect(() => f.value(empty), `pole ${f.key}`).not.toThrow()
    }
  })
})
