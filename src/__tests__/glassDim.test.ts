import { describe, expect, it } from 'vitest'
import { parseGlassDim } from '../utils'

// Naświetla: wymiar szyby liczy się tylko z prawdziwego "SZER×WYS".
// Stare dane mają "NIE", samo "2080" (dostawka-widmo z importu) albo "380 mm x 2081 mm".

describe('parseGlassDim', () => {
  it('format aplikacji i wariant z małym x', () => {
    expect(parseGlassDim('370×2080')).toEqual([370, 2080])
    expect(parseGlassDim('370x2080')).toEqual([370, 2080])
  })

  it('stary format z migracji (mm, spacje)', () => {
    expect(parseGlassDim('380 mm x 2081 mm')).toEqual([380, 2081])
    expect(parseGlassDim('345 mm x 2080 mm / 345 mm x 2080 mm')).toEqual([345, 2080])
  })

  it('brak pełnego wymiaru: NIE, sama liczba, puste; gwiazdka jako separator', () => {
    expect(parseGlassDim('NIE')).toEqual([0, 0])
    expect(parseGlassDim('2080')[1]).toBe(0)
    expect(parseGlassDim('900*400')).toEqual([900, 400])
    expect(parseGlassDim('')).toEqual([0, 0])
    expect(parseGlassDim(null)).toEqual([0, 0])
  })
})
