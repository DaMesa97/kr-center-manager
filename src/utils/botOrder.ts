import type { Order } from '../types'

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object') return null
  return value as Record<string, unknown>
}

export const isBotOrder = (order: Order | null | undefined): boolean => {
  return order?.source === 'bot'
}

export const getBotWarnings = (order: Order | null | undefined): string[] => {
  // Ostrzeżenia dotyczą nie tylko bota — Excel-intake flaguje też konflikty
  // numerów z arkusza (needs_review + warnings w extra_fields)
  const extras = asRecord(order?.extra_fields)
  const warnings = extras?.warnings
  return Array.isArray(warnings) ? warnings.filter((w): w is string => typeof w === 'string') : []
}

export const needsBotReview = (order: Order | null | undefined): boolean => {
  const extras = asRecord(order?.extra_fields)
  return extras?.needs_review === true || getBotWarnings(order).length > 0
}

/** Numer zlecenia w arkuszu Excel, gdy różni się od numeru w aplikacji (#119). */
export type SheetNumberInfo = {
  number: string
  /** Center / Profil / WZ — z której zakładki arkusza (po synchronizacji). */
  sheet?: string
  /** Kiedy synchronizacja ostatnio zapisała / zmieniła numer (ISO). */
  at?: string
  /** true = tylko numer z chwili importu (sheet_number_conflict), synchronizacja jeszcze go nie potwierdziła. */
  fromImport: boolean
}

const asTrimmedString = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : ''

/**
 * Numer tego zlecenia w arkuszu Excel (Tymek 13.11.2026, #119: dla hali wiążący jest
 * numer z aplikacji, numer z arkusza pokazujemy obok jako informację).
 * Źródło: ostatnia synchronizacja z Excela (extra_fields.sheet_number, zapis w
 * sync_releases_from_excel__impl), a zanim ta nastąpi — numer z chwili importu
 * (extra_fields.sheet_number_conflict z orders-excel-intake).
 * null, gdy brak numeru albo jest taki sam jak numer zlecenia.
 */
export const getSheetNumber = (order: Order | null | undefined): SheetNumberInfo | null => {
  const extras = asRecord(order?.extra_fields)
  const latest = asTrimmedString(extras?.sheet_number)
  const atImport = asTrimmedString(extras?.sheet_number_conflict)
  const number = latest || atImport
  if (!number || number === asTrimmedString(order?.order_number)) return null
  return {
    number,
    // '*' = arkusz bez podziału na wykonawcę (Techniczne) — nie pokazujemy
    sheet: latest && typeof extras?.sheet_number_sheet === 'string' && extras.sheet_number_sheet !== '*' ? extras.sheet_number_sheet : undefined,
    at: latest && typeof extras?.sheet_number_at === 'string' ? extras.sheet_number_at : undefined,
    fromImport: !latest,
  }
}

const formatPlDate = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Podpowiedź do plakietki „ark. N" — skąd numer i który jest wiążący. */
export const sheetNumberTitle = (order: Order | null | undefined, info: SheetNumberInfo): string => {
  const appNo = asTrimmedString(order?.order_number)
  const where = info.sheet ? ` (zakładka ${info.sheet})` : ''
  const head = info.fromImport
    ? `Numer, pod którym to zlecenie weszło z arkusza Excel: ${info.number}. W aplikacji ten numer był już zajęty, więc zlecenie dostało ${appNo}.`
    : `Numer tego zlecenia w arkuszu Excel: ${info.number}${where}.`
  const when = info.fromImport
    ? 'Zaktualizuje się po najbliższej synchronizacji z Excela (codziennie 20:00).'
    : info.at
      ? `Zapisany przez synchronizację z Excela ${formatPlDate(info.at)}.`
      : 'Zapisany przez synchronizację z Excela.'
  return `${head}\n${when}\nWiążący dla hali jest numer z aplikacji (${appNo}).`
}

export const getBotMetadata = (order: Order | null | undefined) => {
  if (!isBotOrder(order)) return null
  const extras = asRecord(order?.extra_fields)
  const sourceMetadata = asRecord(order?.source_metadata)
  return {
    receivedAt: typeof extras?.bot_received_at === 'string' ? extras.bot_received_at : undefined,
    apiKeyId: typeof extras?.api_key_id === 'number' ? extras.api_key_id : undefined,
    ipAddress: typeof sourceMetadata?.ip_address === 'string' ? sourceMetadata.ip_address : undefined,
    userAgent: typeof sourceMetadata?.user_agent === 'string' ? sourceMetadata.user_agent : undefined,
    rawPayload: asRecord(extras?.raw_payload) ?? undefined,
  }
}
