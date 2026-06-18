type Props = {
  label?: string
  size?: number
  /** wyśrodkowany blok z paddingiem — do pustych widoków/tabel */
  center?: boolean
  /** w jednej linii z tekstem — do przycisków/nagłówków */
  inline?: boolean
}

export default function Spinner({ label, size = 18, center = false, inline = false }: Props) {
  const cls = center ? 'spinner-wrap spinner-wrap--center' : inline ? 'spinner-wrap spinner-wrap--inline' : 'spinner-wrap'
  return (
    <div className={cls} role="status" aria-live="polite">
      <span className="spinner" style={{ width: size, height: size }} />
      {label && <span className="spinner-label">{label}</span>}
    </div>
  )
}
