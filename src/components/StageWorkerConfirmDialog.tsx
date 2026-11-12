import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { StationWorker } from '../lib/stationLogic'

// Potwierdzenie oznaczenia etapu z wyborem OSOBY, która go zrobiła.
// Stanowisko to często jeden komputer i kilka osób — klik we własny kafelek
// jest jednocześnie potwierdzeniem (zero dodatkowych kliknięć vs stary dialog).
// Gdy do etapu nie jest przypisany nikt (poza zalogowanym) — zwykły przycisk.
//
// Hala (zwiad #7): tytuł WIDOCZNY (był sr-only — na ekranie nie było słowa
// „zrobione"), druga linia ze szczegółami zlecenia (firma/model/wymiar),
// pierwsze 400 ms bez reakcji na kliki (dwuklik w „Zrobione" trafiał w tło
// albo w przypadkowy kafelek), klik w tło NIE zamyka.
//
// #133 (Mariusz 12.11.2026): zamiast jednego zlewającego się akapitu — `facts`:
// grupy wierszy „etykieta | pogrubiona wartość" (zlecenie+etap, klient+produkt),
// szersze okno, żeby długa nazwa etapu się nie łamała. `message`/`details`
// zostają jako zapas (alu — etap per sztuka).
export type StageConfirmFact = { label: string; value: string }

type Props = {
  title: string
  message: string
  /** druga linia: firma · model · wymiar · ilość — żeby pomyłkę wiersza było widać */
  details?: string
  /** #133: grupy wierszy etykieta/wartość; gdy podane, zastępują message/details */
  facts?: StageConfirmFact[][]
  workers: StationWorker[]
  /** Ostatnio wybrana osoba na tym komputerze — podświetlona podpowiedź */
  lastWorkerId?: string | null
  /** Zapis w toku — kafelki i przyciski zablokowane (drugi klik = drugi zapis) */
  saving?: boolean
  /** worker=null → oznacz inicjałami zalogowanego (jak dotychczas) */
  onConfirm: (worker: StationWorker | null) => void
  onCancel: () => void
}

const OPEN_GUARD_MS = 400

export default function StageWorkerConfirmDialog({
  title,
  message,
  details,
  facts,
  workers,
  lastWorkerId,
  saving = false,
  onConfirm,
  onCancel,
}: Props) {
  const openedAt = useRef(Date.now())
  const settled = () => Date.now() - openedAt.current >= OPEN_GUARD_MS

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      // Enter potwierdza tylko, gdy nie ma wyboru osoby — przy kafelkach
      // wymuś świadome kliknięcie we własny kafelek
      if (e.key === 'Enter' && workers.length === 0 && !saving && settled()) {
        e.preventDefault()
        onConfirm(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, onConfirm, workers.length, saving])

  const confirm = (w: StationWorker | null) => {
    if (saving || !settled()) return
    onConfirm(w)
  }
  const cancel = () => {
    if (saving || !settled()) return
    onCancel()
  }

  const factGroups = (facts ?? [])
    .map((g) => g.filter((f) => String(f.value ?? '').trim() !== ''))
    .filter((g) => g.length > 0)

  return createPortal(
    <div className="confirm-dialog-overlay" role="presentation">
      <div
        className="confirm-dialog-card stage-confirm-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="stage-confirm-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="confirm-dialog-icon-wrap"
          aria-hidden
          style={{ background: '#dcfce7', borderColor: '#86efac' }}
        >
          <span className="confirm-dialog-icon-warning">✅</span>
        </div>
        <h2 id="confirm-dialog-title" className="stage-confirm-title">
          {title}
        </h2>
        {factGroups.length > 0 ? (
          <div id="stage-confirm-desc" className="stage-confirm-meta">
            {factGroups.map((group, gi) => (
              <div key={gi} className={gi === 0 ? 'stage-confirm-block stage-confirm-block--primary' : 'stage-confirm-block'}>
                {group.map((f) => (
                  <p key={f.label} className="stage-confirm-row">
                    <span className="stage-confirm-label">{f.label}</span>
                    <strong className="stage-confirm-strong">{f.value}</strong>
                  </p>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div id="stage-confirm-desc">
            <p className="confirm-dialog-message stage-confirm-message">{message}</p>
            {details && <p className="stage-confirm-details">{details}</p>}
          </div>
        )}

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
                  onClick={() => confirm(w)}
                >
                  <span className="stage-worker-tile-initials">{w.initials}</span>
                  {w.fullName && <span className="stage-worker-tile-name">{w.fullName}</span>}
                </button>
              ))}
            </div>
            <div className="confirm-dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={cancel} disabled={saving}>
                Anuluj
              </button>
            </div>
          </>
        ) : (
          <div className="confirm-dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={cancel} disabled={saving}>
              Anuluj
            </button>
            <button type="button" className="btn btn-success stage-confirm-yes" onClick={() => confirm(null)} disabled={saving}>
              {saving ? 'Zapisuję…' : 'Tak, zrobione'}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
