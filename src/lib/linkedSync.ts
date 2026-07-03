// =====================================================================
// Sync pól między rekordami łączonymi (Disting Plus STA↔Disting, Titan STA↔ST).
// Edycja jednego rekordu przenosi WSPÓLNE pola produktowe na partnera.
// NIE rusza pól strukturalnych: numer, kategoria, linki, arkusze, etapy,
// wydanie, extra_fields (mirror etapów i titan_group zostają nietknięte).
// =====================================================================

export const SHARED_LINKED_FIELDS = [
  'company', 'production_day', 'quantity', 'system', 'model',
  'wing_color', 'frame_color', 'threshold_color', 'width', 'direction', 'opening', 'height',
  'glazing', 'decorative_panel', 'hardware', 'handle', 'peephole',
  'top_light', 'top_light_glazing',
  'side_panel', 'side_panel_glazing', 'side_panel_a', 'side_panel_b',
  'side_panel_a_glazing', 'side_panel_b_glazing',
  'extension', 'extension_a_dim', 'extension_b_dim', 'extension_top_dim', 'extension_qtys',
  'notes', 'client_order_number', 'oslonki', 'zaczep',
] as const

// Buduje payload aktualizacji partnera z zapisywanych pól (tylko wspólne, bez undefined).
export function buildPartnerSyncPayload(mapped: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const k of SHARED_LINKED_FIELDS) {
    if (k in mapped && mapped[k] !== undefined) payload[k] = mapped[k]
  }
  return payload
}
