import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { componentLabel, searchComponents } from '../lib/componentLabel'
import { PRODUCT_CATEGORY_LABELS } from '../constants'
import type { WarehouseComponent } from '../types'

type Props = {
  title: string
  /** opis tego, co wiążemy (np. kod i nazwa z Optimy) */
  subject?: ReactNode
  components: WarehouseComponent[]
  initialQuery?: string
  /** aktualnie przypisany komponent — podświetlony na liście */
  currentId?: number | null
  confirmLabel?: string
  busy?: boolean
  onPick: (component: WarehouseComponent) => void
  /** opcjonalnie: „Usuń powiązanie" */
  onClear?: () => void
  onClose: () => void
  /** dociągnij z bazy to, czego nie ma w components (np. kartoteki w tle, is_stocked = false) */
  remoteSearch?: (query: string) => Promise<WarehouseComponent[]>
}

/** Wyszukiwarka komponentów magazynu (kod / nazwa / model / kolor) w oknie. */
export default function ComponentPickerDialog({
  title,
  subject,
  components,
  initialQuery = '',
  currentId = null,
  confirmLabel = 'Powiąż',
  busy = false,
  onPick,
  onClear,
  onClose,
  remoteSearch,
}: Props) {
  const [query, setQuery] = useState(initialQuery)
  const [selectedId, setSelectedId] = useState<number | null>(currentId)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const [remote, setRemote] = useState<WarehouseComponent[]>([])
  useEffect(() => {
    if (!remoteSearch || query.trim().length < 2) {
      setRemote([])
      return
    }
    let alive = true
    const t = setTimeout(() => {
      remoteSearch(query)
        .then((r) => { if (alive) setRemote(r) })
        .catch((e) => console.error('[komponenty] szukanie w bazie', e))
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [query, remoteSearch])
  const pool = useMemo(() => {
    if (remote.length === 0) return components
    const ids = new Set(components.map((c) => c.id))
    return [...components, ...remote.filter((c) => !ids.has(c.id))]
  }, [components, remote])
  const hits = useMemo(() => searchComponents(pool, query), [pool, query])
  const selected = pool.find((c) => c.id === selectedId) ?? null

  return createPortal(
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="order-modal component-picker" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="order-modal-header">
          <h2>{title}</h2>
          <button className="btn btn-icon btn-ghost" onClick={onClose} disabled={busy} aria-label="Zamknij">
            ×
          </button>
        </div>
        <div className="order-modal-body component-picker-body">
        {subject && <div className="component-picker-subject">{subject}</div>}
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          placeholder="Szukaj komponentu: kod, nazwa, model, rozmiar, kolor…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits.length > 0) setSelectedId(hits[0].id)
          }}
        />
        <div className="component-picker-list" role="listbox" aria-label="Komponenty magazynu">
          {hits.length === 0 ? (
            <p className="no-results">Brak komponentów dla „{query}”. Dodaj komponent w Magazyn → Komponenty.</p>
          ) : (
            hits.map((c) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={c.id === selectedId}
                className={`component-picker-item${c.id === selectedId ? ' component-picker-item--active' : ''}`}
                onClick={() => setSelectedId(c.id)}
                onDoubleClick={() => !busy && onPick(c)}
              >
                <span className="component-picker-code">{c.code || '—'}</span>
                <span className="component-picker-name">{componentLabel(c)}</span>
                <span className="component-picker-cat">
                  {PRODUCT_CATEGORY_LABELS[c.product_category] ?? c.product_category}
                  {c.is_stocked === false && <span className="muted" title="Kartoteka w tle — towar na zamówienie, bez stanu"> · w tle</span>}
                </span>
              </button>
            ))
          )}
        </div>
        </div>
        <div className="order-form-actions">
          {onClear && (
            <button type="button" className="btn btn-danger" onClick={onClear} disabled={busy} style={{ marginRight: 'auto' }}>
              Usuń powiązanie
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Anuluj
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!selected || busy}
            onClick={() => selected && onPick(selected)}
            title={selected ? componentLabel(selected) : 'Wybierz komponent z listy'}
          >
            {busy ? 'Zapisywanie…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
