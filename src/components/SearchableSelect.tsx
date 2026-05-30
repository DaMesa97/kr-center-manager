import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

type SearchableSelectProps = {
  value: string
  onChange: (val: string) => void
  options: string[]
  placeholder?: string
  isOptionDisabled?: (option: string) => boolean
  hasError?: boolean
  disabled?: boolean
}

export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = '— wybierz —',
  isOptionDisabled,
  hasError,
  disabled: selectDisabled,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [highlightedIdx, setHighlightedIdx] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = options.filter((o) => o.toLowerCase().includes(filter.toLowerCase()))

  useEffect(() => {
    if (selectDisabled) {
      setOpen(false)
      setFilter('')
      setHighlightedIdx(-1)
    }
  }, [selectDisabled])

  useEffect(() => {
    const handler = (e: Event) => {
      const t = e.target
      if (containerRef.current && t instanceof Node && !containerRef.current.contains(t)) {
        setOpen(false)
        setFilter('')
        setHighlightedIdx(-1)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = (val: string) => {
    onChange(val)
    setOpen(false)
    setFilter('')
    setHighlightedIdx(-1)
  }

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (!open) {
      if (e.key === 'Enter' || e.key === 'ArrowDown') {
        setOpen(true)
        e.preventDefault()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIdx((p) => Math.min(p + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIdx((p) => Math.max(p - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightedIdx >= 0 && filtered[highlightedIdx]) {
        if (!isOptionDisabled?.(filtered[highlightedIdx])) {
          handleSelect(filtered[highlightedIdx])
        }
      } else if (filtered.length > 0) {
        const first = filtered.find((o) => !isOptionDisabled?.(o))
        if (first) handleSelect(first)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setFilter('')
      setHighlightedIdx(-1)
    }
  }

  return (
    <div className="searchable-select" ref={containerRef}>
      <div
        className={`searchable-select__trigger${open ? ' searchable-select__trigger--open' : ''}${hasError ? ' searchable-select__trigger--error' : ''}${selectDisabled ? ' searchable-select__trigger--disabled' : ''}`}
        onClick={() => {
          if (selectDisabled) return
          setOpen((p) => !p)
          setTimeout(() => inputRef.current?.focus(), 0)
        }}
      >
        <span className={value ? '' : 'searchable-select__placeholder'}>{value || placeholder}</span>
        <span className="searchable-select__arrow">▾</span>
      </div>
      {open && !selectDisabled && (
        <div className="searchable-select__dropdown">
          <input
            ref={inputRef}
            className="searchable-select__search"
            placeholder="Szukaj..."
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value)
              setHighlightedIdx(-1)
            }}
            onKeyDown={handleKeyDown}
          />
          <div className="searchable-select__options">
            {filtered.length === 0 ? (
              <div className="searchable-select__empty">Brak wyników</div>
            ) : (
              filtered.map((opt, idx) => {
                const disabled = isOptionDisabled?.(opt) ?? false
                return (
                  <div
                    key={opt}
                    className={[
                      'searchable-select__option',
                      disabled ? 'searchable-select__option--disabled' : '',
                      highlightedIdx === idx ? 'searchable-select__option--highlighted' : '',
                      value === opt ? 'searchable-select__option--selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => !disabled && handleSelect(opt)}
                  >
                    {opt}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
