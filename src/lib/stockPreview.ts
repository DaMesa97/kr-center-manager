// Podgląd stanów magazynowych PRZED zapisem zamówienia (baner w formularzu).
// Czysta logika — budowa payloadu dla preview_order_stock() i podsumowanie
// wyniku. Payload musi wyglądać jak wiersz orders (te same klucze pól),
// bo kryteria receptur odwołują się do kolumn zlecenia.

export interface StockPreviewRow {
  r_part: string | null
  r_component_id: number | null
  r_component_name: string | null
  r_component_code: string | null
  r_required: number
  r_available: number | null
  r_shortage: number
  r_incoming_qty: number
  r_earliest_eta: string | null
  r_status: 'ok' | 'insufficient' | 'missing_recipe' | 'no_recipe' | 'no_warehouse'
}

export interface StockPreviewSummary {
  /** komponenty z brakiem (required > available) */
  shortages: StockPreviewRow[]
  /** części bez pasującej receptury (wing/frame/hardware) */
  missingParts: string[]
  /** żadna receptura nie pasuje */
  noRecipe: boolean
  /** cokolwiek do pokazania? */
  hasWarnings: boolean
}

const TAB_FORM_KEYS: Record<string, string> = {
  STA: 'sta',
  Disting: 'sta',
  ST: 'st',
  Techniczne: 'techniczne',
  Bastion: 'bastion',
}

export interface PreviewForms {
  sta?: Record<string, unknown> | null
  st?: Record<string, unknown> | null
  techniczne?: Record<string, unknown> | null
  bastion?: Record<string, unknown> | null
}

/**
 * Payload dla preview_order_stock: pola aktywnego formularza jako obiekt.
 * Zwraca null, gdy zakładka nie ma formularza albo brak kategorii
 * (bez kategorii matcher i tak nic nie zwróci — nie ma po co strzelać RPC).
 */
export function buildPreviewPayload(
  activeTab: string,
  forms: PreviewForms,
): Record<string, unknown> | null {
  const formKey = TAB_FORM_KEYS[activeTab]
  if (!formKey) return null
  const form = forms[formKey as keyof PreviewForms]
  if (!form) return null
  const category = String(form.category ?? '').trim()
  if (!category) return null
  return { ...form, category }
}

export function summarizePreview(rows: StockPreviewRow[]): StockPreviewSummary {
  const shortages = rows.filter((r) => r.r_status === 'insufficient')
  const missingParts = rows.filter((r) => r.r_status === 'missing_recipe').map((r) => r.r_part ?? '?')
  const noRecipe = rows.some((r) => r.r_status === 'no_recipe')
  return {
    shortages,
    missingParts,
    noRecipe,
    hasWarnings: shortages.length > 0 || missingParts.length > 0 || noRecipe,
  }
}

/** 'YYYY-MM-DD' → 'DD.MM' (krótki format do banera); null → '' */
export function formatEtaShort(eta: string | null): string {
  if (!eta) return ''
  const [y, m, d] = eta.split('-')
  if (!y || !m || !d) return eta
  return `${d}.${m}`
}
