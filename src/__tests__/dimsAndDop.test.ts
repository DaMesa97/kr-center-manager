// Testy TOP 8: łańcuch wymiarów naświetli/dostawek + determinizm doboru DoP
// + spójność mapy mirrorów (jedno źródło: lib/stageMirror).
import { describe, expect, it } from 'vitest'
import {
  calcExtensionDims,
  calcGlassDim,
  calcSidePanelHeight,
  calcTopLightWidth,
  orderSetCompleteness,
  parseGlassDim,
  workingDaysBetween,
} from '../utils'
import { docSpecificity, matchedDocsForOrder, orderGlazingType, type DopDocument } from '../lib/dopMatch'
import { mirrorStageKey } from '../lib/stageMirror'
import { sortTasks, workersForTask, type MyTask } from '../lib/stationLogic'
import type { DimensionMap, Order, StaOrderFormData, WorkerStage } from '../types'

const dimMap: DimensionMap[] = [
  { id: 1, category: 'STA', dimension_code: '90', width_mm: 1000, height_mm: 2080 },
  { id: 2, category: 'STA', dimension_code: 'STD', width_mm: 0, height_mm: 2080 },
]

const staForm = (over: Partial<StaOrderFormData>): StaOrderFormData =>
  ({
    width: '90',
    height: 'STD',
    side_panel_a_w_mm: '',
    side_panel_b_w_mm: '',
    extension_qtys: {},
    ...over,
  }) as unknown as StaOrderFormData

describe('łańcuch wymiarów naświetla: szerokość całkowita', () => {
  it('szerokość skrzydła + dostawki A/B + poszerzenia (szt. × mm)', () => {
    const form = staForm({
      side_panel_a_w_mm: '380',
      side_panel_b_w_mm: '250',
      extension_qtys: { a: { '64': 2 }, b: { '100': 1 } },
    })
    // 1000 + 380 + 250 + 2×64 + 1×100 = 1858
    expect(calcTopLightWidth(form, 'STA', dimMap)).toBe('1858')
  })

  it('nieznany kod szerokości → pusty string (nie zgadujemy)', () => {
    expect(calcTopLightWidth(staForm({ width: '777' }), 'STA', dimMap)).toBe('')
  })

  it('wysokość dostawki: STD bierze wysokość ze słownika, liczbowa wygrywa', () => {
    expect(calcSidePanelHeight(staForm({ height: 'STD' }), 'STA', dimMap)).toBe('2080')
    expect(calcSidePanelHeight(staForm({ height: '2100 mm' }), 'STA', dimMap)).toBe('2100')
  })

  it('calcExtensionDims: STD → wysokość słownikowa; topDim ze słownika szerokości', () => {
    const std = calcExtensionDims('90', 'STD', 'STA', dimMap)
    expect(std.sideDim).toBe('2080')
    expect(std.topDim).toBe('1000')
    const custom = calcExtensionDims('90', '2150', 'STA', dimMap)
    expect(custom.sideDim).toBe('2150')
  })
})

describe('łańcuch wymiarów naświetla: wymiar szyby', () => {
  it('parseGlassDim toleruje stare formaty', () => {
    expect(parseGlassDim('380x2081')).toEqual([380, 2081])
    expect(parseGlassDim('380 mm × 2081 mm')).toEqual([380, 2081])
    expect(parseGlassDim('NIE')).toEqual([0, 0])
    expect(parseGlassDim('2080')).toEqual([2080, 0]) // sama liczba = brak pełnego wymiaru
  })

  it('calcGlassDim odejmuje naddatek i nie schodzi poniżej zera', () => {
    expect(calcGlassDim(1508, 460, 10, 10)).toBe('1498×450')
    expect(calcGlassDim(5, 460, 10, 10)).toBe('0×450')
    expect(calcGlassDim(0, 0, 10, 10)).toBe('')
  })
})

