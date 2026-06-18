import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search } from 'lucide-react'
import { supabase } from '../supabaseClient'
import Spinner from './Spinner'

type SearchResult = {
  id: number
  order_number: string
  category: string
  company: string
  model: string | null
  system: string | null
  client_order_number: string | null
  release_date: string | null
  extra_fields: unknown
}

type Props = {
  open: boolean
  onClose: () => void
  onNavigate: (order: SearchResult) => void
}

const CATEGORY_COLORS: Record<string, string> = {
  STA: '#005faf',
  Disting: '#4f46e5',
  ST: '#1d6d45',
  Techniczne: '#854d0e',
  Bastion: '#b3261e',
  DrzwiWewnetrzne: '#0369a1',
}

export default function GlobalSearch({ open, onClose, onNavigate }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchVersionRef = useRef(0)

  // Focus input gdy otwarte
  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setActiveIndex(0)
      // małe opóźnienie na zamontowanie portalu
      setTimeout(() => inputRef.current?.focus(), 50)
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [open])

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim()
    const version = ++searchVersionRef.current
    if (trimmed.length < 1) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    // Szukamy po numerze zlecenia, firmie, nr klienta, modelu — we wszystkich kategoriach
    // Escape wildcardów SQL (% _) i przecinka (separator w .or)
    const escaped = trimmed.replace(/[%_,]/g, '\\$&')
    const pattern = `%${escaped}%`
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, category, company, model, system, client_order_number, release_date, extra_fields')
      .or(
        `order_number.ilike.${pattern},company.ilike.${pattern},client_order_number.ilike.${pattern},model.ilike.${pattern}`,
      )
      .order('order_date', { ascending: false })
      .limit(25)
    // Ignoruj jeśli poleciało nowsze wyszukiwanie
    if (version !== searchVersionRef.current) return
    setLoading(false)
    if (error) {
      console.error('[GlobalSearch]', error)
      setResults([])
      return
    }
    setResults((data ?? []) as SearchResult[])
    setActiveIndex(0)
  }, [])

  const handleQueryChange = (v: string) => {
    setQuery(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void runSearch(v), 250)
  }

  const handleSelect = useCallback(
    (r: SearchResult) => {
      onNavigate(r)
      onClose()
    },
    [onNavigate, onClose],
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter' && results[activeIndex]) {
      e.preventDefault()
      handleSelect(results[activeIndex])
    }
  }

  if (!open) return null

  return createPortal(
    <div className="global-search-overlay" onClick={onClose}>
      <div className="global-search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="global-search-input-row">
          <Search size={18} className="global-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="global-search-input"
            placeholder="Szukaj zamówienia — nr zlecenia, firma, nr klienta, model…"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className="global-search-kbd">ESC</kbd>
        </div>

        <div className="global-search-results">
          {loading && <div className="global-search-empty"><Spinner center label="Szukam…" /></div>}
          {!loading && query.trim().length > 0 && results.length === 0 && (
            <div className="global-search-empty">Brak wyników dla „{query}"</div>
          )}
          {!loading && query.trim().length === 0 && (
            <div className="global-search-hint">
              Wpisz numer zlecenia, nazwę firmy, numer zamówienia klienta lub model.
              <br />
              <span className="global-search-hint-keys">↑↓ nawigacja · ↵ otwórz · ESC zamknij</span>
            </div>
          )}
          {results.map((r, i) => {
            const extra = r.extra_fields as Record<string, unknown> | null
            const cancelled = extra?.cancelled === true
            const wyk = extra?.wykonawca as string | undefined
            const released = r.release_date && r.release_date.trim() !== ''
            return (
              <button
                key={r.id}
                type="button"
                className={`global-search-result ${i === activeIndex ? 'global-search-result--active' : ''}`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => handleSelect(r)}
              >
                <span
                  className="global-search-result-cat"
                  style={{ background: CATEGORY_COLORS[r.category] ?? '#475569' }}
                >
                  {r.category === 'DrzwiWewnetrzne' ? 'Wewn.' : r.category}
                </span>
                <span className="global-search-result-nr">{r.order_number}</span>
                {wyk && <span className="global-search-result-wyk">{wyk}</span>}
                <span className="global-search-result-company">{r.company}</span>
                <span className="global-search-result-model">{r.model ?? ''}</span>
                <span className="global-search-result-flags">
                  {cancelled && <span className="global-search-flag global-search-flag--cancel">anul.</span>}
                  {released && <span className="global-search-flag global-search-flag--done">wydane</span>}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export type { SearchResult }
