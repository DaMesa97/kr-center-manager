import { describe, expect, it } from 'vitest'
import {
  getComplaintBlockedStages,
  hasGlassExtra,
  isFieldValueExcluded,
  isInternalWarehouseCode,
  sanitizeOrderPayloadForDb,
  supabaseNumericFromForm,
} from '../utils'
import type { ConfigExclusion, Order } from '../types'

const order = (o: Record<string, unknown>): Order => o as unknown as Order

describe('hasGlassExtra — czy zlecenie ma szklone dodatki (naświetle/dostawka)', () => {
  it('puste i "NIE" nie liczą się jako dodatek', () => {
    expect(hasGlassExtra(order({}))).toBe(false)
    expect(hasGlassExtra(order({ top_light: 'NIE', side_panel: 'nie' }))).toBe(false)
  })
  it('realny wymiar naświetla lub dostawki = dodatek', () => {
    expect(hasGlassExtra(order({ top_light: '900×400' }))).toBe(true)
    expect(hasGlassExtra(order({ side_panel_a: '370×2080' }))).toBe(true)
  })
})

describe('isFieldValueExcluded — wykluczenia kombinacji z Konfiguracji', () => {
  const exclusions: ConfigExclusion[] = [
    {
      category: 'STA',
      source_field: 'system', source_value: 'NORMAL',
      target_field: 'glazing', target_value: 'LUSTRO',
    },
  ]
  it('blokuje w przód: system=NORMAL wyklucza szklenie LUSTRO', () => {
    expect(isFieldValueExcluded(exclusions, 'STA', { system: 'NORMAL' }, 'glazing', 'LUSTRO')).toBe(true)
    expect(isFieldValueExcluded(exclusions, 'STA', { system: 'NORMAL' }, 'glazing', 'MLECZNE')).toBe(false)
  })
  it('blokuje w tył: przy szkleniu LUSTRO nie wybierzesz systemu NORMAL', () => {
    expect(isFieldValueExcluded(exclusions, 'STA', { glazing: 'LUSTRO' }, 'system', 'NORMAL')).toBe(true)
  })
  it('inna kategoria — wykluczenie nie działa', () => {
    expect(isFieldValueExcluded(exclusions, 'Bastion', { system: 'NORMAL' }, 'glazing', 'LUSTRO')).toBe(false)
  })
})

describe('getComplaintBlockedStages — reklamacje zleceń łączonych', () => {
  it('reklamacja powiązana: STA blokuje etapy ościeżnicy, Disting etapy skrzydła', () => {
    expect(getComplaintBlockedStages('STA', '', 1)).toEqual(['e1', 'e2_1', 'e2_2'])
    expect(getComplaintBlockedStages('Disting', '', 1)).toEqual(['e3', 'e4', 'e5'])
  })
  it('reklamacja Komplet / bez wskazania — nic nie blokuje', () => {
    expect(getComplaintBlockedStages('STA', 'Komplet', null)).toEqual([])
    expect(getComplaintBlockedStages('STA', '', null)).toEqual([])
  })
})

describe('konwersje do bazy', () => {
  it('supabaseNumericFromForm: "" i null → null; liczby przechodzą; śmieci → null', () => {
    expect(supabaseNumericFromForm('')).toBeNull()
    expect(supabaseNumericFromForm(null)).toBeNull()
    expect(supabaseNumericFromForm('12.5')).toBe(12.5)
    expect(supabaseNumericFromForm('abc')).toBeNull()
  })
  it('sanitizeOrderPayloadForDb: puste wartości numeryczne nie lecą jako "" (błąd Postgresa)', () => {
    const p = sanitizeOrderPayloadForDb({ configurator_value: '', quantity: '3' })
    expect(p.configurator_value).toBeNull()
    expect(p.quantity).toBe(3)
  })
  it('isInternalWarehouseCode: WEW1/WEW2/WEWNETRZNE → true', () => {
    expect(isInternalWarehouseCode('WEW1')).toBe(true)
    expect(isInternalWarehouseCode(' wewnetrzne ')).toBe(true)
    expect(isInternalWarehouseCode('BUK')).toBe(false)
  })
})
