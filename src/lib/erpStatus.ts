// =====================================================================
// Status RO z Optimy (kolumny orders.erp_*; zapisuje je WYŁĄCZNIE Make przez
// edge function erp-status → set_erp_status; frontend tylko czyta).
//   erp_status: 'POMYŚLNY' | 'NIEPOMYŚLNY' | null (null = jeszcze nie
//   przetworzone albo zlecenie spoza tej ścieżki — ręczne, MR Profil).
// =====================================================================

export type ErpFields = {
  erp_ro_number?: string | null
  erp_status?: string | null
  erp_error?: string | null
  erp_updated_at?: string | null
}

export const ERP_OK = 'POMYŚLNY'
export const ERP_ERROR = 'NIEPOMYŚLNY'

const norm = (v: unknown): string => String(v ?? '').trim().toUpperCase()

export const isErpOk = (o: ErpFields | null | undefined): boolean => norm(o?.erp_status) === ERP_OK
export const isErpError = (o: ErpFields | null | undefined): boolean => norm(o?.erp_status) === ERP_ERROR
export const hasErpInfo = (o: ErpFields | null | undefined): boolean =>
  Boolean(o && (String(o.erp_status ?? '').trim() || String(o.erp_ro_number ?? '').trim()))

export function erpStatusLabel(o: ErpFields | null | undefined): string {
  if (isErpOk(o)) return 'RO założone w Optimie'
  if (isErpError(o)) return 'Błąd zakładania RO w Optimie'
  return 'Jeszcze nie przetworzone'
}

export function fmtErpDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
}

/** Tooltip plakietki w tabeli: status, numer RO / błąd, data. */
export function erpTooltip(o: ErpFields): string {
  const lines: string[] = [`Optima: ${erpStatusLabel(o)}`]
  if (o.erp_ro_number) lines.push(`RO: ${o.erp_ro_number}`)
  if (isErpError(o)) lines.push(o.erp_error?.trim() || 'Make nie podał treści błędu')
  if (o.erp_updated_at) lines.push(`Aktualizacja: ${fmtErpDate(o.erp_updated_at)}`)
  if (isErpError(o)) lines.push('Poprawka: Airtable → „Błędy automatyzacji (Optima)" → Ponów wysyłkę')
  return lines.join('\n')
}
