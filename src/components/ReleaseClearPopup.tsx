import { useEffect } from 'react'
import { createPortal } from 'react-dom'

type ReleaseClearPopupProps = {
  onCancel: () => void
  onConfirm: () => void
}

export default function ReleaseClearPopup({ onCancel, onConfirm }: ReleaseClearPopupProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return createPortal(
    <div className="confirm-dialog-overlay" role="presentation" onClick={onCancel}>
      <div
        className="production-stage-popup-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="release-clear-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="release-clear-title" className="production-stage-popup-title">
          Wydanie
        </h2>
        <p className="production-stage-popup-message">Czy cofnąć wydanie?</p>
        <div className="production-stage-popup-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Nie
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm}>
            Tak
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
