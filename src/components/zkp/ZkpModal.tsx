import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

type Props = {
  title: string
  onClose: () => void
  /** zablokuj zamknięcie (Esc / tło) w trakcie zapisu */
  busy?: boolean
  width?: number
  children: ReactNode
  footer: ReactNode
}

/** Okno formularzy ZKP — ten sam wygląd co okna zleceń (order-modal). */
export default function ZkpModal({ title, onClose, busy = false, width = 720, children, footer }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => !busy && onClose()}>
      <div className="order-modal order-modal--sta zkp-modal" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
        <div className="order-modal-header">
          <h2>{title}</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={busy} aria-label="Zamknij">
            <X size={18} />
          </button>
        </div>
        <div className="zkp-modal-body">{children}</div>
        <div className="order-form-actions">{footer}</div>
      </div>
    </div>,
    document.body,
  )
}
