// Eksport „Stan na dzień” (zgłoszenie #59) do CSV otwieranego wprost w Excelu:
// średnik jako separator i przecinek dziesiętny (polskie ustawienia regionalne),
// BOM na początku, żeby Excel poprawnie odczytał polskie znaki (UTF-8).

export type StockAtDateRow = {
  warehouse_code: string | null
  component_code: string | null
  component_name: string | null
  category: string | null
  unit: string | null
  quantity: number | string | null
}

/** Najwcześniejszy dzień, od którego stan = suma ruchów (stany wyzerowano bez ruchu korygującego ok. 29.09; testowe WZ z września). */
export const STOCK_HISTORY_RELIABLE_FROM = '2026-09-30'

const cell = (v: unknown): string => {
  const s = v == null ? '' : String(v)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const qty = (v: number | string | null): string => {
  const n = Number(v)
  if (v == null || v === '' || !Number.isFinite(n)) return ''
  // bez zbędnych zer (12.500 → 12,5), przecinek dziesiętny
  return String(Number(n.toFixed(3))).replace('.', ',')
}

export function buildStockAtDateCsv(rows: StockAtDateRow[], date: string): string {
  const header = ['Magazyn', 'Kod', 'Nazwa', 'Kategoria', 'Jednostka', `Stan na ${date}`]
  const lines = rows.map((r) =>
    [r.warehouse_code, r.component_code, r.component_name, r.category, r.unit].map(cell).concat(qty(r.quantity)).join(';'),
  )
  return '﻿' + [header.map(cell).join(';'), ...lines].join('\r\n') + '\r\n'
}
