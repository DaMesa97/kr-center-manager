import { describe, expect, it } from 'vitest'
import { parseAluMaterialListRows, parseListNumber, sameAluOrderNumber } from '../lib/aluMaterialListParser'
import fixture from './fixtures/alu/LM_OF348_2026.json'

describe('sameAluOrderNumber', () => {
  it('ten sam OF także dla duplikatu „ (2)", inny OF i pusty → nie', () => {
    expect(sameAluOrderNumber('OF348/2026', 'OF348/2026')).toBe(true)
    expect(sameAluOrderNumber('OF348/2026', 'OF348/2026 (2)')).toBe(true)
    expect(sameAluOrderNumber('of348/2026', 'OF348/2026')).toBe(true)
    expect(sameAluOrderNumber('OF348/2026', 'OF341/2026')).toBe(false)
    expect(sameAluOrderNumber('', '')).toBe(false)
  })
})

describe('parseListNumber', () => {
  it('format z eksportu Aluron i polski', () => {
    expect(parseListNumber('1,625.35')).toBe(1625.35)
    expect(parseListNumber('1 625,35')).toBe(1625.35)
    expect(parseListNumber('4')).toBe(4)
    expect(parseListNumber('')).toBeNull()
    expect(parseListNumber('abc')).toBeNull()
  })
})

describe('Lista materiałowa OF348/2026 (Aluron .xls)', () => {
  const res = parseAluMaterialListRows(fixture.rows)

  it('nagłówek: numer zlecenia i data', () => {
    expect(res.order_number).toBe('OF348/2026')
    expect(res.created_at).toBe('2026-10-26')
  })

  it('wszystkie pozycje z grupami, sumy grup i całości bez ostrzeżeń', () => {
    expect(res.items).toHaveLength(49)
    expect(res.warnings).toEqual([])
    expect(res.total_value).toBe(3988.61)
    expect(res.total_need_value).toBe(2873.71)
    expect(new Set(res.items.map((i) => i.group)).size).toBe(7)
  })

  it('pozycja profilu: kod, opis, jednostka, potrzeba bez odpadów', () => {
    const p = res.items.find((i) => i.code === 'P2412 10/AR-RAL7016-MAT')
    expect(p).toMatchObject({
      group: 'Profile zespolone lakierowane AS',
      description: 'Ościeżnica Drzwiowa 69',
      quantity: 1,
      unit: 'sztanga(6500mm)',
      value: 600.86,
      need_net: 5.315,
    })
  })

  it('pozycja w opakowaniu i grupa „???" też są czytane', () => {
    expect(res.items.find((i) => i.code === 'U103')).toMatchObject({ unit: 'opak.(25m)', need_net: 0.97 })
    expect(res.items.find((i) => i.code === 'Q-Tape 50')?.group).toBe('???')
  })

  it('pusty arkusz → ostrzeżenia, nie wyjątek', () => {
    const empty = parseAluMaterialListRows([])
    expect(empty.items).toEqual([])
    expect(empty.warnings.length).toBeGreaterThan(0)
  })
})
