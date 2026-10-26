import { describe, expect, it } from 'vitest'
import {
  activeConstructionsForPosition,
  constructionNoForPiece,
  formatConstructionNo,
  formatProductionOrderNo,
} from '../lib/aluConstructions'
import type { AluConstruction } from '../types'

const mk = (over: Partial<AluConstruction>): AluConstruction => ({
  id: 1, order_id: 1, position_id: 10, pos_no: 1, piece_index: 1,
  year: 2026, zz: 1, pp: 1, construction_no: '2026/01/01',
  status: 'aktywna', status_reason: null, created_at: '', ...over,
})

describe('formatConstructionNo — RRRR/ZZ/PP (ZKP 5.9)', () => {
  it('min. 2 cyfry, powyżej 99 więcej cyfr (bez ucinania)', () => {
    expect(formatConstructionNo(2026, 1, 1)).toBe('2026/01/01')
    expect(formatConstructionNo(2026, 2, 14)).toBe('2026/02/14')
    expect(formatConstructionNo(2026, 100, 7)).toBe('2026/100/07')
    expect(formatConstructionNo(2026, 5, 123)).toBe('2026/05/123')
  })
  it('numer zlecenia w roku', () => {
    expect(formatProductionOrderNo(2026, 3)).toBe('2026/03')
    expect(formatProductionOrderNo(2027, 341)).toBe('2027/341')
  })
})

describe('numer konstrukcji dla sztuki pozycji', () => {
  const list = [
    mk({ id: 1, position_id: 10, piece_index: 1, construction_no: '2026/01/01' }),
    mk({ id: 2, position_id: 20, piece_index: 1, construction_no: '2026/01/02' }),
    mk({ id: 3, position_id: 20, piece_index: 2, construction_no: '2026/01/03', status: 'anulowana' }),
    mk({ id: 4, position_id: 20, piece_index: 3, construction_no: '2026/01/05' }),
    mk({ id: 5, position_id: null, pos_no: 3, piece_index: 1, construction_no: '2026/01/04', status: 'anulowana' }),
  ]
  it('pomija anulowane, kolejność po sztukach', () => {
    expect(activeConstructionsForPosition(list, 20).map((c) => c.construction_no)).toEqual(['2026/01/02', '2026/01/05'])
  })
  it('n-ta sztuka = n-ta aktywna konstrukcja; brak → pusty', () => {
    expect(constructionNoForPiece(list, 20, 1)).toBe('2026/01/02')
    expect(constructionNoForPiece(list, 20, 2)).toBe('2026/01/05')
    expect(constructionNoForPiece(list, 20, 3)).toBe('')
    expect(constructionNoForPiece([], 10, 1)).toBe('')
  })
})