describe('dobór DoP: determinizm i specyficzność', () => {
  const doc = (over: Partial<DopDocument>): DopDocument =>
    ({ id: 0, category: 'STA', name: '', zpl_content: null, ...over }) as DopDocument
  const order = (over: Partial<Order>): Order => ({ category: 'STA', ...over }) as unknown as Order

  it('bardziej szczegółowy dokument wygrywa z ogólnym', () => {
    const generic = doc({ id: 1, name: 'Ogólna' })
    const specific = doc({ id: 2, name: 'Szklona', glazing_type: 'szklone' })
    const o = order({ glazing: '4/16/4' })
    expect(matchedDocsForOrder(o, [generic, specific])[0].id).toBe(2)
    expect(docSpecificity(specific)).toBe(1)
  })

  it('remis specyficzności: wynik nie zależy od kolejności z bazy (tie-break po nazwie)', () => {
    const a = doc({ id: 10, name: 'Alfa' })
    const b = doc({ id: 20, name: 'Beta' })
    const o = order({})
    expect(matchedDocsForOrder(o, [b, a])[0].id).toBe(10)
    expect(matchedDocsForOrder(o, [a, b])[0].id).toBe(10)
  })

  it('glazing_type: "NIE"/"-"/puste = pełne', () => {
    expect(orderGlazingType(order({ glazing: 'NIE' }))).toBe('pelne')
    expect(orderGlazingType(order({ glazing: '-' }))).toBe('pelne')
    expect(orderGlazingType(order({ glazing: '4/16/4' }))).toBe('szklone')
  })

  it('dokument z niepasującą cechą odpada', () => {
    const steel = doc({ id: 3, name: 'Stalowa', frame_kind: 'stalowa' })
    expect(matchedDocsForOrder(order({}), [steel])).toHaveLength(0)
    // ST = drzwi stalowe → ościeżnica stalowa pasuje
    expect(matchedDocsForOrder(order({ category: 'ST' }), [doc({ id: 4, name: 'ST stal', category: 'ST', frame_kind: 'stalowa' })])).toHaveLength(1)
  })
})

describe('workersForTask — kafelki "kto zrobił" na wspólnym komputerze', () => {
  const ws = (worker_id: string, category: string, stage_key: string): WorkerStage =>
    ({ id: 0, worker_id, category, stage_key, created_at: '', created_by: null }) as WorkerStage
  const task = { category: 'STA', stageKey: 'e4', actualStageKey: 'e4' } as MyTask
  const profiles = [
    { id: 'u1', initials: 'AB', full_name: 'Adam B' },
    { id: 'u2', initials: 'CD', full_name: 'Celina D' },
    { id: 'u3', initials: 'EF', full_name: 'Edward F' },
    { id: 'u4', initials: '', full_name: 'Bez Inicjałów' },
  ]

  it('zwraca osoby przypisane do etapu+kategorii, posortowane po inicjałach', () => {
    const stages = [ws('u2', 'STA', 'e4'), ws('u1', 'STA', 'e4'), ws('u3', 'STA', 'e3'), ws('u1', 'ST', 'e4')]
    const out = workersForTask(task, stages, profiles)
    expect(out.map((w) => w.initials)).toEqual(['AB', 'CD'])
  })

  it('łapie też wariant titan_ przez actualStageKey i pomija puste inicjały', () => {
    const titanTask = { category: 'STA', stageKey: 'titan_e3', actualStageKey: 'e3' } as MyTask
    const stages = [ws('u3', 'STA', 'e3'), ws('u4', 'STA', 'e3')]
    const out = workersForTask(titanTask, stages, profiles)
    expect(out.map((w) => w.initials)).toEqual(['EF'])
  })

  it('brak przypisanych → pusta lista (dialog pokaże zwykły przycisk)', () => {
    expect(workersForTask(task, [], profiles)).toEqual([])
  })
})

describe('workingDaysBetween — wiek zamówienia w dniach roboczych', () => {
  const d = (s: string) => new Date(`${s}T12:00:00`)
  it('weekendy nie liczą się', () => {
    // pt 2026-10-16 → wt 2026-10-20: pon + wt = 2 dni robocze
    expect(workingDaysBetween(d('2026-10-16'), d('2026-10-20'))).toBe(2)
    // pełny tydzień pn→pn = 5
    expect(workingDaysBetween(d('2026-10-12'), d('2026-10-19'))).toBe(5)
    // sobota → niedziela = 0
    expect(workingDaysBetween(d('2026-10-17'), d('2026-10-18'))).toBe(0)
    // ten sam dzień i daty wstecz = 0
    expect(workingDaysBetween(d('2026-10-20'), d('2026-10-20'))).toBe(0)
    expect(workingDaysBetween(d('2026-10-21'), d('2026-10-20'))).toBe(0)
    // dwa pełne tygodnie + 1 dzień roboczy
    expect(workingDaysBetween(d('2026-10-05'), d('2026-10-20'))).toBe(11)
  })
})

