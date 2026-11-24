import { describe, expect, it } from 'vitest'
import { computeReorder, orderLot, roundToLot, roundToPallets } from '../lib/reorder'

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

  it('#168 minimum logistyczne: wygrywa z paletą, puste = paleta, bez obu = sztuki', () => {
    expect(orderLot(8, 24)).toBe(8)
    expect(orderLot(null, 24)).toBe(24)
    expect(orderLot(null, null)).toBeNull()
    expect(orderLot(0, 24)).toBe(24)
    expect(roundToLot(1, 8, 24)).toBe(8)      // „1 skrzydło” → partia 8
    expect(roundToLot(9, 8, 24)).toBe(16)
    expect(roundToLot(1, null, 24)).toBe(24)  // bez minimum logistycznego jak dotąd: pełna paleta
    expect(roundToLot(1, null, null)).toBe(1)
  })

  it('#168 sugestia ROP zaokrąglona do minimum logistycznego zamiast palety', () => {
    const r = computeReorder({ stock: 100, incoming: 0, min: 80, target: 200, unitsPerPallet: 24, orderMultiple: 12 })
    expect(r.status).toBe('observe')
    expect(r.suggested).toBe(108) // 100 → 9 × 12 (wcześniej 120 = 5 palet)
    const bez = computeReorder({ stock: 100, incoming: 0, min: 80, target: 200, unitsPerPallet: 24 })
    expect(bez.suggested).toBe(120)
  })
})
