import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Order } from '../types'
import { countCompletedStages } from '../utils'

type Props = {
  order: Order
}

function ShippingProgressBar({ order }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [above, setAbove] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !triggerRef.current) return

    const rect = triggerRef.current.getBoundingClientRect()
    const tooltipHeight = 300
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top

    const showAbove = spaceBelow < tooltipHeight && spaceAbove > spaceBelow

    setPos({
      top: showAbove ? rect.top - 4 : rect.bottom + 4,
      left: rect.left,
    })
    setAbove(showAbove)
  }, [open])

  const { completed, total, percent, stages } = countCompletedStages(order)

  if (total === 0) {
    return <span style={{ color: '#9ca3af' }}>—</span>
  }

  return (
    <>
      <div
        ref={triggerRef}
        className="shipping-progress-wrapper"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <div className="shipping-progress-bar">
          <div
            className="shipping-progress-bar-fill"
            style={{
              width: `${percent}%`,
              background: percent === 100 ? '#10b981' : '#3b82f6',
            }}
          />
        </div>
        <div className="shipping-progress-label">
          {completed}/{total} ({percent}%)
        </div>
      </div>

      {open &&
        createPortal(
          <div
            className="shipping-progress-tooltip"
            style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 10000, transform: above ? 'translateY(-100%)' : undefined }}
          >
            <div className="shipping-progress-tooltip-title">
              Etapy produkcji: {completed}/{total}
            </div>
            <ul className="shipping-progress-tooltip-list">
              {stages.map((stage) => (
                <li
                  key={stage.key}
                  className={
                    stage.done ? 'shipping-progress-stage--done' : 'shipping-progress-stage--todo'
                  }
                >
                  <span className="shipping-progress-stage-icon">{stage.done ? '✓' : '○'}</span>
                  <span className="shipping-progress-stage-header">{stage.header}</span>
                  <span className="shipping-progress-stage-title">{stage.title}</span>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </>
  )
}

export default ShippingProgressBar
