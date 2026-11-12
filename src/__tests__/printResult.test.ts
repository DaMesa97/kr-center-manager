import { describe, expect, it } from 'vitest'
import { isPrintCancelled, printFailureReason, printFailureToast } from '../lib/printResult'

// #128 (Łukasz 12.11.2026): zamknięte okno drukarki to informacja, nie
// „Błąd druku: nieznany”; oba klucze powodu (failureReason / error) czytane.
describe('printResult', () => {
  it('czyta powód z failureReason albo error', () => {
    expect(printFailureReason({ success: false, failureReason: 'Drukarka offline' })).toBe('Drukarka offline')
    expect(printFailureReason({ success: false, error: 'RAW odrzucony' })).toBe('RAW odrzucony')
    expect(printFailureReason({ success: false })).toBe('')
    expect(printFailureReason(undefined)).toBe('')
  })

  it('rozpoznaje zamknięcie okna bez wydruku', () => {
    expect(isPrintCancelled({ success: false, cancelled: true })).toBe(true)
    expect(isPrintCancelled({ success: false, failureReason: 'Zapis PDF anulowany' })).toBe(true)
    expect(isPrintCancelled({ success: false, failureReason: 'cancelled' })).toBe(true)
    expect(isPrintCancelled({ success: false, failureReason: 'Drukarka offline' })).toBe(false)
    expect(isPrintCancelled({ success: false })).toBe(false)
  })

  it('toast: informacja przy anulowaniu, błąd z powodem w pozostałych', () => {
    expect(printFailureToast({ success: false, cancelled: true })).toEqual({
      message: 'Informacja: Zamknięto okno bez wydruku',
      variant: 'info',
    })
    expect(printFailureToast({ success: false, failureReason: 'Drukarka offline' })).toEqual({
      message: 'Błąd druku: Drukarka offline',
      variant: 'error',
    })
    const t = printFailureToast({ success: false })
    expect(t.variant).toBe('error')
    expect(t.message).not.toContain('nieznany')
  })
})
