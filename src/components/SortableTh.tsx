import type { SortState } from '../lib/tableSort'

type Props = {
  label: string
  sortKey: string
  state: SortState
  onToggle: (key: string) => void
  className?: string
}

// Klikalny nagłówek kolumny: ⇅ (nieaktywne) / ▲ (A→Z, 1→9) / ▼ (Z→A, 9→1)
export default function SortableTh({ label, sortKey, state, onToggle, className }: Props) {
  const active = state?.key === sortKey
  const arrow = !active ? '⇅' : state?.dir === 'asc' ? '▲' : '▼'
  return (
    <th
      className={`th-sortable ${active ? 'th-sortable--active' : ''} ${className ?? ''}`}
      onClick={() => onToggle(sortKey)}
      title={`Sortuj po: ${label}`}
    >
      <span className="th-sortable-inner">
        {label}
        <span className={`th-sort-arrow ${active ? 'th-sort-arrow--on' : ''}`}>{arrow}</span>
      </span>
    </th>
  )
}
