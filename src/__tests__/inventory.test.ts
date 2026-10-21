import { describe, expect, it } from 'vitest'
import { inventoryReview, parseCountInput } from '../lib/inventory'
import type { InventoryLine } from '../types'

const line = (id: number, system: number, counted: number | null): InventoryLine => ({
  id,
  session_id: 1,
  component_id: 100 + id,
  system_qty: system,
  counted_qty: counted,
  notes: null,
  component_name: `K${id}`,
})

describe('parseCountInput — pole "Policzono"', () => {
  it('puste = niepoliczone (null)', () => {
    expect(parseCountInput('')).toEqual({ ok: true, value: null })
    expect(parseCountInput('   ')).toEqual({ ok: true, value: null })
    expect(parseCountInput(null)).toEqual({ ok: true, value: null })
  })

  it('liczby, w tym ułamki z przecinkiem i zero', () => {
    expect(parseCountInput('12')).toEqual({ ok: true, value: 12 })
    expect(parseCountInput('2,5')).toEqual({ ok: true, value: 2.5 })
    expect(parseCountInput('0')).toEqual({ ok: true, value: 0 })
  })

  it('ujemne i śmieci = błąd (nie zapisujemy po cichu jako puste)', () => {
    expect(parseCountInput('-1')).toEqual({ ok: false })
    expect(parseCountInput('abc')).toEqual({ ok: false })
  })
})

describe('inventoryReview — różnice do zatwierdzenia z linii z bazy', () => {
  it('pomija zgodne, liczy niepoliczone, korekta = policzono − system', () => {
    const r = inventoryReview([line(1, 10, 10), line(2, 10, 7), line(3, 0, 4), line(4, 5, null)])
    expect(r.uncounted).toBe(1)
    expect(r.diffs.map((d) => [d.line.id, d.diff])).toEqual([[2, -3], [3, 4]])
  })

  it('ułamki: brak fałszywej korekty z błędu zmiennoprzecinkowego', () => {
    const r = inventoryReview([line(1, 0.3, 0.1 + 0.2), line(2, 5.5, 2.5)])
    expect(r.diffs.map((d) => d.diff)).toEqual([-3])
  })

  it('policzone 0 przy stanie > 0 to korekta (nie "niepoliczone")', () => {
    const r = inventoryReview([line(1, 4, 0)])
    expect(r.uncounted).toBe(0)
    expect(r.diffs[0].diff).toBe(-4)
  })
})
