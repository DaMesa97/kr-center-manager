// D48 (28.11): listy kolumn `orders` zamiast `select *` w Wysyłce i zakładkach kategorii.
//
// Tabela ma 106 kolumn, w tym stare pola, których aplikacja już nie czyta (zastąpione np. przez
// extension_qtys). Zakładki i Wysyłka przekazują zlecenia do wielu miejsc (tabele, okna edycji, etykiety,
// pomocnicze funkcje w utils), więc lista obejmuje KAŻDĄ kolumnę, której nazwa pada w kodzie tych widoków
// (łącznie z importowanymi modułami) — test `orderColumns.test.ts` to pilnuje.
//
// Bezpiecznik: gdyby kolumny z listy nie było w bazie (zmiana nazwy, stara baza), PostgREST zwraca 42703 —
// wtedy zapytanie jest powtarzane z `*`, a do końca sesji używamy `*` (ekran się nie wywraca).

/** Kolumny orders, których aplikacja nie czyta nigdzie w `src/` (stan bazy 28.11) — pomijane w listach. */
export const ORDER_COLUMNS_NIEUZYWANE = [
  'extension_a_qty', 'extension_a_qty_3cm', 'extension_a_qty_5cm',
  'extension_b_qty', 'extension_b_qty_3cm', 'extension_b_qty_5cm',
  'extension_top_qty', 'extension_top_qty_3cm', 'extension_top_qty_5cm',
  'extension_profile_width', 'bastion_completed', 'bastion_side_panel', 'wpisал',
] as const

/** Zakładki kategorii (lista zleceń, okna edycji, etykiety): wszystkie kolumny orders oprócz nieużywanych. */
export const ORDER_LIST_COLUMNS = [
  'id', 'created_at', 'order_number', 'category', 'company', 'order_date', 'production_day', 'quantity', 'sequence',
  'system', 'model', 'wing_color', 'frame_color', 'threshold_color', 'width', 'direction', 'opening', 'height', 'glazing',
  'decorative_panel', 'hardware', 'handle', 'electric_strike', 'peephole', 'top_light', 'top_light_glazing', 'side_panel',
  'side_panel_glazing', 'extension', 'release_date', 'disting_sheet', 'notes', 'client_order_number', 'defects',
  'entered_by', 'configurator_value', 'info', 'airtable_id', 'label', 'production_stages', 'extra_fields', 'oslonki',
  'zaczep', 'prog', 'linked_order_id', 'sta_sheet', 'release', 'stage1', 'stage2_1', 'stage2_2', 'stage3', 'stage4',
  'stage5', 'sta_ref', 'st_sheet', 'side_panel_a', 'side_panel_b', 'side_panel_a_glazing', 'side_panel_b_glazing',
  'extension_a_dim', 'extension_b_dim', 'extension_top_dim', 'glass_order_date', 'glass_received', 'glass_received_date',
  'extension_qtys', 'bastion_collection', 'bastion_sales_changes', 'bastion_rush_date', 'bastion_day_of_week',
  'bastion_frame_type', 'bastion_frame_range', 'bastion_is_promo', 'bastion_production_priority',
  'bastion_is_production_rush', 'bastion_notes_2', 'bastion_label_qty', 'stock_status', 'stock_issues', 'source',
  'source_metadata', 'bastion_top_panel', 'bastion_side_panel_k', 'bastion_side_panel_p', 'wentylacja', 'intarsja',
  'erp_ro_number', 'erp_status', 'erp_error', 'erp_updated_at', 'shipped_at', 'shipped_route', 'samozamykacz',
] as const

/** Kolumny, których nie czyta żaden moduł Wysyłki (lista, biurko logistyki, okna szczegółów) — tylko formularze edycji. */
export const SHIPPING_POMIJANE = ['extension_a_dim', 'extension_b_dim', 'extension_top_dim', 'st_sheet'] as const

/** Wysyłka (lista + biurko logistyki + okna szczegółów otwierane z Wysyłki). */
export const SHIPPING_ORDER_COLUMNS: readonly string[] = ORDER_LIST_COLUMNS.filter(
  (c) => !(SHIPPING_POMIJANE as readonly string[]).includes(c),
)

let listaZawiodla = false

/** Tekst do `.select()`: lista kolumn albo `*`, jeśli w tej sesji baza odrzuciła listę (42703). */
export function orderSelect(kolumny: readonly string[]): string {
  return listaZawiodla ? '*' : kolumny.join(', ')
}

/**
 * true = błąd „brak kolumny” (42703) — od teraz `orderSelect(...)` daje `*`, wołający ponawia zapytanie RAZ.
 * (Dwa zapytania równoległe mogą oba dostać 42703 — każde ponawia się samo, stąd bez warunku „pierwszy raz”.)
 */
export function brakKolumnyWLiscie(error: { code?: string } | null | undefined): boolean {
  if (error?.code !== '42703') return false
  if (!listaZawiodla) console.warn('orders: lista kolumn odrzucona przez bazę (42703) — do końca sesji select *')
  listaZawiodla = true
  return true
}

/** Tylko dla testów. */
export function __resetOrderSelect(): void {
  listaZawiodla = false
}
