type FormInputProps = {
  label: string
  fieldKey?: string
  type?: 'text' | 'number' | 'textarea'
  value: string | number
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  rows?: number
  errors?: string[]
  onClearError?: (fieldKey: string) => void
  title?: string
}

function FormInput({
  label,
  fieldKey,
  type = 'text',
  value,
  onChange,
  placeholder,
  disabled,
  readOnly,
  rows,
  errors,
  onClearError,
  title,
}: FormInputProps) {
  return (
    <label
      className={`order-field-full${
        fieldKey && errors?.includes(fieldKey) ? ' order-field-error' : ''
      }`}
    >
      <span className="order-field-label-text">{label}</span>
      {type === 'textarea' ? (
        <textarea
          rows={rows ?? 3}
          value={value}
          onChange={(e) => {
            if (fieldKey && onClearError) onClearError(fieldKey)
            onChange(e.target.value)
          }}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readOnly}
          title={title}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => {
            if (fieldKey && onClearError) onClearError(fieldKey)
            onChange(e.target.value)
          }}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readOnly}
          title={title}
        />
      )}
    </label>
  )
}

export default FormInput
