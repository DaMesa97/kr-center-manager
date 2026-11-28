// Wspólne formatowanie w ekranach magazynu (noc 28.11: wydzielone z identycznych kopii w kilku plikach).
import type { WarehouseComponent } from '../types'

/** Etykieta komponentu na liście wyboru: „KOD — Nazwa (jm)”. */
export function componentOptionLabel(c: WarehouseComponent): string {
  return `${c.code} — ${c.name} (${c.unit})`
}

/** Ilość bez zbędnych zer: 5 → „5”, 1.2500 → „1.25”, maks. 3 miejsca po przecinku. */
export function formatIlosc(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)))
}
