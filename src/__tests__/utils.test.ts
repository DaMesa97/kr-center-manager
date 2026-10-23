import { describe, expect, it } from 'vitest'
import { countCompletedStages, isTitanSystem, orderToBastionForm } from '../utils'
import type { Order } from '../types'

const order = (o: Record<string, unknown>): Order => o as unknown as Order

describe('isTitanSystem — systemy tworzące trójkę STA+ST+Bastion', () => {
  it('CORE / GUARD RC2 / GUARD RC3 (w tym EI 30) → Titan', () => {
    expect(isTitanSystem('CORE')).toBe(true)
    expect(isTitanSystem('GUARD RC2')).toBe(true)
    expect(isTitanSystem('GUARD RC3')).toBe(true)
    expect(isTitanSystem('GUARD RC3 EI 30')).toBe(true)
    expect(isTitanSystem('core 2')).toBe(true)
  })
  it('zwykłe systemy → nie Titan', () => {
    expect(isTitanSystem('NORMAL')).toBe(false)
    expect(isTitanSystem('DISTING PLUS')).toBe(false)
    expect(isTitanSystem('')).toBe(false)
    expect(isTitanSystem(null)).toBe(false)
  })
})

describe('orderToBastionForm — parsowanie paneli (SZER×WYS)', () => {
  it('rozbija wymiary paneli na pola formularza (× oraz x)', () => {
    const form = orderToBastionForm(
      order({
        category: 'Bastion',
        bastion_side_panel_k: '370×2080',
        bastion_side_panel_p: '',
        bastion_top_panel: '900x400',
      }),
    )
    expect(form.side_panel_k_w).toBe('370')
    expect(form.side_panel_h).toBe('2080')
    expect(form.side_panel_p_w).toBe('')
    expect(form.top_panel_w).toBe('900')
    expect(form.top_panel_h).toBe('400')
  })

  it('brak paneli → puste pola (bez wybuchu)', () => {
    const form = orderToBastionForm(order({ category: 'Bastion' }))
    expect(form.side_panel_k_w).toBe('')
    expect(form.top_panel_w).toBe('')
  })
})

describe('countCompletedStages — "zrobione" = komórka NIEPUSTA (inicjały, nie „T")', () => {
  it('liczy niepuste wartości jako wykonane', () => {
    const res = countCompletedStages(
      order({
        category: 'STA',
        production_stages: { e1: 'TW', e2_1: '', e2_2: 'XY', e3: '', e4: '', e5: '' },
      }),
    )
    expect(res.total).toBeGreaterThan(0)
    expect(res.completed).toBe(2)
    expect(res.stages.find((s) => s.key === 'e1')?.done).toBe(true)
    expect(res.stages.find((s) => s.key === 'e3')?.done).toBe(false)
  })

  it('para Disting Plus: etapy partnera z lustra liczą się do postępu (koniec „nigdy 100%”)', () => {
    // STA: e1/e2 robi Disting (dist_*), e3/e4/e5 STA
    const sta = countCompletedStages(
      order({
        category: 'STA', linked_order_id: 2,
        production_stages: { dist_e1: 'DK', dist_e2_1: 'BP', dist_e2_2: 'BP', e3: 'KS', e4: 'KW', e5: 'TC' },
      }),
    )
    expect(sta.percent).toBe(100)
    // Disting: e3/e4 robi STA (sta_*), reszta u siebie
    const dist = countCompletedStages(
      order({
        category: 'Disting', linked_order_id: 1,
        production_stages: { e1: 'A', e2_1: 'B', e2_2: 'C', sta_e3: 'KS', sta_e4: 'KW', e5: 'D' },
      }),
    )
    expect(dist.completed).toBe(dist.total)
    // lustro bez partnerskiego etapu nie zalicza innych
    const partial = countCompletedStages(order({ category: 'Disting', production_stages: { sta_e3: 'KS' } }))
    expect(partial.stages.find((s) => s.key === 'e3')?.done).toBe(true)
    expect(partial.stages.find((s) => s.key === 'e4')?.done).toBe(false)
  })

  it('Techniczne / Drzwi wewnętrzne — bez etapów', () => {
    expect(countCompletedStages(order({ category: 'Techniczne' })).total).toBe(0)
    expect(countCompletedStages(order({ category: 'DrzwiWewnetrzne' })).total).toBe(0)
  })
})
