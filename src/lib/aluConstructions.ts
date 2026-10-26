import type { AluConstruction } from '../types'

// Numer konstrukcji RRRR/ZZ/PP (ZKP 5.9). Źródłem prawdy jest kolumna
// generowana alu_constructions.construction_no — ta funkcja to jej lustro
// do testów i podglądów (min. 2 cyfry, powyżej 99 po prostu więcej cyfr).
export function formatConstructionNo(year: number, zz: number, pp: number): string {
  const two = (n: number) => (n < 10 ? `0${n}` : String(n))
  return `${year}/${two(zz)}/${two(pp)}`
}

/** Numer zlecenia w roku w postaci RRRR/ZZ (nagłówek zlecenia). */
export function formatProductionOrderNo(year: number, zz: number): string {
  return `${year}/${zz < 10 ? `0${zz}` : zz}`
}

/** Aktywne konstrukcje pozycji w kolejności sztuk (piece_index). */
export function activeConstructionsForPosition(list: AluConstruction[], positionId: number): AluConstruction[] {
  return list
    .filter((c) => c.position_id === positionId && c.status === 'aktywna')
    .sort((a, b) => a.piece_index - b.piece_index)
}

/**
 * Numer konstrukcji dla n-tej sztuki pozycji (1..ilość) — n-ta AKTYWNA
 * konstrukcja po piece_index. Brak (zlecenie nieuruchomione) → ''.
 */
export function constructionNoForPiece(list: AluConstruction[], positionId: number, piece: number): string {
  return activeConstructionsForPosition(list, positionId)[piece - 1]?.construction_no ?? ''
}
