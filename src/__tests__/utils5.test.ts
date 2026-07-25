import { describe, expect, it } from 'vitest'
import {
  buildRecipeAutoName,
  calcGlassDim,
  mapConfigTypeToFormField,
  orderToStaForm,
  validateOrderForm,
} from '../utils'
import { INITIAL_RECIPE_FORM } from '../constants'
import type { Order } from '../types'

const order = (o: Record<string, unknown>): Order => o as unknown as Order

describe('validateOrderForm — wymagane pola formularza', () => {
  const staOk = {
    company: 'X', system: 'NORMAL', model: 'M', wing_color: 'K', width: '90',
    direction: 'PRAWE', opening: 'ONZ', height: 'STD', frame_color: 'K',
    threshold_color: 'S', glazing: 'MLECZNE', hardware: 'O', handle: 'P',
  }
  it('komplet pól → brak błędów; braki są wskazywane po nazwie pola', () => {
    expect(validateOrderForm('STA', staOk)).toEqual([])
    expect(validateOrderForm('STA', { ...staOk, company: ' ', model: undefined })).toEqual(
      expect.arrayContaining(['company', 'model']),
    )
  })
  it('STA: naświetle/dostawka wymuszają wybór ich szklenia', () => {
    expect(validateOrderForm('STA', { ...staOk, top_light_h_mm: '400' })).toContain('top_light_glazing')
    expect(validateOrderForm('STA', { ...staOk, side_panel_a_w_mm: '370' })).toContain('side_panel_a_glazing')
    expect(validateOrderForm('STA', staOk)).not.toContain('top_light_glazing')
  })
  it('Techniczne mają luźniejsze wymagania (bez okuć/szklenia)', () => {
    const tech = { company: 'X', system: 'T', model: 'M', wing_color: 'K', width: '80', direction: 'L', opening: 'ONZ', height: 'STD' }
    expect(validateOrderForm('Techniczne', tech)).toEqual([])
  })
})

describe('calcGlassDim — wymiar szyby z naddatkiem', () => {
  it('odejmuje naddatek od wymiaru całkowitego', () => {
    expect(calcGlassDim(900, 400, 40, 40)).toBe('860×360')
  })
  it('naddatek większy niż wymiar → 0, nigdy ujemne; brak wymiarów → ""', () => {
    expect(calcGlassDim(30, 400, 40, 40)).toBe('0×360')
    expect(calcGlassDim(0, 0, 40, 40)).toBe('')
  })
})

describe('orderToStaForm — wczytanie zlecenia do formularza (edycja)', () => {
  it('rozbija wymiary S×W na pola i dzieli etapy na stage1..5', () => {
    const form = orderToStaForm(
      order({
        category: 'STA', order_number: '5',
        top_light: '900×400', side_panel_a: '370×2080', side_panel_b: '',
        production_stages: { e1: 'TW', e3: 'MK' },
        extra_fields: { wykonawca: 'Profil' },
      }),
    )
    expect(form.top_light_w_mm).toBe('900')
    expect(form.top_light_h_mm).toBe('400')
    expect(form.side_panel_a_w_mm).toBe('370')
    expect(form.side_panel_h_mm).toBe('2080')
    expect(form.side_panel_b_w_mm).toBe('')
    expect(form.stage1).toBe('TW')
    expect(form.stage3).toBe('MK')
    expect(form.wykonawca).toBe('Profil')
  })
})

describe('buildRecipeAutoName — nazwa z dynamicznych kryteriów', () => {
  it('kategoria / część / wartości kryteriów (multi przez |)', () => {
    const name = buildRecipeAutoName({
      ...INITIAL_RECIPE_FORM,
      category: 'STA',
      part: 'wing',
      criteria: [
        { field: 'system', values: ['NORMAL', 'NORMAL PLUS'] },
        { field: 'wing_color', values: ['ANTRACYT'] },
        { field: 'zaczep', values: [] }, // puste pomijane
      ],
    })
    expect(name).toContain('STA')
    expect(name).toContain('NORMAL|NORMAL PLUS')
    expect(name).toContain('ANTRACYT')
  })
})

describe('mapConfigTypeToFormField — słownik Konfiguracji → pole formularza', () => {
  it('mapuje typy słowników na pola zlecenia', () => {
    expect(mapConfigTypeToFormField('system')).toBe('system')
    expect(mapConfigTypeToFormField('kolor')).toBe('wing_color')
    expect(mapConfigTypeToFormField('kolor_progu')).toBe('threshold_color')
    expect(mapConfigTypeToFormField('wysokosc')).toBe('height')
  })
})
