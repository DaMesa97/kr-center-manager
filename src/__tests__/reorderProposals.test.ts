import { describe, expect, it } from 'vitest'
import {
  draftWarningText, normalizeReorderProposal, proposalNeedsOrder, proposalShortage, reorderFromProposal,
} from '../lib/reorder'
import { aggregateStockLevels } from '../lib/stockLevels'
import type { ReorderProposal, StockLevelRow } from '../types'

// D9 / D65: jedna reguła „ile zamówić” z bazy (get_reorder_proposals)

const proposal = (p: Partial<ReorderProposal>): ReorderProposal => ({
  component_id: 1, stock: 0, reserved: 0, available: 0, incoming: 0, earliest_eta: null, open_pos: 0, draft_qty: 0,
  position: 0, min: null, min_source: null, target: null, target_source: null, monthly_consumption: 0, smart: false,
  level: 'ok', status: 'no_threshold', proposal: 0, order_lot: null, ...p,
})

const shelf = (p: Partial<StockLevelRow>): StockLevelRow => ({
  stock_id: 1, warehouse_id: 1, warehouse_code: 'MARKLOWICKA', component_id: 1, component_code: 'K1', component_name: 'Komponent',
  component_unit: 'szt', component_category: null, supplier_id: null, is_active: true, quantity: 0, reserved_quantity: 0,
  available_quantity: 0, incoming_qty: 0, earliest_eta: null, open_pos: 0, min_quantity: null, min_source: null, min_effective: null,
  level: 'inactive', shortage: 0, updated_at: null, ...p,
})

describe('normalizeReorderProposal — wiersz RPC (numeric jako string)', () => {
  it('rzutuje liczby, null zostaje null, nieznane wartości → bezpieczne domyślne', () => {
    const p = normalizeReorderProposal({
      r_component_id: '7', r_stock: '4531.000', r_reserved: '2109', r_available: '2422', r_incoming: '0', r_earliest_eta: null,
      r_open_pos: 0, r_draft_qty: '12', r_position: '2422', r_min: '1140', r_min_source: 'smart', r_target: '1750',
      r_target_source: 'smart', r_monthly_consumption: '600.5', r_smart: true, r_level: 'ok', r_status: 'ok',
      r_proposal_raw: '0', r_proposal: '0', r_order_lot: 1,
    })
    expect(p).toMatchObject({ component_id: 7, stock: 4531, reserved: 2109, draft_qty: 12, min: 1140, target: 1750, smart: true, status: 'ok', order_lot: 1 })
    const q = normalizeReorderProposal({ r_component_id: 1, r_min: null, r_target: null, r_status: 'dziwne', r_level: 'x', r_min_source: 'y' })
    expect(q.min).toBeNull()
    expect(q.target).toBeNull()
    expect(q.status).toBe('no_threshold')
    expect(q.level).toBe('ok')
    expect(q.min_source).toBeNull()
    expect(q.order_lot).toBeNull()
  })
})

describe('reorderFromProposal / proposalShortage — co pokazują ekrany', () => {
  it('PILNE / OBSERWUJ: sugestia = propozycja (min. 1); Stany „do zamówienia” = ta sama liczba', () => {
    const p = proposal({ status: 'critical', position: -100, proposal: 1856 })
    expect(proposalNeedsOrder(p)).toBe(true)
    expect(reorderFromProposal(p)).toEqual({ position: -100, status: 'critical', suggested: 1856 })
    expect(proposalShortage(p)).toBe(1856)
    expect(reorderFromProposal(proposal({ status: 'observe', proposal: 0 })).suggested).toBe(1)
  })

  it('OK / brak progu: „z wyprzedzeniem” tylko w Zamawianiu, Stany pokazują 0', () => {
    const ok = proposal({ status: 'ok', proposal: 24 })
    expect(reorderFromProposal(ok).suggested).toBe(24)
    expect(proposalShortage(ok)).toBe(0)
    expect(reorderFromProposal(proposal({ status: 'ok', proposal: 0 })).suggested).toBeNull()
    expect(reorderFromProposal(proposal({ status: 'no_threshold', proposal: 0 })).suggested).toBeNull()
  })
})

describe('aggregateStockLevels z propozycjami (Stany „Wszystkie”)', () => {
  it('poziom i „do zamówienia” z bazy zamiast sumy braków z półek; bez propozycji — po staremu', () => {
    // minimum firmy 1140 przyłożone osobno do 2 półek dawało 2115 do zamówienia; na sumach firma jest OK
    const rows = [
      shelf({ stock_id: 1, warehouse_id: 1, quantity: 4531, reserved_quantity: 0, available_quantity: 4531, level: 'ok' }),
      shelf({ stock_id: 2, warehouse_id: 2, warehouse_code: 'BUKOWA', quantity: 0, reserved_quantity: 2109, available_quantity: -2109, level: 'critical', shortage: 2115 }),
      shelf({ stock_id: 3, warehouse_id: 1, component_id: 2, component_code: 'K2', quantity: 5, available_quantity: 5, level: 'low', shortage: 7 }),
    ]
    const props = new Map([[1, proposal({ component_id: 1, level: 'ok', status: 'ok', proposal: 0, incoming: 0 })]])
    const agg = aggregateStockLevels(rows, props)
    const k1 = agg.find((a) => a.component_id === 1)!
    expect(k1.shortage).toBe(0)
    expect(k1.level).toBe('ok')
    expect(k1.fromProposal).toBe(true)
    const k2 = agg.find((a) => a.component_id === 2)!
    expect(k2.shortage).toBe(7)
    expect(k2.level).toBe('low')
    expect(k2.fromProposal).toBeUndefined()
    // bez mapy (baza bez funkcji) — dokładnie jak dotąd
    const old = aggregateStockLevels(rows)
    expect(old.find((a) => a.component_id === 1)!.shortage).toBe(2115)
    expect(old.find((a) => a.component_id === 1)!.level).toBe('critical')
  })

  it('„w drodze” z propozycji (ZD na magazyn bez półki też się liczy)', () => {
    const rows = [shelf({ component_id: 3, quantity: 1, available_quantity: 1, level: 'ok' })]
    const agg = aggregateStockLevels(rows, new Map([[3, proposal({ component_id: 3, incoming: 50, status: 'critical', level: 'low', proposal: 96 })]]))
    expect(agg[0].incoming).toBe(50)
    expect(agg[0].shortage).toBe(96)
    expect(agg[0].level).toBe('low')
  })
})

describe('draftWarningText — D65 ostrzeżenie przy dodawaniu do listy', () => {
  it('jest szkic → tekst z ilością; brak szkicu → null', () => {
    expect(draftWarningText('Zawias', 12)).toContain('12 szt.')
    expect(draftWarningText('Zawias', 0)).toBeNull()
    expect(draftWarningText('Zawias', null)).toBeNull()
    expect(draftWarningText('Zawias', Number.NaN)).toBeNull()
  })
})
