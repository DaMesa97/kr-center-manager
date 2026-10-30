import { describe, expect, it } from 'vitest'
import {
  ZKP_ALL_CHECK_KEYS,
  ZKP_MEASUREMENTS,
  fireClassLabel,
  groupDeclarationCandidates,
  nokKeys,
  protocolFormProblems,
  protocolToForm,
  smokeLabel,
  type ZkpDeclarationCandidate,
  type ZkpTestProtocol,
} from '../lib/zkpProtocol'
import type { ZkpProductCard } from '../lib/zkpCard'

const card = {
  id: 1, construction_id: 1, order_id: 1, product_type: 'drzwi_wewn', leaves: 1, opening: 'do_wewnatrz', hand: 'L', range_code: 'EI30',
  evacuation: 'nie', light: 'brak', type_code: 'AS75EI-W-EI30-–-1-–', active_w: 1000, active_h: 2100, passive_w: null, passive_h: null,
  light_w: null, light_h: null, leaf_mass_kg: 80, fill_thickness_mm: 20, hinges_count: 3, pins_count: 2, fill_ref: '', profiles_ref: '',
  threshold_ref: '', mounting_ref: '', profiles_ok: true, threshold_ok: true, hardware_ok: true, mounting_ok: true,
  range_confirmed_at: '2026-10-30', range_confirmed_by_name: 'PJ', range_reopen_reason: '', decision: null, test_protocol_no: '',
  declaration_no: '', nonconformity_ref: '', released_on: null, decision_notes: '', decided_at: null, decided_by_name: '',
} as ZkpProductCard

describe('protokół 6.17.5 — formularz', () => {
  it('22 sprawdzenia B/D/E/F jak we wzorze; klucze pomiarów jak w zkp_protocol_eval', () => {
    expect(ZKP_ALL_CHECK_KEYS).toHaveLength(22)
    expect(ZKP_MEASUREMENTS.map((m) => m.key)).toEqual([
      'frame_w', 'frame_h', 'frame_diag', 'leaf_active', 'leaf_passive', 'light', 'leaf_diag', 'fill_thick', 'fill_dims',
      'gap_zaw', 'gap_zamk', 'gap_nad', 'threshold', 'hinges', 'pins', 'mass',
    ])
  })

  it('pusty formularz: nominały ościeżnicy z LP, dzisiejsza data kontroli', () => {
    const f = protocolToForm(null, { frameW: 1100, frameH: 2200 })
    expect(f.measurements.frame_w?.n).toBe('1100')
    expect(f.measurements.frame_h?.n).toBe('2200')
    expect(f.inspected_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('braki: kontroler, sprawdzenia, pomiary (bez skrzydła biernego i nad-/doświetla dla drzwi 1-skrz. bez światła)', () => {
    const f = protocolToForm(null)
    const p = protocolFormProblems(f, card)
    expect(p[0]).toMatch(/kontrolera/)
    expect(p[1]).toMatch(/B1, B2/)
    expect(p[2]).toMatch(/Pomiary niekompletne/)
    expect(p[2]).not.toMatch(/bierne|Nadświetle/)
  })

  it('komplet = bez braków', () => {
    const f = protocolToForm(null, { frameW: 1100, frameH: 2200 })
    f.inspector = 'ZZ'
    for (const k of ZKP_ALL_CHECK_KEYS) f.checks[k] = 'OK'
    for (const d of ZKP_MEASUREMENTS.filter((m) => !m.when || m.when(card))) {
      f.measurements[d.key] = { ...(f.measurements[d.key] ?? {}), m: d.inputs.map(() => '1'), t: 'x', r: 'OK' }
    }
    expect(protocolFormProblems(f, card)).toEqual([])
  })

  it('nokKeys zbiera NOK ze sprawdzeń i pomiarów', () => {
    const p = {
      checks: { b1: 'OK', d2: 'NOK' },
      eval: [{ sort: 10, key: 'gap_zaw', label: 'Szczeliny — zawiasowa', nominal: '', measured: '', criterion: '', result: 'NOK', auto: true }],
    } as unknown as ZkpTestProtocol
    expect(nokKeys(p)).toEqual(['D2', 'Szczeliny — zawiasowa'])
  })
})

describe('deklaracje 6.9', () => {
  it('grupy = zlecenie × kod typu; rodzaj z typu wyrobu', () => {
    const row = (id: number, order: number, type: string, pt: string): ZkpDeclarationCandidate => ({
      r_order_id: order, r_order_number: `OF${order}`, r_company: 'X', r_construction_id: id, r_construction_no: `2026/01/0${id}`,
      r_type_code: type, r_product_type: pt, r_range_code: 'EI30', r_leaves: 1, r_active_h: 2100, r_passive_h: null, r_released_on: null,
    })
    const g = groupDeclarationCandidates([row(1, 7, 'A', 'drzwi_wewn'), row(2, 7, 'A', 'drzwi_wewn'), row(3, 7, 'B', 'drzwi_zewn'), row(4, 8, 'A', 'drzwi_wewn')])
    expect(g.map((x) => `${x.orderId}|${x.typeCode}|${x.kind}|${x.rows.length}`)).toEqual(['7|A|KDWU|2', '7|B|DWU|1', '8|A|KDWU|1'])
  })

  it('klasa i dymoszczelność na tabliczce', () => {
    expect(fireClassLabel('EI30S')).toBe('EI2 30')
    expect(fireClassLabel('EI60')).toBe('EI2 60')
    expect(fireClassLabel('S')).toBe('—')
    expect(smokeLabel('EI60S')).toBe('S200 / Sa4')
    expect(smokeLabel('EI30')).toBe('—')
  })
})
