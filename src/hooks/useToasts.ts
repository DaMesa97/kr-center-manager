import { useCallback, useState } from 'react'
import type { ToastRecord, ToastVariant } from '../types'
import { humanizeErrorText } from '../lib/friendlyError'

export function useToasts() {
  const [toasts, setToasts] = useState<ToastRecord[]>([])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const pushToast = useCallback((rawMessage: string, variant: ToastVariant) => {
    // błędy z bazy / sieci po ludzku (oryginał zostaje w konsoli do diagnozy)
    const message = variant === 'error' ? humanizeErrorText(rawMessage) : rawMessage
    if (message !== rawMessage) console.info('[toast] oryginalny błąd:', rawMessage)
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    setToasts((prev) => [...prev, { id, message, variant }])
  }, [])

  return { toasts, pushToast, dismissToast }
}
