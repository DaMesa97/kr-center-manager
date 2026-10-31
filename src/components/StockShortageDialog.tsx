import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { StockReleaseRow } from '../hooks/useMyStation'

type Props = {
  stageHeader: string
  stageTitle: string
  orderNumber: string
  shortages: StockReleaseRow[]
  /** kierownik widzi pełną listę braków i słownictwo magazynowe; pracownik — proste zdanie */
  isManager?: boolean
  onCancel: () => void
  onForce: () => void
}

/**
 * Dialog braków fizycznych przy wydaniu na etap ("Zrobione" w Moim stanowisku / tabeli).
 * Decyzja Tymka (zwiad #7): pracownik normalnie klika „Zrobione mimo braku" —
 * to informacja dla magazynu, nie decyzja frezera. Dla pracownika: jedno
 * zdanie, zielony przycisk; lista braków i „stan na minus" tylko dla kierownika.
 */
export default function StockShortageDialog({
  stageHeader,
  stageTitle,
  orderNumber,
  shortages,
  isManager = false,
  onCancel,
  onForce,
}: Props) {
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
        className="confirm-dialog-card shortage-dialog-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="shortage-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="shortage-dialog-title" className="stage-confirm-title">
          {isManager ? 'Brak na magazynie' : 'W magazynie brakuje części'}
        </h2>
        <p className="shortage-dialog-subtitle">
          Zlecenie <strong>{orderNumber}</strong> · etap <strong>{stageHeader}</strong> — {stageTitle}
        </p>

        {isManager ? (
          <>
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
          </>
        ) : (
          <>
            <div className="shortage-dialog-list shortage-dialog-list--simple">
              {shortages.slice(0, 6).map((s) => (
                <div key={`${s.r_component_id}-${s.r_warehouse_code}`} className="shortage-dialog-row">
                  <div className="shortage-dialog-name">{s.r_component_name}</div>
                  <div className="shortage-dialog-qty">
                    <span className="shortage-dialog-missing">brakuje {s.r_shortage}</span>
                  </div>
                </div>
              ))}
              {shortages.length > 6 && <div className="shortage-dialog-row muted">…i jeszcze {shortages.length - 6}</div>}
            </div>
            <p className="shortage-dialog-hint stage-confirm-details">
              Program pokazuje, że tych części nie ma na stanie. Jeśli etap jest zrobiony, kliknij
              <strong> „Zrobione mimo braku"</strong> — magazyn dostanie o tym informację. Nic nie psujesz.
            </p>
          </>
        )}

        <div className="confirm-dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={guard(onCancel)}>
            {isManager ? 'Anuluj' : 'Nie, wracam'}
          </button>
          <button type="button" className={isManager ? 'btn btn-danger' : 'btn btn-success stage-confirm-yes'} onClick={guard(onForce)}>
            {isManager ? `Wydaj mimo braku (${shortages.length})` : 'Zrobione mimo braku'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
