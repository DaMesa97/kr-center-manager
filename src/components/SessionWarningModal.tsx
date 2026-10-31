import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  open: boolean
  onExtend: () => void
  onLogout: () => void
}

/**
 * Ostrzeżenie przed automatycznym wylogowaniem po godzinie bez klikania.
 * Język „dla hali": bez „sesji" i „przedłużania"; właściwy przycisk zielony
 * i duży, Enter = „pracuję dalej".
 */
export default function SessionWarningModal({ open, onExtend, onLogout }: Props) {
  const [secondsLeft, setSecondsLeft] = useState(60)

  useEffect(() => {
    if (!open) {
      setSecondsLeft(60)
      return
    }
    const interval = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1))
    }, 1000)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onExtend()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearInterval(interval)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onExtend])

  if (!open) return null

  return createPortal(
    <div className="modal-overlay" onClick={onExtend}>
      <div className="session-warning-modal" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>Jesteś tam jeszcze?</h2>
        <p>
          Nikt nic nie klikał od godziny. Za <strong>{secondsLeft} s</strong> program sam się wyloguje.
        </p>
        <div className="confirm-dialog-actions session-warning-actions">
          <button type="button" className="btn btn-secondary" onClick={onLogout}>
            Wyloguj
          </button>
          <button type="button" className="btn btn-success session-warning-stay" onClick={onExtend} autoFocus>
            Tak, pracuję dalej
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
