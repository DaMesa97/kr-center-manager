import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { StockReleaseRow } from '../hooks/useMyStation'

type Props = {
  stageHeader: string
  stageTitle: string
  orderNumber: string
  shortages: StockReleaseRow[]
  onCancel: () => void
  onForce: () => void
}

/**
 * Dialog braków fizycznych przy wydaniu na etap ("Zrobione" w Moim stanowisku).
 * Lista przewijana, wyrównana do lewej; wymuszenie = wydanie na minus.
 */
export default function StockShortageDialog({
  stageHeader,
  stageTitle,
  orderNumber,
  shortages,
  onCancel,
  onForce,
}: Props) {
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
        className="confirm-dialog-card shortage-dialog-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="shortage-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="shortage-dialog-title" className="confirm-dialog-title">
          Brak na magazynie
        </h2>
        <p className="shortage-dialog-subtitle">
          Zlecenie <strong>{orderNumber}</strong> · etap <strong>{stageHeader}</strong> — {stageTitle}
        </p>

        <div className="shortage-dialog-list">
          {shortages.map((s) => (
            <div key={`${s.r_component_id}-${s.r_warehouse_code}`} className="shortage-dialog-row">
              <div className="shortage-dialog-name">
                {s.r_component_name}
                <span className="shortage-dialog-wh">mag. {s.r_warehouse_code}</span>
              </div>
              <div className="shortage-dialog-qty">
                <span className="shortage-dialog-needed">potrzeba {s.r_quantity}</span>
                <span className="shortage-dialog-missing">brakuje {s.r_shortage}</span>
              </div>
            </div>
          ))}
        </div>

        <p className="shortage-dialog-hint">
          Możesz wydać mimo braku — stan zejdzie na minus i trafi do wyjaśnienia przy
          inwentaryzacji. Wymuszenie zostanie zapisane w historii z twoim nazwiskiem.
        </p>

        <div className="confirm-dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Anuluj
          </button>
          <button type="button" className="btn btn-danger" onClick={onForce}>
            Wydaj mimo braku ({shortages.length})
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
