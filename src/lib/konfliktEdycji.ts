// D29 (28.11): konflikt edycji zlecenia — ktoś zmienił zlecenie między otwarciem formularza a zapisem.
// Podstawa: orders.updated_at (migracja 20261128053100, trigger). Przed migracją kolumny nie ma → bez porównania.
// Gdy updated_at się różni, wypisujemy pola, które naprawdę się zmieniły — z pominięciem pól technicznych,
// zmienianych automatycznie albo z hali (etapy, stan magazynu, Optima, wysyłka), których formularz nie dotyka;
// zmiana tylko takich pól nie jest konfliktem.

/** Kolumny zlecenia pomijane przy porównaniu (formularz ich nie zapisuje). */
const KOLUMNY_TECHNICZNE = new Set([
  'updated_at', 'stock_status', 'stock_issues', 'production_stages',
  'stage1', 'stage2_1', 'stage2_2', 'stage3', 'stage4', 'stage5', 'release', 'release_date',
  'erp_ro_number', 'erp_status', 'erp_error', 'erp_updated_at',
  'shipped_at', 'shipped_route', 'glass_order_date', 'glass_received', 'glass_received_date',
  'sequence', 'label', 'bastion_completed',
])

/** Klucze extra_fields pomijane przy porównaniu (hala, Weryfikacja, magazyn, trasy). */
const KLUCZE_EXTRA_TECHNICZNE = new Set([
  'warnings', 'needs_review', 'original_warnings', 'original_needs_review', 'verified_at', 'verified_by', 'verified_note',
  'closed_by', 'ghost_closed', 'release_date_zrodlo', 'release_date_szacunkowa', 'release_date_przyblizona',
  'arkusz_wydanie_status', 'sheet_number', 'sheet_number_at', 'sheet_number_sheet', 'sheet_number_conflict',
  'route_pin', 'route_mark', 'ready_to_invoice', 'osc_received', 'osc_received_at', 'braki',
  'company_rewritten_at', 'company_as_received', 'raw_payload', 'api_key_id', 'bot_received_at',
  'problem', 'problem_note', 'problem_at', 'problem_by',
])

/** Czytelne nazwy najczęstszych pól (reszta — nazwa techniczna). */
const NAZWY: Record<string, string> = {
  company: 'firma', quantity: 'ilość', model: 'model', system: 'system', width: 'szerokość', height: 'wysokość',
  direction: 'kierunek', opening: 'otwieranie', wing_color: 'kolor skrzydła', frame_color: 'kolor ościeżnicy',
  threshold_color: 'kolor progu', glazing: 'przeszklenie', hardware: 'okucia', handle: 'klamka', notes: 'uwagi',
  info: 'informacje', production_day: 'dzień produkcji', order_date: 'data', client_order_number: 'nr zamówienia klienta',
  category: 'kategoria', extension: 'poszerzenie', peephole: 'wizjer', decorative_panel: 'panel ozdobny',
  bastion_frame_type: 'typ ościeżnicy', bastion_frame_range: 'zakres ościeżnicy', intarsja: 'intarsja',
  cancelled: 'anulowanie',
}

function jsonRowny(a: unknown, b: unknown): boolean {
  if (a === b) return true
  // null, brak pola i pusty tekst traktujemy jednakowo (lokalne poprawki listy potrafią wpisać '' zamiast null)
  const pusty = (v: unknown) => v == null || v === ''
  if (pusty(a) && pusty(b)) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

function obiekt(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export type KonfliktEdycji = { konflikt: boolean; pola: string[] }

/**
 * Porównuje zlecenie z chwili otwarcia formularza (baseline) ze świeżym odczytem z bazy.
 * Konflikt = updated_at się różni ORAZ zmieniło się co najmniej jedno pole nietechniczne.
 */
export function wykryjKonfliktEdycji(
  baseline: Record<string, unknown> | null | undefined,
  fresh: Record<string, unknown> | null | undefined,
): KonfliktEdycji {
  const brak: KonfliktEdycji = { konflikt: false, pola: [] }
  if (!baseline || !fresh) return brak
  const u0 = baseline.updated_at
  const u1 = fresh.updated_at
  // przed migracją (albo stara lista bez kolumny) — bez porównania
  if (u0 == null || u1 == null || u0 === '' || u1 === '') return brak
  if (new Date(String(u0)).getTime() === new Date(String(u1)).getTime()) return brak

  const pola: string[] = []
  for (const k of Object.keys(fresh)) {
    if (KOLUMNY_TECHNICZNE.has(k) || k === 'extra_fields') continue
    if (!(k in baseline)) continue
    if (!jsonRowny(baseline[k], fresh[k])) pola.push(NAZWY[k] ?? k)
  }
  const e0 = obiekt(baseline.extra_fields)
  const e1 = obiekt(fresh.extra_fields)
  for (const k of new Set([...Object.keys(e0), ...Object.keys(e1)])) {
    if (KLUCZE_EXTRA_TECHNICZNE.has(k)) continue
    if (!jsonRowny(e0[k], e1[k])) pola.push(NAZWY[k] ?? k)
  }
  return { konflikt: pola.length > 0, pola }
}

/** Treść ostrzeżenia dla użytkownika. */
export function komunikatKonfliktuEdycji(pola: string[]): string {
  const lista = pola.slice(0, 8).join(', ') + (pola.length > 8 ? ` i ${pola.length - 8} więcej` : '')
  return (
    `Ktoś zmienił to zlecenie w międzyczasie (${lista}) — odśwież: zamknij formularz i otwórz zlecenie ponownie, ` +
    'żeby zobaczyć aktualne dane. „Zapisz mimo to” zapisze tylko pola zmienione przez Ciebie (jeśli to te same pola — nadpisze cudze zmiany).'
  )
}
