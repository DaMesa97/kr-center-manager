import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { StationWorker } from '../lib/stationLogic'

// Potwierdzenie oznaczenia etapu z wyborem OSOBY, która go zrobiła.
// Stanowisko to często jeden komputer i kilka osób — klik we własny kafelek
// jest jednocześnie potwierdzeniem (zero dodatkowych kliknięć vs stary dialog).
// Gdy do etapu nie jest przypisany nikt (poza zalogowanym) — zwykły przycisk.
type Props = {
  title: string
  message: string
  workers: StationWorker[]
  /** Ostatnio wybrana osoba na tym komputerze — podświetlona podpowiedź */
  lastWorkerId?: string | null
  /** Zapis w toku — kafelki i przyciski zablokowane (drugi klik = drugi zapis) */
  saving?: boolean
  /** worker=null → oznacz inicjałami zalogowanego (jak dotychczas) */
  onConfirm: (worker: StationWorker | null) => void
  onCancel: () => void
}

export default function StageWorkerConfirmDialog({
  title,
  message,
  workers,
  lastWorkerId,
  saving = false,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      // Enter potwierdza tylko, gdy nie ma wyboru osoby — przy kafelkach
      // wymuś świadome kliknięcie we własny kafelek
      if (e.key === 'Enter' && workers.length === 0 && !saving) {
        e.preventDefault()
        onConfirm(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, onConfirm, workers.length, saving])

  return createPortal(
    <div className="confirm-dialog-overlay" role="presentation" onClick={onCancel}>
      <div
        className="confirm-dialog-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="confirm-dialog-title">
          {title}
        </h2>
        <div
          className="confirm-dialog-icon-wrap"
          aria-hidden
          style={{ background: '#dcfce7', borderColor: '#86efac' }}
        >
          <span className="confirm-dialog-icon-warning">✅</span>
        </div>
        <p className="confirm-dialog-message">{message}</p>

        {workers.length > 0 ? (
          <>
            <p className="stage-worker-hint">{saving ? 'Zapisuję…' : 'Kto zrobił? Kliknij swój kafelek:'}</p>
            <div className="stage-worker-tiles">
              {workers.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className={`stage-worker-tile ${w.id === lastWorkerId ? 'stage-worker-tile--last' : ''}`}
                  title={w.fullName || w.initials}
                  disabled={saving}
                  onClick={() => onConfirm(w)}
                >
                  <span className="stage-worker-tile-initials">{w.initials}</span>
                  {w.fullName && <span className="stage-worker-tile-name">{w.fullName}</span>}
                </button>
              ))}
            </div>
            <div className="confirm-dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
                Anuluj
              </button>
            </div>
          </>
        ) : (
          <div className="confirm-dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
              Anuluj
            </button>
            <button type="button" className="btn btn-success" onClick={() => onConfirm(null)} disabled={saving}>
              {saving ? 'Zapisuję…' : 'Tak, oznacz jako zrobione'}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
