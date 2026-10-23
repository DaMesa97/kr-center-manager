import { describe, expect, it } from 'vitest'
import { aluLoadingDate, aluOrderProgress, aluPositionProgress, aluStageComplete, aluStageDone, defaultAluDeadline, formatAluGlass, isWeekendYmd, summarizeAluTypes } from '../lib/alu'
import { ALU_CONSTRUCTION_LABELS } from '../constants'
import { ALU_MONTAZ_ROUTE, getOrderRouteDay } from '../lib/companyMatch'

describe('alu — etapy per sztuka', () => {
  it('done przycięte do ilości, etap zrobiony gdy wszystkie sztuki', () => {
    const stages = { ciecie: { done: 5, marks: ['MK'] }, okuwanie: { done: 2, marks: ['MK', 'T'] } }
    expect(aluStageDone(stages, 'ciecie', 3)).toBe(3)
    expect(aluStageDone(stages, 'okuwanie', 3)).toBe(2)
    expect(aluStageDone(stages, 'szklenie', 3)).toBe(0)
    expect(aluStageComplete(stages, 'ciecie', 3)).toBe(true)
    expect(aluStageComplete(stages, 'okuwanie', 3)).toBe(false)
    expect(aluStageComplete(undefined, 'ciecie', 0)).toBe(false)
  })

  it('postęp pozycji i zlecenia liczy sztuko-etapy (5 etapów)', () => {
    const p1 = { quantity: 2, production_stages: { ciecie: { done: 2, marks: [] }, okuwanie: { done: 1, marks: [] } } }
    const p2 = { quantity: 1, production_stages: {} }
    expect(aluPositionProgress(p1)).toEqual({ done: 3, total: 10 })
    expect(aluOrderProgress([p1, p2])).toEqual({ done: 3, total: 15, percent: 20 })
    expect(aluOrderProgress([]).percent).toBe(0)
  })

  it('formatowanie szkła, typów i domyślny termin +4 tyg.', () => {
    expect(formatAluGlass([{ spec: '4/16/4 Ug=1,1', width_mm: 841, height_mm: 1022, qty: 1 }])).toBe('841×1022 ×1 (4/16/4 Ug=1,1)')
    expect(summarizeAluTypes([{ construction_type: 'drzwi', quantity: 2 }, { construction_type: 'okno', quantity: 1 }], ALU_CONSTRUCTION_LABELS)).toBe('Drzwi ×2 · Okno ×1')
    expect(defaultAluDeadline(4, new Date(2026, 9, 23))).toBe('2026-11-20')
  })

  it('weekendów nie ma: domyślny termin z soboty → poniedziałek, załadunek trasy pn = pt', () => {
    // import w sobotę 24.10 → +4 tyg. = sob. 21.11 → pn 23.11
    expect(defaultAluDeadline(4, new Date(2026, 9, 24))).toBe('2026-11-23')
    expect(isWeekendYmd('2026-11-21')).toBe(true)
    expect(isWeekendYmd('2026-11-23')).toBe(false)
    expect(aluLoadingDate('2026-11-23')).toBe('2026-11-20')
  })

  it('Wysyłka: dzień trasy alu = dzień tygodnia z terminu, montaż = osobna grupa', () => {
    const alu = (extra: Record<string, unknown>) => ({ category: 'Aluminium', notes: '', extra_fields: { alu: extra } }) as unknown as Parameters<typeof getOrderRouteDay>[0]
    expect(getOrderRouteDay(alu({ deadline: '2026-11-20', realizacja: 'wysylka' }), { production_day: '', route_day: 'ŚLĄSK' })).toBe('PIĄTEK')
    expect(getOrderRouteDay(alu({ deadline: '2026-11-23', realizacja: 'montaz' }), null)).toBe(ALU_MONTAZ_ROUTE)
    expect(getOrderRouteDay(alu({}), { production_day: '', route_day: 'ŚLĄSK' })).toBe('ŚLĄSK')
  })

  it('załadunek = dzień roboczy przed terminem (pn → pt, wt → pn)', () => {
    expect(aluLoadingDate('2026-11-20')).toBe('2026-11-19') // pt → czw
    expect(aluLoadingDate('2026-11-23')).toBe('2026-11-20') // pn → pt
    expect(aluLoadingDate('2026-11-24')).toBe('2026-11-23') // wt → pn
    expect(aluLoadingDate('')).toBe('')
  })
})
