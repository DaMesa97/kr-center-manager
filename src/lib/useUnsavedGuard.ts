import { useCallback, useEffect, useRef } from 'react'
import { appConfirm } from './appDialogs'

/**
 * Wspólna ochrona formularzy przed przypadkowym zamknięciem (zgłoszenia #96 / #98).
 * Do tej pory miało ją tylko okno zlecenia; ten hook robi to samo dla każdego
 * modala: pamięta migawkę danych z chwili otwarcia, a `requestClose` pyta
 * o potwierdzenie tylko wtedy, gdy coś się zmieniło. Esc też przechodzi przez
 * pytanie. Po udanym zapisie wołaj `markSaved()` (albo po prostu zamknij).
 *
 *   const { requestClose } = useUnsavedGuard(form, onClose)
 *   <div className="modal-overlay" onClick={() => void requestClose()}>
 */
type Options = {
  /** false = zachowuje się jak zwykłe onClose (np. w trakcie zapisu) */
  enabled?: boolean
  message?: string
  /** Esc zamyka (z pytaniem) — domyślnie tak; w modalu trzymanym w drzewie na stałe podaj `open` */
  escape?: boolean
  /**
   * Modale często są zamontowane na stałe i tylko dostają `open`. Zmiana tej
   * wartości (np. `open`) robi nową migawkę „stanu wyjściowego" — po chwili,
   * żeby zdążyły wejść dane z efektów wypełniających formularz przy otwarciu.
   */
  resetKey?: unknown
}

const DEFAULT_MESSAGE = 'Formularz zawiera niezapisane zmiany. Czy na pewno chcesz go zamknąć?'

const snapshot = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

export function useUnsavedGuard<T>(value: T, onClose: () => void, options: Options = {}) {
  const { enabled = true, message = DEFAULT_MESSAGE, escape = true, resetKey } = options
  const initialRef = useRef<string>(snapshot(value))
  const latestRef = useRef<T>(value)
  latestRef.current = value

  useEffect(() => {
    // po otwarciu: migawka z opóźnieniem, bo formularz bywa wypełniany w efekcie
    const t = window.setTimeout(() => {
      initialRef.current = snapshot(latestRef.current)
    }, 50)
    return () => window.clearTimeout(t)
  }, [resetKey])

  const isDirty = useCallback(() => snapshot(latestRef.current) !== initialRef.current, [])

  const markSaved = useCallback(() => {
    initialRef.current = snapshot(latestRef.current)
  }, [])

  const requestClose = useCallback(async (): Promise<boolean> => {
    if (enabled && isDirty()) {
      const ok = await appConfirm(message)
      if (!ok) return false
    }
    onClose()
    return true
  }, [enabled, isDirty, message, onClose])

  useEffect(() => {
    if (!escape) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // nie przechwytuj Esc z zagnieżdżonych list/podpowiedzi
      const target = e.target as HTMLElement | null
      if (target && target.closest('[data-no-esc-close]')) return
      e.preventDefault()
      void requestClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [escape, requestClose])

  return { requestClose, isDirty, markSaved }
}
