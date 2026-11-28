import { describe, expect, it } from 'vitest'
import { rebuildSummary } from '../lib/recipeRebuild'

describe('rebuildSummary (D15 — przeliczenie niezrobionych etapów)', () => {
  it('nowa baza: zlecenia w produkcji przeliczone częściowo, nic nie pominięte', () => {
    const r = rebuildSummary('STA', { rebuilt: 92, partial: 47, skipped: 0, failed: 0, failedOrders: [] })
    expect(r.text).toBe('Przeliczono rezerwacje 92 zleceń STA · w tym 47 w produkcji — tylko niezrobione etapy')
    expect(r.variant).toBe('success')
  })

  it('stara baza: pominięte zlecenia z wydaniami', () => {
    const r = rebuildSummary('ST', { rebuilt: 10, partial: 0, skipped: 3, failed: 0, failedOrders: [] })
    expect(r.text).toContain('3 pominięto')
    expect(r.variant).toBe('info')
  })

  it('błędy wygrywają', () => {
    const r = rebuildSummary('ST', { rebuilt: 1, partial: 1, skipped: 0, failed: 2, failedOrders: ['1: x', '2: y'] })
    expect(r.text).toContain('2 z błędem: 1: x; 2: y')
    expect(r.variant).toBe('error')
  })
})
