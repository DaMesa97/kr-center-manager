import { createPortal } from 'react-dom'
import { useClickTooltip } from '../lib/useClickTooltip'

/**
 * Menu „⋯" w kolumnie Akcje (#132, Łukasz 12.11.2026): Historia / Problem /
 * Anuluj (Przywróć) pod jednym przyciskiem — mniej przypadkowych kliknięć
 * w Anuluj i węższa kolumna. Ikony 🖨️ i ⚡ zostają osobno (hala klika je
 * najczęściej, dodatkowy klik by przeszkadzał).
 *
 * Menu jest w portalu z pozycją `fixed` (useClickTooltip): kolumna Akcje jest
 * przyklejona w kontenerze z overflow, zwykły dropdown byłby ucięty. Zamyka je
 * klik poza, Esc, scroll tabeli, resize i wybór pozycji.
 */
export type ActionsMenuItem = {
  key: string
  label: string
  onClick: () => void
  /** czerwona pozycja (Anuluj) */
  danger?: boolean
  disabled?: boolean
  title?: string
}

type Props = {
  items: ActionsMenuItem[]
  /** tytuł przycisku „⋯" */
  title?: string
  /** klasa dodatkowa przycisku (np. kolor stanu) */
  buttonClassName?: string
  /** etykieta przycisku — domyślnie „⋯" */
  label?: string
}

export default function ActionsMenu({ items, title = 'Więcej akcji', buttonClassName = '', label = '⋯' }: Props) {
  const { open, pos, triggerRef, tooltipRef, toggle, close } = useClickTooltip<HTMLButtonElement>('.actions-menu')
  if (items.length === 0) return null
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`btn btn-sm btn-secondary actions-menu-btn${open ? ' actions-menu-btn--open' : ''} ${buttonClassName}`.trim()}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        onClick={toggle}
      >
        {label}
      </button>
      {open &&
        createPortal(
          <div
            ref={tooltipRef}
            className="actions-menu"
            role="menu"
            style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 10000 }}
            onClick={(e) => e.stopPropagation()}
            data-no-esc-close
          >
            {items.map((it) => (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                className={`actions-menu-item${it.danger ? ' actions-menu-item--danger' : ''}`}
                disabled={it.disabled}
                title={it.title}
                onClick={(e) => {
                  e.stopPropagation()
                  close()
                  it.onClick()
                }}
              >
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
