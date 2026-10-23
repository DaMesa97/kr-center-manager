import { useEffect, useRef } from 'react'
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
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  // Fokus na BEZPIECZNYM przycisku: przy usuwaniu „Anuluj”, przy pozytywnym
  // potwierdzeniu — potwierdzenie. Enter = przycisk z fokusem (natywnie).
  useEffect(() => {
    const target = tone === 'success' ? confirmRef : cancelRef
    target.current?.focus()
  }, [tone])

  useEffect(() => {
    // capture + stopImmediatePropagation: Esc/Enter z okna potwierdzenia nie trafia
    // do formularza/okna POD spodem (wcześniej Esc zamykało oba, a Enter zawsze
    // POTWIERDZAŁ — także usuwanie, nawet z fokusem na „Anuluj”)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        onCancel()
      } else if (e.key === 'Enter') {
        e.stopImmediatePropagation()
        if (e.repeat) e.preventDefault() // przytrzymany Enter z formularza nie klika
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

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
          <button ref={cancelRef} type="button" className="btn btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
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
