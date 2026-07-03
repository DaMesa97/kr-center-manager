import { describe, expect, it } from 'vitest'
import { buildPartnerSyncPayload, SHARED_LINKED_FIELDS } from '../lib/linkedSync'

// #23 — sync edycji na powiązany rekord (Disting Plus / Titan).
// Kluczowa gwarancja: pola strukturalne partnera NIGDY nie są nadpisywane.

describe('buildPartnerSyncPayload', () => {
  const mapped = {
    // pola produktowe (mają przejść)
    company: 'TORA', system: 'DISTING PLUS', model: 'NICOLO 01',
    wing_color: 'ANTRACYT', width: '90', notes: 'uwaga',
    // pola strukturalne (NIE mogą przejść na partnera!)
    order_number: '123', category: 'STA', linked_order_id: 999,
    production_stages: { e1: 'TW' }, release_date: '2026-07-01',
    extra_fields: { titan_group: 5 }, disting_sheet: '55', sta_sheet: '44',
    airtable_id: 'rec123', source: 'bot',
  }

  it('przenosi tylko wspólne pola produktowe', () => {
    const p = buildPartnerSyncPayload(mapped)
    expect(p).toMatchObject({ company: 'TORA', model: 'NICOLO 01', wing_color: 'ANTRACYT', width: '90', notes: 'uwaga' })
  })

  it('NIGDY nie nadpisuje pól strukturalnych partnera', () => {
    const p = buildPartnerSyncPayload(mapped)
    for (const forbidden of [
      'order_number', 'category', 'linked_order_id', 'production_stages',
      'release_date', 'extra_fields', 'disting_sheet', 'sta_sheet', 'airtable_id', 'source',
    ]) {
      expect(p, `pole "${forbidden}" wyciekło do partnera!`).not.toHaveProperty(forbidden)
    }
  })

  it('pomija undefined (nie zeruje pól partnera przypadkiem)', () => {
    const p = buildPartnerSyncPayload({ company: undefined, model: 'X' })
    expect(p).not.toHaveProperty('company')
    expect(p.model).toBe('X')
  })

  it('lista pól zawiera komplet specyfikacji produktu (kolory, wymiary, dodatki)', () => {
    for (const key of ['wing_color', 'frame_color', 'threshold_color', 'glazing', 'top_light', 'side_panel_a', 'extension']) {
      expect(SHARED_LINKED_FIELDS).toContain(key)
    }
  })
})
