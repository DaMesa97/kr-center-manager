type ConfigSelectProps = {
  label: string
  options: string[]
  value: string
  onChange: (v: string) => void
  isOptionExcluded?: (option: string) => boolean
}

export default function ConfigSelect({
  label,
  options,
  value,
  onChange,
  isOptionExcluded,
}: ConfigSelectProps) {
  const empty = options.length === 0
  return (
    <label className="order-field-full">
      <span className="order-field-label-text">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={empty}>
        <option value="">{empty ? 'Brak opcji - dodaj w konfiguracji' : '— wybierz —'}</option>
        {options.map((v, i) => {
          const excluded = isOptionExcluded?.(v) ?? false
          return (
            <option
              key={`${v}-${i}`}
              value={v}
              disabled={excluded}
              style={excluded ? { color: '#9ca3af' } : undefined}
            >
              {v}
            </option>
          )
        })}
      </select>
    </label>
  )
}
