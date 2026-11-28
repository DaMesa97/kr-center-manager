import { describe, expect, it } from 'vitest'
import { pokazZakresOscieznicy, typOscieznicyZZakresem } from '../lib/bastionZakres'

describe('zakres ościeżnicy Bastion (D33)', () => {
  it('regulowana i zabudowa mają zakres, inne nie', () => {
    expect(typOscieznicyZZakresem('DREWNIANA REGULOWANA')).toBe(true)
    expect(typOscieznicyZZakresem('ZAB.OŚC.METAL.')).toBe(true)
    expect(typOscieznicyZZakresem('zabudowa kątowa')).toBe(true)
    expect(typOscieznicyZZakresem('DREWNIANA PEŁNA')).toBe(false)
    expect(typOscieznicyZZakresem(null)).toBe(false)
  })
  it('pole widoczne także, gdy zakres już jest wpisany', () => {
    expect(pokazZakresOscieznicy('DREWNIANA PEŁNA', '120')).toBe(true)
    expect(pokazZakresOscieznicy('DREWNIANA PEŁNA', ' ')).toBe(false)
    expect(pokazZakresOscieznicy('ZABUDOWA BOLD', '')).toBe(true)
  })
})
