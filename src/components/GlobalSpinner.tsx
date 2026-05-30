import { createPortal } from 'react-dom'

export default function GlobalSpinner() {
  return createPortal(
    <div className="global-spinner-overlay">
      <div className="global-spinner">
        <div className="global-spinner-circle" />
      </div>
    </div>,
    document.body,
  )
}
