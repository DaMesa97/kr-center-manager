import { describe, expect, it } from 'vitest'
import {
  zkpCanDecide,
  zkpCanReceive,
  zkpScanPath,
  zkpSupplierState,
  zkpWillForceQuarantine,
  type ZkpSupplierAssessment,
} from '../lib/zkp'

const assessment = (o: Partial<ZkpSupplierAssessment>): ZkpSupplierAssessment => ({
  id: 1, supplier_id: 1, kind: 'okresowa', assessed_on: '2026-01-01', result: 'pozytywna', notes: '',
  next_assessment_on: null, created_at: '', created_by_name: '', ...o,
})
const qual = { supplier_id: 1, scope: 'wkłady', is_critical: true, required_quality_doc: 'DWU', updated_at: '', updated_by_name: '' }

describe('ZKP etap F — reguły widoku (lustro funkcji bazy)', () => {
  it('kwarantanna wymuszona przy „przyjęto” bez nr partii albo bez dokumentu jakości', () => {
    const base = { decision: 'przyjeto' as const, lot_no: 'P1', quality_doc_no: 'DWU/1', hasScan: false }
    expect(zkpWillForceQuarantine(base)).toBe(false)
    expect(zkpWillForceQuarantine({ ...base, lot_no: ' ' })).toBe(true)
    expect(zkpWillForceQuarantine({ ...base, quality_doc_no: '' })).toBe(true)
    expect(zkpWillForceQuarantine({ ...base, quality_doc_no: '', hasScan: true })).toBe(false)
    expect(zkpWillForceQuarantine({ ...base, decision: 'kwarantanna', lot_no: '' })).toBe(false)
  })

  it('dostawca kwalifikowany = na wykazie + ostatnia ocena pozytywna/warunkowa', () => {
    const today = '2026-10-26'
    expect(zkpSupplierState(undefined, [assessment({})], today).qualified).toBe(false)
    expect(zkpSupplierState(qual, [], today).qualified).toBe(false)
    const lastNegative = [assessment({ id: 1, assessed_on: '2026-01-01' }), assessment({ id: 2, assessed_on: '2026-06-01', result: 'negatywna' })]
    expect(zkpSupplierState(qual, lastNegative, today).qualified).toBe(false)
    expect(zkpSupplierState(qual, [assessment({ result: 'warunkowa' })], today).qualified).toBe(true)
  })

  it('termin kolejnej oceny: po terminie / w ciągu 30 dni / później', () => {
    const today = '2026-10-26'
    expect(zkpSupplierState(qual, [assessment({ next_assessment_on: '2026-10-01' })], today).dueStatus).toBe('overdue')
    expect(zkpSupplierState(qual, [assessment({ next_assessment_on: '2026-11-20' })], today).dueStatus).toBe('soon')
    expect(zkpSupplierState(qual, [assessment({ next_assessment_on: '2027-06-01' })], today).dueStatus).toBe('ok')
    expect(zkpSupplierState(qual, [assessment({})], today).dueStatus).toBe('none')
  })

  it('role: magazyn przyjmuje, decyduje tylko Pełnomocnik / Zastępca', () => {
    expect(zkpCanReceive(['magazyn'])).toBe(true)
    expect(zkpCanDecide(['magazyn'])).toBe(false)
    expect(zkpCanDecide(['zastepca'])).toBe(true)
    expect(zkpCanReceive(['kontroler'])).toBe(false)
    expect(zkpCanReceive(undefined)).toBe(false)
  })

  it('ścieżka skanu bez polskich znaków i spacji', () => {
    const p = zkpScanPath('Świadectwo 3.1 – łożyska.PDF', new Date(2026, 9, 26, 12))
    expect(p).toMatch(/^przyjecia\/2026\/\d+_Swiadectwo_3_1_lozyska\.pdf$/)
  })
})
