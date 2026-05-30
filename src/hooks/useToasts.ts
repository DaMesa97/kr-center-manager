import { useCallback, useState } from 'react'
import type { ToastRecord, ToastVariant } from '../types'

export function useToasts() {
  const [toasts, setToasts] = useState<ToastRecord[]>([])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const pushToast = useCallback((message: string, variant: ToastVariant) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    setToasts((prev) => [...prev, { id, message, variant }])
  }, [])

  return { toasts, pushToast, dismissToast }
}
