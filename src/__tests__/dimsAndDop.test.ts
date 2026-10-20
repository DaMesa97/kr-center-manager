// Testy TOP 8: łańcuch wymiarów naświetli/dostawek + determinizm doboru DoP
// + spójność mapy mirrorów (jedno źródło: lib/stageMirror).
import { describe, expect, it } from 'vitest'
import {
  calcExtensionDims,
  calcGlassDim,
  calcSidePanelHeight,
  calcTopLightWidth,
  parseGlassDim,
} from '../utils'
import { docSpecificity, matchedDocsForOrder, orderGlazingType, type DopDocument } from '../lib/dopMatch'
import { mirrorStageKey } from '../lib/stageMirror'
import type { DimensionMap, Order, StaOrderFormData } from '../types'

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
