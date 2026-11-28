// Noc 28.11: test przed wydzieleniem wspólnych formaterów magazynu (zachowanie identyczne z dawnymi kopiami).
import { describe, expect, it } from 'vitest'
import { componentOptionLabel, formatIlosc } from '../lib/magazynFormat'
import type { WarehouseComponent } from '../types'

describe('magazynFormat', () => {
  it('formatIlosc: całkowite bez kropki, ułamki bez zbędnych zer, maks. 3 miejsca', () => {
    expect(formatIlosc(5)).toBe('5')
    expect(formatIlosc(1.25)).toBe('1.25')
    expect(formatIlosc(1.2)).toBe('1.2')
    expect(formatIlosc(0.12345)).toBe('0.123')
    expect(formatIlosc(-2.5)).toBe('-2.5')
    expect(formatIlosc(0)).toBe('0')
  })
  it('componentOptionLabel: „KOD — Nazwa (jm)”', () => {
    expect(componentOptionLabel({ code: 'K1', name: 'Klamka', unit: 'szt' } as WarehouseComponent)).toBe('K1 — Klamka (szt)')
  })
})
