// Inwentaryzacja — czysta logika (testy: __tests__/inventory.test.ts).
import type { InventoryLine } from '../types'

export type ParsedCount = { ok: true; value: number | null } | { ok: false }

/** Wpis z pola "Policzono": puste = niepoliczone (null), przecinek dziesiętny OK, ujemne/śmieci = błąd. */
export function parseCountInput(raw: string | null | undefined): ParsedCount {
  const s = String(raw ?? '').trim().replace(/\s+/g, '').replace(',', '.')
  if (s === '') return { ok: true, value: null }
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return { ok: false }
  return { ok: true, value: n }
}

export type InventoryDiff = { line: InventoryLine; counted: number; diff: number }

/**
 * Różnice do zatwierdzenia — z linii pobranych z BAZY (counted_qty / system_qty
 * stemplowane przy liczeniu), nie z draftów w pamięci. Korekta = counted − system.
 */
export function inventoryReview(lines: InventoryLine[]): { diffs: InventoryDiff[]; uncounted: number } {
  const diffs: InventoryDiff[] = []
  let uncounted = 0
  for (const line of lines) {
    if (line.counted_qty == null) {
      uncounted++
      continue
    }
    // zaokrąglenie do 0.001 (step pola) — 0.1 + 0.2 nie może dać "korekty" 0.0000000001
    const diff = Math.round((line.counted_qty - line.system_qty) * 1000) / 1000
    if (diff !== 0) diffs.push({ line, counted: line.counted_qty, diff })
  }
  return { diffs, uncounted }
}
