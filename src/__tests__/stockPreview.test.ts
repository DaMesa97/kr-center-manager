import { describe, expect, it } from 'vitest'
import {
  buildPreviewPayload,
  formatEtaShort,
  summarizePreview,
  type StockPreviewRow,
} from '../lib/stockPreview'

const row = (over: Partial<StockPreviewRow>): StockPreviewRow => ({
  r_part: 'wing',
  r_component_id: 1,
  r_component_name: 'Skrzydło X',
  r_component_code: 'SKR-X',
  r_required: 2,
  r_available: 5,
  r_shortage: 0,
  r_incoming_qty: 0,
  r_earliest_eta: null,
  r_status: 'ok',
  ...over,
})

describe('buildPreviewPayload', () => {
  const forms = {
    sta: { category: 'STA', system: 'S1', quantity: 2 },
    st: { category: 'ST', model: 'M' },
    techniczne: { category: 'Techniczne' },
    bastion: { category: 'Bastion' },
  }

  it('wybiera formularz wg zakładki', () => {
    expect(buildPreviewPayload('STA', forms)).toMatchObject({ category: 'STA', system: 'S1' })
    expect(buildPreviewPayload('Disting', forms)).toMatchObject({ category: 'STA' }) // sta form obsługuje obie
    expect(buildPreviewPayload('ST', forms)).toMatchObject({ category: 'ST', model: 'M' })
    expect(buildPreviewPayload('Techniczne', forms)).toMatchObject({ category: 'Techniczne' })
    expect(buildPreviewPayload('Bastion', forms)).toMatchObject({ category: 'Bastion' })
  })

  it('nieznana zakładka → null', () => {
    expect(buildPreviewPayload('Magazyn', forms)).toBeNull()
    expect(buildPreviewPayload('DrzwiWewnetrzne', forms)).toBeNull()
  })

  it('brak kategorii lub formularza → null', () => {
    expect(buildPreviewPayload('STA', { sta: { category: '  ' } })).toBeNull()
    expect(buildPreviewPayload('STA', {})).toBeNull()
  })

  it('trymuje kategorię, resztę pól przekazuje bez zmian', () => {
    const p = buildPreviewPayload('STA', { sta: { category: ' STA ', wing_color: 'RAL' } })
    expect(p).toMatchObject({ category: 'STA', wing_color: 'RAL' })
  })
})

describe('summarizePreview', () => {
  it('pusto → brak ostrzeżeń', () => {
    const s = summarizePreview([row({})])
    expect(s.hasWarnings).toBe(false)
    expect(s.shortages).toHaveLength(0)
  })

  it('zbiera braki i brakujące receptury', () => {
    const s = summarizePreview([
      row({}),
      row({ r_component_id: 2, r_status: 'insufficient', r_shortage: 3 }),
      row({ r_part: 'hardware', r_component_id: null, r_status: 'missing_recipe' }),
    ])
    expect(s.hasWarnings).toBe(true)
    expect(s.shortages).toHaveLength(1)
    expect(s.shortages[0].r_shortage).toBe(3)
    expect(s.missingParts).toEqual(['hardware'])
    expect(s.noRecipe).toBe(false)
  })

  it('no_recipe wykrywane', () => {
    const s = summarizePreview([row({ r_status: 'no_recipe', r_part: null })])
    expect(s.noRecipe).toBe(true)
    expect(s.hasWarnings).toBe(true)
  })
})

describe('formatEtaShort', () => {
  it('formatuje datę i znosi braki', () => {
    expect(formatEtaShort('2026-09-15')).toBe('15.09')
    expect(formatEtaShort(null)).toBe('')
    expect(formatEtaShort('dziwne')).toBe('dziwne')
  })
})