describe('orderSetCompleteness — komplet pary/trójki w Wysyłce', () => {
  const ord = (over: Record<string, unknown>) => over as unknown as import('../types').Order

  it('pojedyncze zamówienie → null (nie dotyczy)', () => {
    expect(orderSetCompleteness(ord({ id: 1, category: 'STA' }), [])).toBeNull()
  })

  it('para Disting Plus: mirrory zaspokajają etapy partnera', () => {
    const sta = ord({
      id: 1, category: 'STA', linked_order_id: 2,
      production_stages: { e3: 'A', e4: 'A', e5: 'A', dist_e1: 'B', dist_e2_1: 'B' },
    })
    const res = orderSetCompleteness(sta, [sta])!
    expect(res.complete).toBe(true)
  })

  it('para: brak ościeżnicy → missing E1', () => {
    const sta = ord({
      id: 1, category: 'STA', linked_order_id: 2,
      production_stages: { e3: 'A', e4: 'A', e5: 'A' },
    })
    const res = orderSetCompleteness(sta, [sta])!
    expect(res.complete).toBe(false)
    expect(res.missing.some((m) => m.includes('E1'))).toBe(true)
  })

  it('trójka Titan: komplet gdy STA e3+e5, ST e1, Bastion OKU/MONT/PAK', () => {
    const sta = ord({ id: 10, category: 'STA', linked_order_id: 11, system: 'CORE',
      extra_fields: { titan_group: 10 }, production_stages: { e3: 'A', e5: 'A' } })
    const st = ord({ id: 11, category: 'ST', linked_order_id: 10, system: 'CORE',
      production_stages: { e1: 'B' } })
    const bastion = ord({ id: 12, category: 'Bastion',
      extra_fields: { titan_group: 10 }, production_stages: { tit_oku: 'C', tit_mon: 'C', tit_pak: 'C' } })
    const all = [sta, st, bastion]
    expect(orderSetCompleteness(sta, all)!.complete).toBe(true)
    // brak montażu → niekompletny, widoczny też od strony nogi ST
    const bastion2 = ord({ ...bastion, production_stages: { tit_oku: 'C' } })
    const res = orderSetCompleteness(st, [sta, st, bastion2])!
    expect(res.complete).toBe(false)
    expect(res.missing.some((m) => m.includes('MONT'))).toBe(true)
  })
})

describe('sortTasks — plan wydań XX/X nad wszystkim', () => {
  const t = (over: Record<string, unknown>): MyTask =>
    ({ readyToWork: true, category: 'STA', stageKey: 'e3', actualStageKey: 'e3', ...over }) as unknown as MyTask
  const withMark = (mark: string | null, extra: Record<string, unknown> = {}): MyTask['order'] =>
    ({ order_number: 'n', order_date: '2026-10-01', extra_fields: mark ? { route_mark: mark } : {}, ...extra }) as unknown as MyTask['order']

  it('XX przed X, X przed resztą — nawet przed pilnymi i gotowymi', () => {
    const plain = t({ order: withMark(null, { sequence: 'X' }) }) // pilne, bez planu
    const x = t({ order: withMark('X'), readyToWork: false }) // na jutro, nawet niegotowe
    const xx = t({ order: withMark('XX') })
    const out = sortTasks([plain, x, xx])
    expect(out[0]).toBe(xx)
    expect(out[1]).toBe(x)
    expect(out[2]).toBe(plain)
  })

  it('w obrębie tej samej flagi: gotowe przed czekającymi, pilne przed zwykłymi', () => {
    const xxWaiting = t({ order: withMark('XX'), readyToWork: false })
    const xxReadyRush = t({ order: withMark('XX', { sequence: 'X' }) })
    const xxReady = t({ order: withMark('XX') })
    const out = sortTasks([xxWaiting, xxReady, xxReadyRush])
    expect(out[0]).toBe(xxReadyRush)
    expect(out[1]).toBe(xxReady)
    expect(out[2]).toBe(xxWaiting)
  })
})

describe('mapa mirrorów etapów (jedno źródło: lib/stageMirror)', () => {
  it('STA e3/e4/e5 → sta_*, Disting e1/e2_*/e5 → dist_*, reszta null', () => {
    expect(mirrorStageKey('STA', 'e3')).toBe('sta_e3')
    expect(mirrorStageKey('STA', 'e4')).toBe('sta_e4')
    expect(mirrorStageKey('STA', 'e5')).toBe('sta_e5')
    expect(mirrorStageKey('STA', 'e1')).toBeNull()
    expect(mirrorStageKey('Disting', 'e1')).toBe('dist_e1')
    expect(mirrorStageKey('Disting', 'e2_1')).toBe('dist_e2_1')
    expect(mirrorStageKey('Disting', 'e2_2')).toBe('dist_e2_2')
    expect(mirrorStageKey('Disting', 'e5')).toBe('dist_e5')
    expect(mirrorStageKey('Disting', 'e3')).toBeNull()
    expect(mirrorStageKey('ST', 'e1')).toBeNull()
    expect(mirrorStageKey(null, 'e3')).toBeNull()
  })
})
