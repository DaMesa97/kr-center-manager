import { describe, expect, it } from 'vitest'
import {
  docMatchesOrder,
  matchedDocsForOrder,
  orderFrameKind,
  orderGlazingType,
  orderWykonawca,
  type DopDocument,
} from '../lib/dopMatch'
import type { Order } from '../types'

// Auto-dobór DoP/DWU — zgodnie z Pomocą (sekcja Etykiety i druk):
// kategoria + system + realizator + szklone/pełne + rodzaj ościeżnicy.

const order = (o: Record<string, unknown>): Order => o as unknown as Order
const doc = (d: Partial<DopDocument>): DopDocument =>
  ({ id: 1, category: 'STA', name: 'doc', zpl_content: '^XA^XZ', ...d }) as DopDocument

describe('cechy zamówienia', () => {
  it('szklone/pełne: puste, "-", BRAK, NIE → pełne; cokolwiek innego → szklone', () => {
    expect(orderGlazingType(order({ glazing: '' }))).toBe('pelne')
    expect(orderGlazingType(order({ glazing: '-' }))).toBe('pelne')
    expect(orderGlazingType(order({ glazing: 'BRAK' }))).toBe('pelne')
    expect(orderGlazingType(order({ glazing: 'nie' }))).toBe('pelne')
    expect(orderGlazingType(order({ glazing: 'MLECZNE' }))).toBe('szklone')
  })

  it('ościeżnica: Bastion po bastion_frame_type, kategoria ST zawsze stalowa', () => {
    expect(orderFrameKind(order({ category: 'Bastion', bastion_frame_type: 'DREWNIANA REGULOWANA' }))).toBe('drewniana')
    expect(orderFrameKind(order({ category: 'Bastion', bastion_frame_type: 'STALOWA' }))).toBe('stalowa')
    expect(orderFrameKind(order({ category: 'ST' }))).toBe('stalowa')
    expect(orderFrameKind(order({ category: 'STA' }))).toBe('')
  })

  it('realizator z extra_fields.wykonawca', () => {
    expect(orderWykonawca(order({ extra_fields: { wykonawca: 'Center' } }))).toBe('Center')
    expect(orderWykonawca(order({ extra_fields: null }))).toBe('')
  })
})

describe('docMatchesOrder', () => {
  const staOrder = order({
    category: 'STA',
    system: 'NORMAL PLUS',
    glazing: 'MLECZNE',
    extra_fields: { wykonawca: 'Center' },
  })

  it('kategoria musi się zgadzać zawsze', () => {
    expect(docMatchesOrder(doc({ category: 'Bastion' }), staOrder)).toBe(false)
    expect(docMatchesOrder(doc({ category: 'STA' }), staOrder)).toBe(true)
  })

  it('puste cechy = dowolne; ustawione muszą pasować (bez wrażliwości na wielkość liter)', () => {
    expect(docMatchesOrder(doc({ system: 'normal plus' }), staOrder)).toBe(true)
    expect(docMatchesOrder(doc({ system: 'NORMAL' }), staOrder)).toBe(false)
    expect(docMatchesOrder(doc({ wykonawca: 'Center' }), staOrder)).toBe(true)
    expect(docMatchesOrder(doc({ wykonawca: 'Profil' }), staOrder)).toBe(false)
    expect(docMatchesOrder(doc({ glazing_type: 'szklone' }), staOrder)).toBe(true)
    expect(docMatchesOrder(doc({ glazing_type: 'pelne' }), staOrder)).toBe(false)
  })

  it('kombinacja wszystkich cech naraz', () => {
    const full = doc({ system: 'NORMAL PLUS', wykonawca: 'Center', glazing_type: 'szklone' })
    expect(docMatchesOrder(full, staOrder)).toBe(true)
  })
})

describe('matchedDocsForOrder — sortowanie po szczegółowości', () => {
  it('bardziej szczegółowe dokumenty pierwsze; niepasujące odpadają', () => {
    const o = order({ category: 'STA', system: 'NORMAL', glazing: '', extra_fields: { wykonawca: 'Profil' } })
    const generic = doc({ id: 1, name: 'ogólna' })
    const bySystem = doc({ id: 2, name: 'system', system: 'NORMAL' })
    const precise = doc({ id: 3, name: 'pełna', system: 'NORMAL', wykonawca: 'Profil', glazing_type: 'pelne' })
    const wrong = doc({ id: 4, name: 'zła', wykonawca: 'Center' })

    const matched = matchedDocsForOrder(o, [generic, wrong, bySystem, precise])
    expect(matched.map((d) => d.id)).toEqual([3, 2, 1])
  })
})
