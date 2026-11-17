import { describe, expect, it } from 'vitest'
import type { Complaint, Order } from '../types'
import {
  companyNames,
  computeCompanyStats,
  periodStartIso,
  resolveCompanyQuery,
} from '../lib/companyStats'

const NOW = new Date(2026, 10, 17) // 17.11.2026

function order(p: Partial<Order> & { company: string; order_date: string }): Order {
  return {
    id: Math.floor(Math.random() * 1e6),
    order_number: '1',
    category: 'STA',
    model: 'ASTRE 35B',
    wing_color: 'ORZECH',
    quantity: 1,
    ...p,
  } as Order
}

function complaint(p: Partial<Complaint> & { company: string; complaint_date: string }): Complaint {
  return { complaint_number: 'R/1', category: 'STA', ...p } as Complaint
}

describe('companyStats — nazwy i dopasowanie firmy', () => {
  it('companyNames: od najczęstszej, bez anulowanych i pustych', () => {
    const names = companyNames([
      order({ company: 'PO DRZWI', order_date: '2026-11-01' }),
      order({ company: 'PO DRZWI', order_date: '2026-11-02' }),
      order({ company: 'MAXDOOR', order_date: '2026-11-02' }),
      order({ company: 'ANULOWANA', order_date: '2026-11-02', extra_fields: { cancelled: true } }),
      order({ company: '  ', order_date: '2026-11-02' }),
    ])
    expect(names).toEqual([
      { name: 'PO DRZWI', count: 2 },
      { name: 'MAXDOOR', count: 1 },
    ])
  })

  it('resolveCompanyQuery: dokładne trafienie wygrywa, inaczej „zawiera”', () => {
    const names = ['PO DRZWI', 'PO DRZWI ŻORY', 'MAXDOOR']
    expect(resolveCompanyQuery('po drzwi', names)).toEqual(['PO DRZWI'])
    expect(resolveCompanyQuery('drzwi', names)).toEqual(['PO DRZWI', 'PO DRZWI ŻORY'])
    expect(resolveCompanyQuery('', names)).toEqual([])
    expect(resolveCompanyQuery('xyz', names)).toEqual([])
  })

  it('periodStartIso: pierwszy dzień miesiąca sprzed N−1 miesięcy, 0 = bez ograniczenia', () => {
    expect(periodStartIso(12, NOW)).toBe('2025-12-01')
    expect(periodStartIso(3, NOW)).toBe('2026-09-01')
    expect(periodStartIso(0, NOW)).toBeNull()
  })
})

describe('computeCompanyStats', () => {
  const orders: Order[] = [
    order({ company: 'PO DRZWI', order_date: '2026-11-02', release_date: '2026-11-12', quantity: 2, source: 'bot' }),
    order({ company: 'PO DRZWI', order_date: '2026-10-05', release_date: '2026-10-25', model: 'OTELLO 01', wing_color: 'ANTRACYT' }),
    order({ company: 'PO DRZWI', order_date: '2026-11-10', category: 'Disting', model: 'TORINO 13B' }), // w realizacji
    order({ company: 'PO DRZWI', order_date: '2025-01-10', release_date: '2025-02-01' }), // poza 12 mies.
    order({ company: 'PO DRZWI', order_date: '2026-11-11', extra_fields: { cancelled: true } }), // anulowane
    order({ company: 'MAXDOOR', order_date: '2026-11-11' }),
  ]
  const complaints: Complaint[] = [
    complaint({ company: 'PO DRZWI', complaint_date: '2026-11-13' }),
    complaint({ company: 'PO DRZWI', complaint_date: '2024-06-01' }), // poza okresem
    complaint({ company: 'MAXDOOR', complaint_date: '2026-11-13' }),
  ]

  it('liczy KPI za 12 miesięcy tylko dla wskazanej firmy, bez anulowanych', () => {
    const s = computeCompanyStats(orders, complaints, ['PO DRZWI'], 12, NOW)
    expect(s.orders).toBe(3)
    expect(s.pieces).toBe(4)
    expect(s.open).toBe(1)
    expect(s.released).toBe(2)
    expect(s.fromConfigurator).toBe(1)
    expect(s.complaints).toBe(1)
    expect(s.complaintsPer100).toBe(33.3)
    expect(s.leadCount).toBe(2)
    expect(s.avgDays).toBe(15) // (10 + 20) / 2
    expect(s.medianDays).toBe(15)
    expect(s.lastOrderDate).toBe('2026-11-10')
    expect(s.byCategory).toEqual([
      { name: 'STA', value: 3 },
      { name: 'Disting', value: 1 },
    ])
    expect(s.topModels[0]).toEqual({ name: 'ASTRE 35B', value: 2 })
    expect(s.recent.map((o) => o.order_date)).toEqual(['2026-11-10', '2026-11-02', '2026-10-05'])
  })

  it('byMonth ma 12 kubełków z zerami i sumuje sztuki, zlecenia i reklamacje', () => {
    const s = computeCompanyStats(orders, complaints, ['PO DRZWI'], 12, NOW)
    expect(s.byMonth).toHaveLength(12)
    expect(s.byMonth[0].month).toBe('2025-12')
    expect(s.byMonth[11]).toEqual({ month: '2026-11', qty: 3, orders: 2, complaints: 1 })
    expect(s.byMonth[10]).toEqual({ month: '2026-10', qty: 1, orders: 1, complaints: 0 })
  })

  it('cały okres (0): bierze wszystko, miesiące tylko te, w których coś było', () => {
    const s = computeCompanyStats(orders, complaints, ['PO DRZWI'], 0, NOW)
    expect(s.orders).toBe(4)
    expect(s.complaints).toBe(2)
    expect(s.byMonth.map((r) => r.month)).toEqual(['2024-06', '2025-01', '2026-10', '2026-11'])
  })

  it('anulowana reklamacja nie liczy się', () => {
    const s = computeCompanyStats(orders, [...complaints, complaint({ company: 'PO DRZWI', complaint_date: '2026-11-14', extra_fields: { cancelled: true } })], ['PO DRZWI'], 12, NOW)
    expect(s.complaints).toBe(1)
  })

  it('kilka wariantów nazwy liczy się razem', () => {
    const s = computeCompanyStats(
      [...orders, order({ company: 'PO DRZWI ŻORY', order_date: '2026-11-12', quantity: 5 })],
      complaints,
      ['PO DRZWI', 'PO DRZWI ŻORY'],
      12,
      NOW,
    )
    expect(s.orders).toBe(4)
    expect(s.pieces).toBe(9)
  })
})
