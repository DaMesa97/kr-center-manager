import { describe, expect, it } from 'vitest'
import { forecastDataLabel, forecastQuality } from '../lib/forecastQuality'

describe('forecastQuality (D7 b — prognoza orientacyjna)', () => {
  it('pełna historia → full niezależnie od średniej', () => {
    expect(forecastQuality(false, 120)).toBe('full')
    expect(forecastQuality(false, 0)).toBe('full')
  })

  it('za mało danych, ale średnia > 0 → orientacyjnie', () => {
    expect(forecastQuality(true, 1493.7)).toBe('indicative')
    expect(forecastDataLabel('indicative')).toContain('orientacyjnie')
  })

  it('za mało danych i średnia 0 (baza przed migracją) → brak', () => {
    expect(forecastQuality(true, 0)).toBe('none')
    expect(forecastQuality(true, Number.NaN)).toBe('none')
    expect(forecastDataLabel('none')).toBe('Dane: za mało historii')
  })
})
