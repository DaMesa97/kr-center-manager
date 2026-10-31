import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

type StageRevertPopupProps = {
  /** numer zlecenia / reklamacji — żeby było widać, CO się cofa */
  orderNumber?: string
  /** np. „E5 — pakowanie" */
  stageLabel?: string
  /** inicjały, które znikną z komórki */
  currentValue?: string
  /** kierownik widzi dopisek o zwrocie na magazyn (ZWR); pracownik — nie */
  showStockNote?: boolean
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Potwierdzenie cofnięcia etapu. Mówi, które zlecenie, który etap i czyje
 * inicjały znikną — wcześniej „Czy cofnąć etap? … ruch ZWR" bez numeru.
 * Pierwsze ~400 ms ignorujemy kliki (dwuklik w komórkę trafiał w przycisk).
 */
export default function StageRevertPopup({
  orderNumber,
  stageLabel,
  currentValue,
  showStockNote = false,
  onCancel,
  onConfirm,
}: StageRevertPopupProps) {
  const openedAt = useRef(Date.now())
  const guard = (fn: () => void) => () => {
    if (Date.now() - openedAt.current < 400) return
    fn()
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return createPortal(
    <div className="confirm-dialog-overlay" role="presentation">
      <div
        className="production-stage-popup-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stage-revert-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="stage-revert-title" className="production-stage-popup-title">
          Cofnąć etap?
        </h2>
        <p className="production-stage-popup-message">
          {stageLabel ? (
            <>
              Etap <strong>{stageLabel}</strong>
            </>
          ) : (
            'Etap'
          )}
          {orderNumber ? (
            <>
              {' '}
              w zleceniu <strong>{orderNumber}</strong>
            </>
          ) : null}
          {currentValue ? (
            <>
              {' '}
              — wpis „<strong>{currentValue}</strong>" zostanie usunięty.
            </>
          ) : (
            ' wróci do „niezrobione".'
          )}
        </p>
        {showStockNote && (
          <p className="production-stage-popup-note">Części wydane z magazynu na ten etap wrócą na stan (ZWR).</p>
        )}
        <div className="production-stage-popup-actions">
          <button type="button" className="btn btn-secondary" onClick={guard(onCancel)}>
            Nie, zostaw
          </button>
          <button type="button" className="btn btn-danger" onClick={guard(onConfirm)}>
            Tak, cofnij
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
