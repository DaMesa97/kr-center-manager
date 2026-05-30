import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  open: boolean
  onExtend: () => void
  onLogout: () => void
}

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
    return () => clearInterval(interval)
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="modal-overlay">
      <div className="session-warning-modal">
        <h2>Sesja wkrótce wygaśnie</h2>
        <p>
          Zostaniesz automatycznie wylogowany za <strong>{secondsLeft}s</strong> z powodu braku aktywności.
        </p>
        <p>Kliknij "Zostań zalogowany" aby przedłużyć sesję.</p>
        <div className="confirm-dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onLogout}>
            Wyloguj się teraz
          </button>
          <button type="button" className="btn btn-danger" onClick={onExtend}>
            Zostań zalogowany
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
