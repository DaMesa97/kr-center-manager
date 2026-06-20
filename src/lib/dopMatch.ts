import type { Order } from '../types'

// Dokument DoP/ZPL z atrybutami doboru (puste = "dowolne").
export type DopDocument = {
  id: number
  category: string
  name: string
  zpl_content: string
  system?: string | null
  wykonawca?: string | null
  glazing_type?: string | null // 'szklone' | 'pelne'
  frame_kind?: string | null // 'stalowa' | 'drewniana'
}

const norm = (v: unknown): string => String(v ?? '').trim().toUpperCase()

// ── Cechy zamówienia używane do doboru DWU ──────────────────────────────
export function orderWykonawca(order: Order): string {
  const ef = order.extra_fields as Record<string, unknown> | null | undefined
  return String(ef?.wykonawca ?? '').trim()
}

// szklone = ma cokolwiek w polu szklenie; pełne = brak
export function orderGlazingType(order: Order): 'szklone' | 'pelne' {
  const g = String(order.glazing ?? '').trim()
  const empty = !g || g === '-' || norm(g) === 'BRAK' || norm(g) === 'NIE'
  return empty ? 'pelne' : 'szklone'
}

// rodzaj ościeżnicy (gł. Bastion): stalowa ma osobną DWU
export function orderFrameKind(order: Order): 'stalowa' | 'drewniana' | '' {
  const o = order as Record<string, unknown>
  const ft = norm(o.bastion_frame_type)
  if (ft.includes('STAL')) return 'stalowa'
  if (ft.includes('DREWN')) return 'drewniana'
  // Kategoria ST = stalowe drzwi → ościeżnica stalowa
  if (norm(order.category) === 'ST') return 'stalowa'
  return ''
}

// Czy dokument pasuje do zamówienia (wszystkie USTAWIONE cechy muszą się zgadzać).
export function docMatchesOrder(doc: DopDocument, order: Order): boolean {
  if (doc.category !== order.category) return false
  if (norm(doc.system) && norm(doc.system) !== norm(order.system)) return false
  if (norm(doc.wykonawca) && norm(doc.wykonawca) !== norm(orderWykonawca(order))) return false
  if (norm(doc.glazing_type) && norm(doc.glazing_type) !== norm(orderGlazingType(order))) return false
  if (norm(doc.frame_kind) && norm(doc.frame_kind) !== norm(orderFrameKind(order))) return false
  return true
}

// Liczba ustawionych cech (specyficzność) — bardziej szczegółowe dokumenty na górze.
export function docSpecificity(doc: DopDocument): number {
  return [doc.system, doc.wykonawca, doc.glazing_type, doc.frame_kind].filter((v) => norm(v)).length
}

// Pasujące dokumenty dla zamówienia, posortowane od najbardziej szczegółowych.
export function matchedDocsForOrder(order: Order, docs: DopDocument[]): DopDocument[] {
  return docs
    .filter((d) => docMatchesOrder(d, order))
    .sort((a, b) => docSpecificity(b) - docSpecificity(a))
}
