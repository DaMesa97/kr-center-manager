import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Dymek otwierany KLIKIEM (nie po najechaniu), renderowany w portalu przy
 * elemencie-wyzwalaczu; zamyka go klik poza dymkiem, ponowny klik w wyzwalacz,
 * Esc, scroll albo zmiana rozmiaru okna. Wspólny dla plakietek w NR ZLECENIA
 * (magazyn, RO z Optimy) i menu „⋯" w kolumnie Akcje — zgłoszenia #80/#81/#82,
 * od beta.93 także #126 (dymek uciekał poza ekran) i #132 (menu Akcje).
 *
 * Pozycja (#126, Łukasz 12.11.2026): po otwarciu mierzymy REALNY rozmiar dymka
 * (`tooltipRef`) i gdy nie mieści się pod wyzwalaczem — otwieramy nad nim;
 * w poziomie przycinamy do okna z marginesem 8 px. Scroll tabeli zamyka dymek,
 * bo pozycja `fixed` nie jedzie razem z wierszem.
 *
 * `tooltipSelector` — klasa dymku w portalu, żeby klik w jego wnętrzu go nie zamykał.
 */
const EDGE = 8
const GAP = 4

export type ClickTooltipPlacement = 'below' | 'above'

export function useClickTooltip<T extends HTMLElement>(tooltipSelector = '.stock-badge-tooltip') {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [placement, setPlacement] = useState<ClickTooltipPlacement>('below')
  const triggerRef = useRef<T>(null)
  const [tooltipEl, setTooltipEl] = useState<HTMLElement | null>(null)
  // callback ref: dymek montuje się w portalu dopiero po `open`, zwykły ref nie
  // wyzwoliłby ponownego pomiaru
  const tooltipRef = useCallback((el: HTMLElement | null) => setTooltipEl(el), [])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = tooltipEl?.offsetWidth ?? 0
    const h = tooltipEl?.offsetHeight ?? 0

    let top = rect.bottom + GAP
    let place: ClickTooltipPlacement = 'below'
    if (h > 0 && top + h > vh - EDGE && rect.top - GAP - h >= EDGE) {
      top = rect.top - GAP - h
      place = 'above'
    }
    // gdy nie mieści się ani pod, ani nad — przytnij do dołu okna (dymek ma własny scroll)
    if (h > 0 && top + h > vh - EDGE) top = Math.max(EDGE, vh - EDGE - h)

    let left = rect.left
    if (w > 0 && left + w > vw - EDGE) left = Math.max(EDGE, vw - EDGE - w)
    if (left < EDGE) left = EDGE

    setPos({ top, left })
    setPlacement(place)
  }, [open, tooltipEl])

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.closest(tooltipSelector) || triggerRef.current?.contains(t))) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    // scroll gdziekolwiek (tabela, strona) i resize — dymek jest `fixed`, zostałby w miejscu
    const onScroll = (e: Event) => {
      const t = e.target as Node | null
      if (t && tooltipEl && tooltipEl.contains(t)) return // scroll wewnątrz dymka
      setOpen(false)
    }
    const onResize = () => setOpen(false)
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, tooltipSelector, tooltipEl])

  const toggle = (e?: { stopPropagation: () => void }) => {
    e?.stopPropagation()
    setOpen((o) => !o)
  }
  const close = () => setOpen(false)

  return { open, pos, placement, triggerRef, tooltipRef, toggle, close }
}
