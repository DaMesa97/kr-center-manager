import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ToastRecord } from '../types'

function Toast({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: string) => void }) {
  useEffect(() => {
    // błąd musi dać się przeczytać — 3 s to za mało (znikał, zanim ktoś spojrzał)
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.variant === 'error' ? 10_000 : 3500)
    return () => window.clearTimeout(timer)
  }, [toast.id, toast.variant, onDismiss])

  return (
    <div className={`toast toast--${toast.variant}`} role="alert">
      <p className="toast-message">{toast.message}</p>
      <button type="button" className="btn btn-icon btn-ghost" onClick={() => onDismiss(toast.id)} aria-label="Zamknij">
        ×
      </button>
    </div>
  )
}

type ToastStackProps = {
  toasts: ToastRecord[]
  onDismiss: (id: string) => void
}

export default function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) {
    return null
  }
  return createPortal(
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  )
}
