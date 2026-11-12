// Wspólna interpretacja wyniku druku z IPC (label:printHtml / label:printRaw /
// eksport PDF). Oba kanały zwracają inny klucz z powodem (failureReason vs
// error) — stąd #128 (Łukasz 12.11.2026): Etykiety → Dokumenty czytały tylko
// `error` i każda odmowa druku PDF kończyła się „Błąd druku: nieznany”.
// Zamknięcie okna drukarki/zapisu bez wydruku to informacja, nie błąd.

import type { ToastVariant } from '../types'

export type PrintIpcResult = {
  success: boolean
  failureReason?: string
  error?: string
  printerDown?: boolean
  /** użytkownik zamknął okno (dialog zapisu / drukarki) — nic nie poszło na drukarkę */
  cancelled?: boolean
}

export const PRINT_CANCELLED_TEXT = 'Zamknięto okno bez wydruku'

export function printFailureReason(res: PrintIpcResult | undefined | null): string {
  return (res?.failureReason || res?.error || '').trim()
}

export function isPrintCancelled(res: PrintIpcResult | undefined | null): boolean {
  if (res?.cancelled) return true
  return /anulowan|cancel|zamknięto okno/i.test(printFailureReason(res))
}

/** Treść i rodzaj toastu dla nieudanego druku (po `success === false`). */
export function printFailureToast(res: PrintIpcResult | undefined | null): { message: string; variant: ToastVariant } {
  if (isPrintCancelled(res)) return { message: `Informacja: ${PRINT_CANCELLED_TEXT}`, variant: 'info' }
  const reason = printFailureReason(res)
  return { message: `Błąd druku: ${reason || 'drukarka nie podała powodu'}`, variant: 'error' }
}
