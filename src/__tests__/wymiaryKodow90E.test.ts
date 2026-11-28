// D32 (28.11): właściciel — „90E TO INNY WYMIAR NIŻ 90”. Słownik wymiarów (dimension_map) dobierał
// pierwszy kod ZAWARTY w szerokości: „90E UNI” → „90”, „90E TITAN” → „90E”, „90 ST55E” → „90 ST55”.
// Dane jak w bazie (stan 28.11, kolejność jak w useConfig: kategoria, kod).
import { describe, expect, it } from 'vitest'
import { calcExtensionDims, getDimensions } from '../utils'
import type { DimensionMap } from '../types'

const d = (id: number, category: string, dimension_code: string, width_mm: number, height_mm: number): DimensionMap =>
  ({ id, category, dimension_code, width_mm, height_mm }) as DimensionMap

const mapa: DimensionMap[] = [
  d(39, 'ST', '100E', 1100, 2071),
  d(40, 'ST', '80 ST55', 895, 2062),
  d(42, 'ST', '80 ST55E', 895, 2062),
  d(37, 'ST', '80N', 877, 2051),
  d(41, 'ST', '90 ST55', 1000, 2072),
  d(43, 'ST', '90 ST55E', 1000, 2070),
  d(38, 'ST', '90E', 1000, 2071),
  d(19, 'STA', '100T', 1080, 2080),
  d(16, 'STA', '80E', 920, 2080),
  d(36, 'STA', '80N TITAN', 880, 2050),
  d(17, 'STA', '90E', 1020, 2080),
  d(35, 'STA', '90E TITAN', 1000, 2070),
  d(18, 'STA', '90T', 980, 2080),
  d(30, 'Techniczne', '100', 1078, 2052),
  d(34, 'Techniczne', '100E UNI', 1083, 2038),
  d(27, 'Techniczne', '70', 778, 2052),
  d(31, 'Techniczne', '70 UNI', 777, 2038),
  d(28, 'Techniczne', '80', 878, 2052),
  d(32, 'Techniczne', '80 UNI', 877, 2038),
  d(29, 'Techniczne', '90', 978, 2052),
  d(33, 'Techniczne', '90E UNI', 983, 2038),
]

describe('getDimensions — „90E” to nie „90”', () => {
  it('dokładny kod wygrywa z krótszym kodem zawartym w szerokości', () => {
    expect(getDimensions(mapa, 'Techniczne', '90E UNI')).toEqual({ width_mm: 983, height_mm: 2038 })
    expect(getDimensions(mapa, 'Techniczne', '100E UNI')).toEqual({ width_mm: 1083, height_mm: 2038 })
    expect(getDimensions(mapa, 'Techniczne', '80 UNI')).toEqual({ width_mm: 877, height_mm: 2038 })
    expect(getDimensions(mapa, 'STA', '90E TITAN')).toEqual({ width_mm: 1000, height_mm: 2070 })
    expect(getDimensions(mapa, 'ST', '90 ST55E')).toEqual({ width_mm: 1000, height_mm: 2070 })
  })

  it('zwykłe szerokości jak dotąd', () => {
    expect(getDimensions(mapa, 'Techniczne', '90')).toEqual({ width_mm: 978, height_mm: 2052 })
    expect(getDimensions(mapa, 'STA', '90E')).toEqual({ width_mm: 1020, height_mm: 2080 })
    expect(getDimensions(mapa, 'STA', ' 90e ')).toEqual({ width_mm: 1020, height_mm: 2080 })
    expect(getDimensions(mapa, 'ST', '80N')).toEqual({ width_mm: 877, height_mm: 2051 })
  })

  it('„90E” bez własnego kodu NIE bierze wymiarów „90” (ani „80N” z „80”)', () => {
    expect(getDimensions(mapa, 'Techniczne', '90E')).toEqual({ width_mm: 0, height_mm: 2080 })
    expect(getDimensions(mapa, 'Techniczne', '80N')).toEqual({ width_mm: 0, height_mm: 2080 })
    expect(getDimensions(mapa, 'ST', '90')).toEqual({ width_mm: 0, height_mm: 2080 })
  })

  it('kod jako cały token w dłuższym zapisie (z dopiskiem) dalej pasuje', () => {
    expect(getDimensions(mapa, 'STA', '90E / PRAWE')).toEqual({ width_mm: 1020, height_mm: 2080 })
    expect(getDimensions(mapa, 'Techniczne', '90E UNI LEWE')).toEqual({ width_mm: 983, height_mm: 2038 })
  })

  it('calcExtensionDims: górny wymiar naświetla z właściwego kodu', () => {
    expect(calcExtensionDims('90E UNI', 'STD', 'Techniczne', mapa).topDim).toBe('983')
    expect(calcExtensionDims('90E TITAN', 'STD', 'STA', mapa).topDim).toBe('1000')
  })
})
