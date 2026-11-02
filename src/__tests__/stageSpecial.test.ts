import { describe, expect, it } from 'vitest'
import {
  holdValue,
  isStageDone,
  isStageHold,
  isStageNA,
  isStageSpecial,
  stageDisplay,
  stageHoldReason,
  stageInitials,
  stageLabel,
} from '../lib/stageSpecial'
import { buildTasks, isStageReady, missingPrereqs } from '../lib/stationLogic'
import { STA_DISTING_STAGE_DEFS } from '../constants'
import type { Order, WorkerStage } from '../types'

// Stany specjalne etapów (zgłoszenie #73, decyzja 2.11.2026): '#ND' nie dotyczy
// liczy się jako zrobione (bez osoby), '#WS:powód' wstrzymane — jako niezrobione.

describe('stageSpecial — rozpoznawanie wartości', () => {
  it('inicjały to nie stan specjalny', () => {
    expect(isStageSpecial('KW')).toBe(false)
    expect(isStageSpecial('')).toBe(false)
    expect(isStageDone('KW')).toBe(true)
    expect(isStageDone('')).toBe(false)
    expect(stageInitials(' kw ')).toBe('kw')
  })
  it('#ND = nie dotyczy = zrobione, bez inicjałów, wyświetla „—"', () => {
    expect(isStageNA('#ND')).toBe(true)
    expect(isStageNA('#nd')).toBe(true)
    expect(isStageDone('#ND')).toBe(true)
    expect(stageInitials('#ND')).toBe('')
    expect(stageDisplay('#ND')).toBe('—')
    expect(stageLabel('#ND')).toBe('nie dotyczy')
  })
  it('#WS = wstrzymane = NIEzrobione, z powodem', () => {
    expect(isStageHold('#WS')).toBe(true)
    expect(isStageHold('#WS:czekamy na szybę')).toBe(true)
    expect(isStageDone('#WS:czekamy')).toBe(false)
    expect(stageHoldReason('#WS:czekamy na szybę')).toBe('czekamy na szybę')
    expect(stageHoldReason('#WS')).toBe('')
    expect(holdValue('  brak   okuć ')).toBe('#WS:brak okuć')
    expect(holdValue('')).toBe('#WS')
    expect(stageDisplay('#WS:x')).toBe('⏸')
    expect(stageLabel('#WS:x')).toBe('wstrzymane: x')
  })
})

describe('stageSpecial — Moje stanowisko', () => {
  const defs = STA_DISTING_STAGE_DEFS
  const order = (o: Record<string, unknown>): Order => o as unknown as Order
  const ws = (stage_key: string): WorkerStage =>
    ({ id: 1, worker_id: 'u1', category: 'STA', stage_key, created_at: '', created_by: null }) as WorkerStage

  it('„nie dotyczy" na poprzedniku odblokowuje następny etap', () => {
    expect(isStageReady('STA', 'e2_1', { e1: '#ND' }, defs)).toBe(true)
    expect(missingPrereqs('STA', 'e2_1', { e1: '#ND' }, defs)).toEqual([])
  })
  it('„wstrzymane" na poprzedniku blokuje i jest widoczne w „Czeka na"', () => {
    expect(isStageReady('STA', 'e2_1', { e1: '#WS:klient' }, defs)).toBe(false)
    expect(missingPrereqs('STA', 'e2_1', { e1: '#WS:klient' }, defs)).toEqual(['E1 (wstrzymane)'])
  })
  it('etap „nie dotyczy" nie jest zadaniem; etap wstrzymany jest zadaniem niegotowym z powodem', () => {
    const o = order({ id: 1, category: 'STA', order_number: '100', production_stages: { e1: '#ND', e3: '#WS:brak blachy' } })
    const tasks = buildTasks([o], [ws('e1'), ws('e3'), ws('e2_1')])
    const keys = tasks.map((t) => t.actualStageKey)
    expect(keys).not.toContain('e1')
    expect(keys).toContain('e2_1')
    const e3 = tasks.find((t) => t.actualStageKey === 'e3')
    expect(e3).toBeDefined()
    expect(e3!.readyToWork).toBe(false)
    expect(e3!.holdReason).toBe('brak blachy')
  })
})
