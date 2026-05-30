import SearchableSelect from './SearchableSelect'

type SearchableConfigSelectProps = {
  label: string
  fieldKey?: string
  value: string
  options: string[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  errors?: string[]
  onClearError?: (fieldKey: string) => void
  isOptionDisabled?: (option: string) => boolean
}

function SearchableConfigSelect({
  label,
  fieldKey,
  value,
  options,
  onChange,
  placeholder = '— wybierz —',
  disabled,
  errors,
  onClearError,
  isOptionDisabled,
}: SearchableConfigSelectProps) {
  return (
    <label
      className={`order-field-full${
        fieldKey && errors?.includes(fieldKey) ? ' order-field-error' : ''
      }`}
    >
      <span className="order-field-label-text">{label}</span>
      <SearchableSelect
        value={value}
        onChange={(v) => {
          if (fieldKey && onClearError) onClearError(fieldKey)
          onChange(v)
        }}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        hasError={fieldKey ? errors?.includes(fieldKey) : false}
        isOptionDisabled={isOptionDisabled}
      />
    </label>
  )
}

export default SearchableConfigSelect
