import type { Order } from '../types'

// Dokument DoP/ZPL z atrybutami doboru (puste = "dowolne").
export type DopDocument = {
  id: number
  category: string
  name: string
  zpl_content: string | null
  /** 'zpl' (RAW spool) | 'pdf' (render pdfjs → druk HTML) */
  doc_type?: 'zpl' | 'pdf' | null
  pdf_base64?: string | null
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
  // norm() jak pozostałe pola — drobny rozjazd wielkości liter nie może
  // po cichu wykluczyć deklaracji
  if (norm(doc.category) !== norm(order.category)) return false
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
// Tie-break: nazwa, potem id — przy równej szczegółowości wynik nie może
// zależeć od kolejności wierszy z bazy (ta sama DoP na obu komputerach).
export function matchedDocsForOrder(order: Order, docs: DopDocument[]): DopDocument[] {
  return docs
    .filter((d) => docMatchesOrder(d, order))
    .sort(
      (a, b) =>
        docSpecificity(b) - docSpecificity(a) ||
        String(a.name).localeCompare(String(b.name), 'pl') ||
        a.id - b.id,
    )
}

// Czytelny powód braku dopasowania — do tooltipa "brak DoP" w druku zbiorczym.
export function noDocReason(order: Order, docs: DopDocument[]): string {
  if (docs.length === 0) return 'Nie wczytano żadnych deklaracji — sprawdź zakładkę Dokumenty.'
  const inCategory = docs.filter((d) => norm(d.category) === norm(order.category))
  if (inCategory.length === 0) return `Brak deklaracji dla kategorii ${order.category} — dodaj ją w Dokumentach.`
  const wyk = orderWykonawca(order)
  const traits = [
    `system: ${String(order.system ?? '').trim() || '—'}`,
    `wykonawca: ${wyk || 'BRAK W ZAMÓWIENIU'}`,
    `szklenie: ${orderGlazingType(order)}`,
    `ościeżnica: ${orderFrameKind(order) || '—'}`,
  ].join(', ')
  return `Żadna z ${inCategory.length} deklaracji kategorii ${order.category} nie pasuje do cech zamówienia (${traits}). Sprawdź warunki doboru w Dokumentach.`
}
