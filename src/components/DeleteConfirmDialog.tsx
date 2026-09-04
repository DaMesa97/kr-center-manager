import { useEffect } from 'react'
import { createPortal } from 'react-dom'

type DeleteConfirmDialogProps = {
  message: string
  onCancel: () => void
  onConfirm: () => void
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 'danger' (domyślnie, ⚠️ + czerwony przycisk) albo 'success' (✓ + zielony) —
   *  pozytywne potwierdzenia (np. "Zrobione") nie powinny straszyć ostrzeżeniem */
  tone?: 'danger' | 'success'
}

export default function DeleteConfirmDialog({
  message,
  onCancel,
  onConfirm,
  title = 'Potwierdzenie usunięcia',
  confirmLabel = 'Usuń',
  cancelLabel = 'Anuluj',
  tone = 'danger',
}: DeleteConfirmDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') {
        e.preventDefault()
        onConfirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, onConfirm])

  return createPortal(
    <div className="confirm-dialog-overlay" role="presentation" onClick={onCancel}>
      <div
        className="confirm-dialog-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="confirm-dialog-title">
          {title}
        </h2>
        <div
          className="confirm-dialog-icon-wrap"
          aria-hidden
          style={tone === 'success' ? { background: '#dcfce7', borderColor: '#86efac' } : undefined}
        >
          <span className="confirm-dialog-icon-warning">{tone === 'success' ? '✅' : '⚠️'}</span>
        </div>
        <p id="confirm-dialog-message" className="confirm-dialog-message">
          {message}
        </p>
        <div className="confirm-dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${tone === 'success' ? 'btn-success' : 'btn-danger'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
