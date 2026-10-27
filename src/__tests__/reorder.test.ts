import { describe, expect, it } from 'vitest'
import { computeReorder, roundToPallets } from '../lib/reorder'

describe('computeReorder — status i sugerowana ilość', () => {
  it('bez progu = brak statusu i sugestii', () => {
    expect(computeReorder({ stock: 5, incoming: 0, min: null, target: 10, unitsPerPallet: null })).toEqual({
      position: 5, status: 'no_threshold', suggested: null,
    })
  })

  it('poniżej min = PILNE, uzupełnienie do targetu', () => {
    expect(computeReorder({ stock: -10, incoming: 0, min: 85, target: 143, unitsPerPallet: null })).toEqual({
      position: -10, status: 'critical', suggested: 153,
    })
  })

  it('towar w drodze liczy się do pozycji — po wygenerowaniu ZD SKU nie jest już PILNE', () => {
    const r = computeReorder({ stock: -10, incoming: 153, min: 85, target: 143, unitsPerPallet: null })
    expect(r.position).toBe(143)
    expect(r.status).toBe('ok')
    expect(r.suggested).toBeNull()
  })

  it('obserwuj do 1,5 × min; palety zaokrąglane w górę', () => {
    const r = computeReorder({ stock: 100, incoming: 0, min: 80, target: 200, unitsPerPallet: 24 })
    expect(r.status).toBe('observe')
    expect(r.suggested).toBe(120) // 100 → 5 palet × 24
  })

  it('bez targetu: 4 × min; OK z brakiem do targetu = podpowiedź, bez braku = nic', () => {
    expect(computeReorder({ stock: 10, incoming: 0, min: 20, target: null, unitsPerPallet: null }).suggested).toBe(70)
    expect(computeReorder({ stock: 150, incoming: 0, min: 80, target: 200, unitsPerPallet: null }).suggested).toBe(50)
    expect(computeReorder({ stock: 250, incoming: 0, min: 80, target: 200, unitsPerPallet: null }).suggested).toBeNull()
  })

  it('roundToPallets', () => {
    expect(roundToPallets(25, 24)).toBe(48)
    expect(roundToPallets(25, null)).toBe(25)
    expect(roundToPallets(25, 0)).toBe(25)
  })
})
