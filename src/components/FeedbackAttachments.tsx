import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { ImagePlus } from 'lucide-react'
import { MAX_FEEDBACK_FILES, mergePendingFiles, pickImageFiles, type FeedbackAttachment } from '../lib/feedbackAttachments'

/**
 * #125: zrzuty ekranu w zgłoszeniach.
 * - FeedbackAttachmentsInput — strefa „dodaj plik / przeciągnij / Ctrl+V" z miniaturami
 *   plików jeszcze niewysłanych (wysyłka dzieje się przy zapisie zgłoszenia).
 * - FeedbackAttachmentList — miniatury zapisanych załączników, klik = pełny podgląd.
 */

type InputProps = {
  files: File[]
  onChange: (files: File[]) => void
  /** komunikat o pominiętych plikach (zły typ / za duży / limit) */
  onSkipped?: (msg: string) => void
  disabled?: boolean
  compact?: boolean
}

export function FeedbackAttachmentsInput({ files, onChange, onSkipped, disabled, compact }: InputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  // podglądy lokalnych plików — URL-e zwalniamy przy zmianie listy
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files])
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])

  const add = (incoming: File[]) => {
    if (disabled || incoming.length === 0) return
    const { files: next, skipped } = mergePendingFiles(files, incoming)
    if (skipped) onSkipped?.(skipped)
    if (next.length !== files.length) onChange(next)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    add(pickImageFiles(e.dataTransfer?.files))
  }

  return (
    <div className="feedback-attach">
      <div
        className={`feedback-attach-zone${over ? ' feedback-attach-zone--over' : ''}`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        title="Kliknij, żeby wybrać plik; możesz też przeciągnąć obrazek albo wkleić zrzut (Ctrl+V) w polu treści"
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); inputRef.current?.click() } }}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <ImagePlus size={16} />
        <span>
          {compact ? 'Zrzut ekranu: plik, przeciągnij albo Ctrl+V' : 'Dodaj zrzut ekranu — wybierz plik, przeciągnij tutaj albo wklej Ctrl+V w polu treści'}
          {files.length > 0 && ` (${files.length}/${MAX_FEEDBACK_FILES})`}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          disabled={disabled}
          onChange={(e) => { add(pickImageFiles(e.target.files)); e.target.value = '' }}
        />
      </div>
      {files.length > 0 && (
        <div className="feedback-thumbs" style={{ marginTop: 6 }}>
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="feedback-thumb" title={f.name}>
              <img src={previews[i]} alt={f.name} />
              {!disabled && (
                <button type="button" className="feedback-thumb-remove" aria-label="Usuń zrzut" title="Usuń" onClick={(e) => { e.stopPropagation(); onChange(files.filter((_, j) => j !== i)) }}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

type ListProps = {
  items: FeedbackAttachment[]
  /** gdy podane — krzyżyk usuwania (tryb edycji) */
  onRemove?: (item: FeedbackAttachment) => void
}

export function FeedbackAttachmentList({ items, onRemove }: ListProps) {
  const [zoom, setZoom] = useState<FeedbackAttachment | null>(null)
  useEffect(() => {
    if (!zoom) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setZoom(null) } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [zoom])
  if (items.length === 0) return null
  return (
    <>
      <div className="feedback-thumbs feedback-item-attachments">
        {items.map((a) => (
          <span key={a.path} className="feedback-thumb feedback-thumb--link" title={`${a.name || 'zrzut'} — kliknij, żeby powiększyć`} onClick={() => setZoom(a)}>
            <img src={a.url} alt={a.name || 'zrzut ekranu'} loading="lazy" />
            {onRemove && (
              <button type="button" className="feedback-thumb-remove" aria-label="Usuń załącznik" title="Usuń załącznik" onClick={(e) => { e.stopPropagation(); onRemove(a) }}>
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {zoom &&
        createPortal(
          <div className="feedback-lightbox" role="dialog" aria-modal="true" aria-label={zoom.name || 'Zrzut ekranu'} onClick={() => setZoom(null)}>
            <img src={zoom.url} alt={zoom.name || 'zrzut ekranu'} />
          </div>,
          document.body,
        )}
    </>
  )
}
