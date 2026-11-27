import { describe, expect, it } from 'vitest'
import { buildDoorGrid, gridItems, parseFrame, parseWing, type GridAttrs } from '../lib/doorStockGrid'

const w = (name: string, model: string | null, color: string | null, size: string | null, dir: string | null): GridAttrs => ({
  name, product_category: 'door_wing', door_model: model, door_color: color, door_size: size, door_direction: dir,
})
const f = (name: string): GridAttrs => ({ name, product_category: 'door_frame' })

describe('parseWing', () => {
  it('pola kartoteki: rodzina, numer, kolor, szerokość, kierunek', () => {
    expect(parseWing(w('SKRZYDŁO WEW MALEO BLACK 02 BIAŁY 60L', 'MALEO BLACK 02', 'BIAŁY', '60', 'L'))).toEqual({
      family: 'MALEO BLACK', number: '02', color: 'BIAŁY', size: '60', dir: 'L', variant: '',
    })
  })
  it('rozmiar i szklenie w kolorze', () => {
    expect(parseWing(w('SKRZYDŁO WEW MODERNA 02 BIAŁY 70P (szklenie satyna)', 'MODERNA 02', 'BIAŁY 70P (szklenie satyna)', null, null))).toEqual({
      family: 'MODERNA', number: '02', color: 'BIAŁY', size: '70', dir: 'P', variant: '(szklenie satyna)',
    })
    expect(parseWing(w('DRZWI TECHNICZNE UNI-45 ANTRACYT 100', 'TECHNICZNE UNI-45', 'ANTRACYT 100', null, null))).toMatchObject({
      family: 'TECHNICZNE', number: 'UNI-45', color: 'ANTRACYT', size: '100', dir: '',
    })
  })
  it('bez pól — z nazwy (przesuwne, NORMA, NSTD)', () => {
    expect(parseWing(w('SKRZYDŁO WEW MALEO 06 DĄB WIOSENNY 80 PRZESUWNE', null, null, null, null))).toEqual({
      family: 'MALEO', number: '06', color: 'DĄB WIOSENNY', size: '80', dir: '', variant: 'PRZESUWNE',
    })
    expect(parseWing(w('SKRZYDŁO WEW NORMA CZ-SK CLASSIC 01 BIAŁY PRO 70P', null, null, null, null))).toMatchObject({
      family: 'NORMA CZ-SK CLASSIC', number: '01', color: 'BIAŁY PRO', size: '70', dir: 'P',
    })
    expect(parseWing(w('DRZWI TECHNIC 01 BIAŁY 100P', null, null, null, null))).toMatchObject({ family: 'TECHNIC', number: '01', size: '100', dir: 'P' })
  })
  it('coś innego niż skrzydło → null', () => {
    expect(parseWing(w('ĆWIERĆWAŁEK BIAŁY', null, null, null, null))).toBeNull()
  })
})

describe('parseFrame', () => {
  it('baza i belka ościeżnicy regulowanej / ORS / prostej', () => {
    expect(parseFrame(f('BAZA OR5 (220-260) BIAŁY LEWA'))).toEqual({ family: 'OŚCIEŻNICA REGULOWANA OR', color: 'BIAŁY', row: 'OR5 (220-260)', rowSort: 220, col: 'BAZA LEWA' })
    expect(parseFrame(f('BELKA ORS2-90(100-140) KASZMIR PREMIUM 90'))).toMatchObject({ family: 'ORS-90', color: 'KASZMIR PREMIUM', row: 'ORS2-90 (100-140)', col: 'BELKA 90' })
    expect(parseFrame(f('BELKA OŚCIEŻNICY PROSTEJ SONOMA 60'))).toMatchObject({ family: 'OŚCIEŻNICA PROSTA', color: 'SONOMA', col: 'BELKA 60' })
    expect(parseFrame(f('BAZA NORMA CZ-SK OR2 (100-140) BIAŁY PRO LEWA'))).toMatchObject({ family: 'NORMA CZ-SK OR', color: 'BIAŁY PRO' })
  })
})

describe('buildDoorGrid', () => {
  const items: GridAttrs[] = [
    w('SKRZYDŁO WEW CLASSIC 01 BIAŁY 80P', 'CLASSIC 01', 'BIAŁY', '80', 'P'),
    w('SKRZYDŁO WEW CLASSIC 01 BIAŁY 60L', 'CLASSIC 01', 'BIAŁY', '60', 'L'),
    w('SKRZYDŁO WEW CLASSIC 01 BIAŁY 80L', 'CLASSIC 01', 'BIAŁY', '80', 'L'),
    w('SKRZYDŁO WEW ALBERO 03 SONOMA 70L', 'ALBERO 03', 'SONOMA', '70', 'L'),
    w('SKRZYDŁO NSTD ALBERO 01 SONOMA 60P', 'ALBERO 01', 'SONOMA', '60', 'P'),
    w('SKRZYDŁO WEW MALEO 02 BIAŁY 70L', 'MALEO 02', 'BIAŁY', '70', 'L'),
    f('BELKA OR1 (80-100) BIAŁY 80'),
    f('BAZA OR1 (80-100) BIAŁY PRAWA'),
    f('BAZA OR2 (100-140) BIAŁY LEWA'),
    { name: 'ĆWIERĆWAŁEK BIAŁY', product_category: 'door_frame' },
    { name: 'SYSTEM PRZESUWNY (do skrzydeł przesuwnych)', product_category: 'door_accessory' },
  ]
  const grid = buildDoorGrid(items, (x) => x)

  it('zakładki w kolejności starego pliku; ALBERO i CLASSIC razem w PŁYTOWE', () => {
    expect(grid.map((s) => s.name)).toEqual(['PŁYTOWE', 'MALEO', 'OŚCIEŻNICE', 'LISTWY', 'POZOSTAŁE'])
    expect(grid[0].blocks.map((b) => b.title)).toEqual(['ALBERO SONOMA', 'CLASSIC BIAŁY'])
  })
  it('blok skrzydeł: tabelki per numer, wiersze szerokość, kolumny LEWA/PRAWA', () => {
    const albero = grid[0].blocks[0]
    expect(albero.tables.map((t) => t.label)).toEqual(['01', '03'])
    const classic = grid[0].blocks[1].tables[0]
    expect(classic.columns).toEqual(['LEWA', 'PRAWA'])
    expect(classic.rows.map((r) => r.label)).toEqual(['60', '80'])
    expect(classic.rows[1].cells.map((c) => c?.name)).toEqual(['SKRZYDŁO WEW CLASSIC 01 BIAŁY 80L', 'SKRZYDŁO WEW CLASSIC 01 BIAŁY 80P'])
    expect(classic.rows[0].cells[1]).toBeNull()
  })
  it('ościeżnice: profil × BAZA L/P, BELKA szerokości', () => {
    const t = grid[2].blocks[0].tables[0]
    expect(grid[2].blocks[0].title).toBe('OŚCIEŻNICA REGULOWANA OR BIAŁY')
    expect(t.columns).toEqual(['BAZA LEWA', 'BAZA PRAWA', 'BELKA 80'])
    expect(t.rows.map((r) => r.label)).toEqual(['OR1 (80-100)', 'OR2 (100-140)'])
  })
  it('każda pozycja dokładnie raz', () => {
    const all = gridItems(grid)
    expect(all).toHaveLength(items.length)
    expect(new Set(all).size).toBe(items.length)
  })
})
