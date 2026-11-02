import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isStageHold, isStageNA, isStageSpecial, stageHoldReason } from '../lib/stageSpecial'
import type { StageMenuAnchor } from './ProductionStageCell'

type StageSpecialMenuProps = {
  anchor: StageMenuAnchor
  orderNumber: string
  stageLabel: string
  /** aktualna wartość komórki ('' = pusta, inicjały albo stan specjalny) */
  currentValue: string
  onPickNA: () => void
  onPickHold: () => void
  /** zdjęcie stanu specjalnego → komórka pusta */
  onClear: () => void
  onClose: () => void
}

/**
 * Menu kierownika na komórce etapu (prawy klik): Nie dotyczy / Wstrzymane / Wznów.
 * Własne, nie natywne; zamyka Escape, klik poza, przewinięcie strony.
 * Komórka z inicjałami: stanów nie da się nałożyć na czyjąś pracę — najpierw
 * cofnięcie etapu (lewy klik), żeby nie zgubić po cichu, kto to robił.
 */
export default function StageSpecialMenu({
  anchor,
  orderNumber,
  stageLabel,
  currentValue,
  onPickNA,
  onPickHold,
  onClear,
  onClose,
}: StageSpecialMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchor.x, top: anchor.y })
  const special = isStageSpecial(currentValue)
  const hasInitials = currentValue.trim() !== '' && !special
  const reason = stageHoldReason(currentValue)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const pad = 8
    const left = Math.max(pad, Math.min(anchor.x, window.innerWidth - r.width - pad))
    const top = Math.max(pad, Math.min(anchor.y, window.innerHeight - r.height - pad))
    setPos({ left, top })
  }, [anchor.x, anchor.y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onScroll = () => onClose()
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])

  return createPortal(
    <div ref={ref} className="stage-special-menu" role="menu" style={{ left: pos.left, top: pos.top }}>
      <div className="stage-special-menu-head">
        <strong>{orderNumber}</strong> · {stageLabel}
        {special && (
          <div className="stage-special-menu-current">
            Teraz: {isStageNA(currentValue) ? 'nie dotyczy' : `wstrzymane${reason ? ` (${reason})` : ''}`}
          </div>
        )}
      </div>
      {hasInitials ? (
        <div className="stage-special-menu-note">
          Etap ma już wpis „{currentValue.trim()}". Najpierw cofnij etap (lewy klik), potem ustaw stan.
        </div>
      ) : (
        <>
          {!isStageNA(currentValue) && (
            <button type="button" role="menuitem" className="stage-special-menu-item" onClick={onPickNA}>
              <span className="stage-special-menu-swatch stage-special-menu-swatch--na">—</span>
              <span>
                <b>Nie dotyczy</b>
                <small>Etap niepotrzebny w tym zleceniu. Liczy się jako zrobiony, nikt go nie robi, rezerwacja części na ten etap wraca na magazyn.</small>
              </span>
            </button>
          )}
          <button type="button" role="menuitem" className="stage-special-menu-item" onClick={onPickHold}>
            <span className="stage-special-menu-swatch stage-special-menu-swatch--hold">⏸</span>
            <span>
              <b>{isStageHold(currentValue) ? 'Zmień powód wstrzymania' : 'Wstrzymane…'}</b>
              <small>Czekamy (klient, materiał). Hala widzi powód, NASTĘPNE omija.</small>
            </span>
          </button>
          {special && (
            <button type="button" role="menuitem" className="stage-special-menu-item" onClick={onClear}>
              <span className="stage-special-menu-swatch stage-special-menu-swatch--clear">↺</span>
              <span>
                <b>{isStageHold(currentValue) ? 'Wznów' : 'Zdejmij „nie dotyczy"'}</b>
                <small>{isStageHold(currentValue) ? 'Komórka wraca do pustej — do normalnego odhaczenia.' : 'Komórka wraca do pustej, rezerwacja części na ten etap wraca.'}</small>
              </span>
            </button>
          )}
        </>
      )}
      <button type="button" className="stage-special-menu-cancel" onClick={onClose}>
        Anuluj
      </button>
    </div>,
    document.body,
  )
}
