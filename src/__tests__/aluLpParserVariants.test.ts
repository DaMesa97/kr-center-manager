import { describe, expect, it } from 'vitest'
import { parseAluDocument, parseOuterDims } from '../lib/aluLpParser'
import type { AluLpParseResult, AluZmParseResult, PdfTextPage } from '../types'
import lpAs52 from './fixtures/alu/LP_0003_03_2026.json'
import lpBlockB from './fixtures/alu/LP_0002_04_2026.json'
import lpMulti from './fixtures/alu/LP_0001_04_2026.json'
import lcAs52 from './fixtures/alu/LC_0002_03_2026.json'
import lcBlockB from './fixtures/alu/LC_0002_04_2026.json'
import lcMulti from './fixtures/alu/LC_0001_04_2026.json'
import zm from './fixtures/alu/ZM_GLASS_0003_09_2026.json'

// Kolejne prawdziwe PDF-y z AluronCAD (Tymek, 23.10) — każdy łamał parser inaczej.

const lp = (f: unknown) => parseAluDocument(structuredClone(f) as PdfTextPage[]) as AluLpParseResult

describe('LP 0003/03 — AS52, dwie ościeżnice (drzwiowa + okienna)', () => {
  const res = lp(lpAs52)
  const p = res.positions[0]

  it('wymiar z ZEWNĘTRZNEJ ościeżnicy (drzwiowej 2500×3100), nie okiennej 1061', () => {
    expect([p.width_mm, p.height_mm]).toEqual([2500, 3100])
    expect(p.warnings).toEqual([])
  })
  it('klient bez końcówki terminu realizacji, termin kompletny', () => {
    expect(res.header.client).toBe('GPPL Żory')
    expect(res.header.deadline_text).toBe('Wyznaczany indywidualnie, po ustaleniu szczegółów zamówienia.')
  })
})

describe('LP 0002/04 — układ B (bez „Poz.:”, Wymiar zewnętrzny konstrukcji)', () => {
  const res = lp(lpBlockB)
  const p = res.positions[0]

  it('wymiar z „Wymiar zewnętrzny konstrukcji: 2 360 mm x 2 590 mm”', () => {
    expect([p.width_mm, p.height_mm]).toEqual([2360, 2590])
  })
  it('opis złożony z uwag (typ, otwieranie, kierunek), system bez „ALURON”', () => {
    expect(p.description).toBe('AS75 - drzwi jednoskrzydłowe, otwierane do wewnątrz, lewe')
    expect(p.construction_type).toBe('drzwi')
    expect(p.system).toBe('AS75')
    expect(p.profile_color).toBe('10/AR-RAL8019-MAT')
  })
  it('zawiasy i „Okucia i dodatki” w okuciach, kierunek nie dubluje się w „inne”', () => {
    expect(p.notes.okucia).toMatch(/^3 zawiasy/)
    expect(p.notes.okucia).toContain('Zamek pomocniczy WILKA')
    expect(p.notes.inne ?? '').not.toMatch(/Kierunek|Typ konstrukcji/)
  })
  it('zawinięta nazwa szkła nie staje się osobnym kodem („bezpieczne”)', () => {
    expect(p.glass.map((g) => g.spec)).toEqual(Array(4).fill('33.1T/18AR/33.1T'))
    expect(p.warnings).toEqual([])
  })
})

describe('LP 0001/04 — 4 pozycje na 24 stronach, ilości > 1', () => {
  const res = lp(lpMulti)

  it('wszystkie pozycje z blokiem (strony bez nagłówka LP też)', () => {
    expect(res.positions.map((p) => p.pos_no)).toEqual([1, 2, 3, 4])
    expect(res.positions.every((p) => p.system === 'AS75')).toBe(true)
  })
  it('ilości i wymiary zgadzają się z powierzchnią całego LP (49,4 m²)', () => {
    expect(res.positions.map((p) => p.quantity)).toEqual([5, 4, 1, 2])
    const area = res.positions.reduce((s, p) => s + ((p.width_mm ?? 0) * (p.height_mm ?? 0) * p.quantity) / 1e6, 0)
    expect(area).toBeCloseTo(res.header.area_m2 ?? 0, 0)
  })
  it('szkło „1x5 szt” = sztuki na jedną konstrukcję, bez ostrzeżeń', () => {
    expect(res.positions[0].glass.map((g) => g.qty)).toEqual([1, 1])
    expect(res.positions.flatMap((p) => p.warnings)).toEqual([])
  })
})

describe('LC — numer zlecenia z kolejnych list cięcia', () => {
  it.each([
    [lcAs52, 'LC 0002/03/2026', 'OF149/2025'],
    [lcBlockB, 'LC 0002/04/2026', 'OF318/2026'],
    [lcMulti, 'LC 0001/04/2026', 'OF328/2026'],
  ])('%#', (f, lcNo, of) => {
    const res = parseAluDocument(structuredClone(f) as PdfTextPage[])
    expect(res).toMatchObject({ kind: 'LC', lc_number: lcNo, order_number: of })
  })
})

describe('ZM GLASS — zamówienie szyb', () => {
  const res = parseAluDocument(structuredClone(zm) as PdfTextPage[]) as AluZmParseResult

  it('rozpoznany po treści, numer bez dostawcy, dostawca osobno', () => {
    expect(res.kind).toBe('ZM')
    expect(res.zm_number).toBe('ZM_GLASS 0003/09/2026')
    expect(res.supplier).toBe('Vitroszlif')
  })
  it('numer zlecenia z „Położenie szkła” (OF270/2026:1:4), bez duplikatów; liczba szyb', () => {
    expect(res.order_numbers).toEqual(['OF270/2026'])
    expect(res.panes).toBe(4)
  })
})

describe('parseOuterDims', () => {
  it('spacja jako separator tysięcy, brak = null', () => {
    expect(parseOuterDims('1 460 mm x 2 090 mm')).toEqual({ width_mm: 1460, height_mm: 2090 })
    expect(parseOuterDims('950 mm x 2100 mm')).toEqual({ width_mm: 950, height_mm: 2100 })
    expect(parseOuterDims('')).toBeNull()
  })
})
