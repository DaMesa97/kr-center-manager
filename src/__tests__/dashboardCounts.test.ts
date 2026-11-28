import { describe, expect, it } from 'vitest'
import { countLogicalOrders, isRowReadyToShip, summarizeDashboard, type DashboardRow } from '../lib/dashboardCounts'
import type { LeadTimeRule } from '../types'

const ALL_STA = { e1: 'AB', e2_1: 'AB', e3: 'AB', e4: 'AB', e5: 'AB' }

function row(p: Partial<DashboardRow> & { id: number; category: string }): DashboardRow {
  return { linked_order_id: null, titan_group: null, order_date: null, ...p }
}

const RULE: LeadTimeRule = {
  id: 1, name: 'wszystko', match_category: null, match_has_glass_extra: null, match_bastion_frame_type: null,
  warning_days: 5, overdue_days: 10, priority: 0, is_active: true,
}

describe('D13 Pulpit — „Do wysłania” = ukończone etapy', () => {
  it('STA ze wszystkimi etapami (bez dostawki — E2.2 z automatu) jest gotowe, z brakującym E5 nie', () => {
    expect(isRowReadyToShip(row({ id: 1, category: 'STA', production_stages: ALL_STA }))).toBe(true)
    expect(isRowReadyToShip(row({ id: 2, category: 'STA', production_stages: { ...ALL_STA, e5: '' } }))).toBe(false)
  })

  it('STA z dostawką wymaga E2.2', () => {
    expect(isRowReadyToShip(row({ id: 1, category: 'STA', side_panel: '300', production_stages: ALL_STA }))).toBe(false)
    expect(isRowReadyToShip(row({ id: 1, category: 'STA', side_panel: '300', production_stages: { ...ALL_STA, e2_2: 'X' } }))).toBe(true)
  })

  it('Techniczne i drzwi wewnętrzne (bez etapów) nigdy nie są „do wysłania”', () => {
    expect(isRowReadyToShip(row({ id: 1, category: 'Techniczne' }))).toBe(false)
    expect(isRowReadyToShip(row({ id: 2, category: 'DrzwiWewnetrzne' }))).toBe(false)
  })

  it('Aluminium: postęp z extra_fields.alu.progress', () => {
    expect(isRowReadyToShip(row({ id: 1, category: 'Aluminium', alu_progress: { done: 4, total: 4 } }))).toBe(true)
    expect(isRowReadyToShip(row({ id: 2, category: 'Aluminium', alu_progress: { done: 3, total: 4 } }))).toBe(false)
    expect(isRowReadyToShip(row({ id: 3, category: 'Aluminium' }))).toBe(false)
  })

  it('para Disting Plus liczona raz i tylko gdy obie niewydane nogi gotowe; noga z lustrem sta_e3/e4', () => {
    const sta = row({ id: 10, category: 'STA', linked_order_id: 11, production_stages: ALL_STA })
    const distGotowa = row({ id: 11, category: 'Disting', linked_order_id: 10, production_stages: { e1: 'A', e2_1: 'A', sta_e3: 'B', sta_e4: 'B', e5: 'A' } })
    const distNie = row({ id: 11, category: 'Disting', linked_order_id: 10, production_stages: { e1: 'A', e2_1: 'A', e5: 'A' } })
    expect(summarizeDashboard([sta, distGotowa], []).readyToShip).toBe(1)
    expect(summarizeDashboard([sta, distNie], []).readyToShip).toBe(0)
    // noga STA już wydana (nie ma jej w danych) — sama noga Disting decyduje
    expect(summarizeDashboard([distGotowa], []).readyToShip).toBe(1)
    expect(summarizeDashboard([sta, distNie], []).inProduction).toBe(1)
  })

  it('Techniczne: osobno, poza „w produkcji”, „Do wysłania” i „Po terminie”', () => {
    const stare = '2020-01-02'
    const rows = [
      row({ id: 1, category: 'Techniczne', order_date: stare }),
      row({ id: 2, category: 'Techniczne' }),
      row({ id: 3, category: 'STA', order_date: stare, production_stages: ALL_STA }),
      row({ id: 4, category: 'ST', order_date: stare }),
    ]
    const s = summarizeDashboard(rows, [RULE])
    expect(s.technicalOpen).toBe(2)
    expect(s.technicalOverdue).toBe(1)
    expect(s.inProduction).toBe(2)
    expect(s.readyToShip).toBe(1)
    expect(s.overdueTotal).toBe(2)
    expect(s.overdueByCategory).toEqual({ STA: 1, ST: 1 })
  })

  it('bez reguł terminów — zero po terminie', () => {
    const s = summarizeDashboard([row({ id: 1, category: 'ST', order_date: '2020-01-02' })], [])
    expect(s.overdueTotal).toBe(0)
    expect(s.technicalOverdue).toBe(0)
  })

  it('zestaw Titan = jedno zlecenie', () => {
    expect(countLogicalOrders([
      row({ id: 5, category: 'STA', linked_order_id: 6, titan_group: '5' }),
      row({ id: 6, category: 'ST', linked_order_id: 5, titan_group: '5' }),
      row({ id: 7, category: 'Bastion', titan_group: '5' }),
    ])).toBe(1)
  })
})
