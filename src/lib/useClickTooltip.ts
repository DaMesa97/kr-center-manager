import { useEffect, useRef, useState } from 'react'

/**
 * Dymek otwierany KLIKIEM (nie po najechaniu), renderowany w portalu pod
 * elementem-wyzwalaczem; zamyka go klik poza dymkiem, ponowny klik w wyzwalacz
 * albo Esc. Wspólny dla plakietek w NR ZLECENIA (magazyn, RO z Optimy) —
 * zgłoszenia #80/#81/#82: jeden sposób pokazywania szczegółów zamiast mieszanki
 * natywnych tooltipów i własnych okienek.
 *
 * `tooltipSelector` — klasa dymku w portalu, żeby klik w jego wnętrzu go nie zamykał.
 */
export function useClickTooltip<T extends HTMLElement>(tooltipSelector = '.stock-badge-tooltip') {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const triggerRef = useRef<T>(null)

  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, left: rect.left })
    }
  }, [open])

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
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, tooltipSelector])

  const toggle = (e?: { stopPropagation: () => void }) => {
    e?.stopPropagation()
    setOpen((o) => !o)
  }
  const close = () => setOpen(false)

  return { open, pos, triggerRef, toggle, close }
}
