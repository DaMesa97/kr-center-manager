import type { MouseEvent as ReactMouseEvent } from 'react'
import { isStageHold, isStageNA, isStageSpecial, stageDisplay, stageSpecialTitle } from '../lib/stageSpecial'

export type StageMenuAnchor = { x: number; y: number }

type ProductionStageCellProps = {
  value: string
  disabled?: boolean
  /**
   * Etap INNEGO stanowiska (pracownik produkcji bez przypisania do tego etapu):
   * komórka wygląda inaczej niż „swoja" i nie reaguje na klik — wcześniej
   * wszystkie szare komórki wyglądały tak samo, a błąd przychodził dopiero toastem.
   */
  foreign?: boolean
  title?: string
  onPickEmpty: () => void
  onPickFilled: () => void
  /**
   * Kierownik: menu stanów specjalnych (Nie dotyczy / Wstrzymane / Wznów).
   * Otwiera je prawy klik na dowolnej komórce i lewy klik na komórce, która
   * już ma stan specjalny. Brak = pracownik: stan specjalny jest tylko do
   * oglądania (komórka nieaktywna z opisem w tytule).
   */
  onOpenMenu?: (anchor: StageMenuAnchor) => void
}

export default function ProductionStageCell({
  value,
  disabled,
  foreign = false,
  title,
  onPickEmpty,
  onPickFilled,
  onOpenMenu,
}: ProductionStageCellProps) {
  const v = value.trim()
  const special = isStageSpecial(v)
  const filled = Boolean(v) && !special
  const cls = [
    'production-stage-cell',
    special
      ? isStageNA(v)
        ? 'production-stage-cell--na'
        : isStageHold(v)
          ? 'production-stage-cell--hold'
          : 'production-stage-cell--empty'
      : filled
        ? 'production-stage-cell--done'
        : 'production-stage-cell--empty',
    foreign ? 'production-stage-cell--foreign' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const specialTitle = stageSpecialTitle(v)
  const resolvedTitle = title ?? (foreign ? 'Etap innego stanowiska — nie Twój' : specialTitle)
  // stan specjalny bez menu (pracownik) = tylko do oglądania
  const inert = disabled || foreign || (special && !onOpenMenu)

  const anchorFromEvent = (e: ReactMouseEvent<HTMLButtonElement>): StageMenuAnchor => {
    if (e.clientX || e.clientY) return { x: e.clientX, y: e.clientY }
    const r = e.currentTarget.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.bottom }
  }

  return (
    <button
      type="button"
      className={cls}
      disabled={inert}
      title={resolvedTitle}
      aria-disabled={foreign || undefined}
      onClick={(e) => {
        if (special) {
          onOpenMenu?.(anchorFromEvent(e))
          return
        }
        if (filled) onPickFilled()
        else onPickEmpty()
      }}
      onContextMenu={
        onOpenMenu && !disabled && !foreign
          ? (e) => {
              e.preventDefault()
              e.stopPropagation()
              onOpenMenu(anchorFromEvent(e))
            }
          : undefined
      }
    >
      {special ? stageDisplay(v) : filled ? v : ' '}
    </button>
  )
}
