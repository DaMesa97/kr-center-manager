import { useEffect } from 'react'
import { createPortal } from 'react-dom'

type StageRevertPopupProps = {
  onCancel: () => void
  onConfirm: () => void
}

export default function StageRevertPopup({ onCancel, onConfirm }: StageRevertPopupProps) {
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
        aria-labelledby="stage-revert-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="stage-revert-title" className="production-stage-popup-title">
          Cofnięcie etapu
        </h2>
        <p className="production-stage-popup-message">Czy cofnąć etap?</p>
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
