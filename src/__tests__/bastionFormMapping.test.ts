// testy 27.11 (runda 3): edycja nogi Bastion Titana w formularzu Bastion
import { describe, expect, it } from 'vitest'
import { bastionFormToOrderFields, orderToBastionForm, pickChangedFields } from '../utils'
import type { Order } from '../types'

const titanLeg = (patch: Record<string, unknown>) =>
  ({
    id: 10,
    category: 'Bastion',
    order_number: '500',
    decorative_panel: 'PANEL RAL 7016',
    extension: 'A:1×100mm(2000mm)',
    extra_fields: { titan_group: 7, titan_role: 'Bastion' },
    ...patch,
  }) as unknown as Order

describe('orderToBastionForm — noga Titana', () => {
  it('pusty bastion_frame_type: typ ościeżnicy pusty, panel nie trafia do typu', () => {
    const f = orderToBastionForm(titanLeg({ bastion_frame_type: '', bastion_frame_range: '' }))
    expect(f.frame_type).toBe('')
    expect(f.frame_range).toBe('')
  })
  it('null bastion_frame_type: kolor panelu NIE ląduje jako typ ościeżnicy', () => {
    const f = orderToBastionForm(titanLeg({ bastion_frame_type: null, bastion_frame_range: null }))
    expect(f.frame_type).toBe('')
    expect(f.frame_range).toBe('')
  })
  it('ustawiony typ zostaje', () => {
    const f = orderToBastionForm(titanLeg({ bastion_frame_type: 'REGULOWANA', bastion_frame_range: '100-120' }))
    expect(f.frame_type).toBe('REGULOWANA')
    expect(f.frame_range).toBe('100-120')
  })
})

describe('orderToBastionForm — zwykły Bastion (stary zapis typu w decorative_panel)', () => {
  const plain = (patch: Record<string, unknown>) =>
    ({ id: 11, category: 'Bastion', decorative_panel: 'STAŁA', extension: '', extra_fields: {}, ...patch }) as unknown as Order
  it('brak bastion_frame_type (null lub pusty) → typ z decorative_panel', () => {
    expect(orderToBastionForm(plain({ bastion_frame_type: null })).frame_type).toBe('STAŁA')
    expect(orderToBastionForm(plain({ bastion_frame_type: '' })).frame_type).toBe('STAŁA')
  })
  it('bastion_frame_type ma pierwszeństwo', () => {
    expect(orderToBastionForm(plain({ bastion_frame_type: 'REGULOWANA' })).frame_type).toBe('REGULOWANA')
  })
})

describe('bastionFormToOrderFields — zapis', () => {
  it('noga Titana: bez decorative_panel i extension (zostają z STA)', () => {
    const form = orderToBastionForm(titanLeg({ bastion_frame_type: null }))
    const out = bastionFormToOrderFields(form, { isTitanLeg: true })
    expect('decorative_panel' in out).toBe(false)
    expect('extension' in out).toBe(false)
    expect(out.bastion_frame_type).toBe('')
  })
  it('zwykły Bastion: stare mapowanie typ → decorative_panel, zakres → extension', () => {
    const form = { ...orderToBastionForm(titanLeg({})), frame_type: 'REGULOWANA', frame_range: '100-120' }
    const out = bastionFormToOrderFields(form, { isTitanLeg: false })
    expect(out.decorative_panel).toBe('REGULOWANA')
    expect(out.extension).toBe('100-120')
    expect(out.bastion_frame_type).toBe('REGULOWANA')
  })
  it('wymiary dostawek sklejane jako SZER×WYS, pusta szerokość = pusto', () => {
    const form = { ...orderToBastionForm(titanLeg({})), side_panel_k_w: '300', side_panel_h: '2000', top_panel_w: '' }
    const out = bastionFormToOrderFields(form, { isTitanLeg: true })
    expect(out.bastion_side_panel_k).toBe('300×2000')
    expect(out.bastion_top_panel).toBe('')
  })
})

describe('pickChangedFields — łatka zmienionych pól', () => {
  it('zwraca tylko pola różne od stanu z otwarcia', () => {
    const open = { model: 'A', quantity: 1, qtys: { a: { '100': 1 } }, notes: '' }
    const now = { model: 'A', quantity: 2, qtys: { a: { '100': 1 } }, notes: 'x' }
    expect(pickChangedFields(now, open)).toEqual({ quantity: 2, notes: 'x' })
  })
  it('zmiana w obiekcie (dostawki) wykryta', () => {
    expect(pickChangedFields({ q: { a: 2 } }, { q: { a: 1 } })).toEqual({ q: { a: 2 } })
  })
  it('brak zrzutu → wszystkie pola', () => {
    expect(pickChangedFields({ a: 1 }, null)).toEqual({ a: 1 })
  })
  it('pomija undefined', () => {
    expect(pickChangedFields({ a: undefined, b: 1 }, {})).toEqual({ b: 1 })
  })
})
