import { describe, expect, it } from 'vitest'
import {
  aluOverwriteIsBlocked,
  formatAluOverwriteRow,
  groupAluOverwriteImpact,
  mapAluOverwriteImpactRows,
} from '../lib/aluOverwriteImpact'

// D55: podgląd skutków „Nadpisz” nowej wersji LP (wiersze z RPC alu_overwrite_impact)
describe('D55: skutki nadpisania LP', () => {
  const rpc = [
    { r_kind: 'karta_zwolniona', r_pos_no: 1, r_construction_no: '2026/12/01', r_detail: 'karta ZWOLNIONA 28.11.2026', r_blocking: true },
    { r_kind: 'pozycja_usunieta', r_pos_no: 2, r_construction_no: null, r_detail: 'ilość 2; oznaczone etapy: Cięcie 2', r_blocking: false },
    { r_kind: 'konstrukcja_anulowana', r_pos_no: 2, r_construction_no: '2026/12/04', r_detail: 'bez karty wyrobu', r_blocking: null },
    { r_kind: 'zmiana_systemu', r_pos_no: 1, r_construction_no: null, r_detail: 'AS 75 EI → AS 75', r_blocking: false },
  ]

  it('mapuje wiersze RPC (null blocking = false, brak danych = pusta lista)', () => {
    const rows = mapAluOverwriteImpactRows(rpc)
    expect(rows).toHaveLength(4)
    expect(rows[2].blocking).toBe(false)
    expect(mapAluOverwriteImpactRows(null)).toEqual([])
  })

  it('blokada, gdy jest zwolniona karta / deklaracja', () => {
    const rows = mapAluOverwriteImpactRows(rpc)
    expect(aluOverwriteIsBlocked(rows)).toBe(true)
    expect(aluOverwriteIsBlocked(rows.filter((r) => !r.blocking))).toBe(false)
  })

  it('grupy w stałej kolejności z opisem', () => {
    const groups = groupAluOverwriteImpact(mapAluOverwriteImpactRows([...rpc].reverse()))
    expect(groups.map((g) => g.kind)).toEqual(['karta_zwolniona', 'pozycja_usunieta', 'konstrukcja_anulowana', 'zmiana_systemu'])
    expect(groups[1].label).toMatch(/znikną/)
  })

  it('linia wiersza: pozycja · konstrukcja — opis', () => {
    const [a, b] = mapAluOverwriteImpactRows(rpc)
    expect(formatAluOverwriteRow(a)).toBe('Poz. 1 · 2026/12/01 — karta ZWOLNIONA 28.11.2026')
    expect(formatAluOverwriteRow(b)).toBe('Poz. 2 — ilość 2; oznaczone etapy: Cięcie 2')
  })
})
