import type React from 'react'
import type { Company } from '../types'

type CompanyAutocompleteProps = {
  inputId: string
  value: string
  filteredCompanies: Company[]
  showDropdown: boolean
  highlightedIndex: number
  hasError: boolean
  onChange: (value: string) => void
  onSelect: (company: Company) => void
  onFocus: () => void
  onKeyDown: React.KeyboardEventHandler<HTMLInputElement>
  onHighlightChange: (index: number) => void
  onClearError: () => void
}

function CompanyAutocomplete({
  inputId,
  value,
  filteredCompanies,
  showDropdown,
  highlightedIndex,
  hasError,
  onChange,
  onSelect,
  onFocus,
  onKeyDown,
  onHighlightChange,
  onClearError,
}: CompanyAutocompleteProps) {
  return (
    <div className={`order-field-full${hasError ? ' order-field-error' : ''}`}>
      <label className="order-field-label-text" htmlFor={inputId}>
        Nazwa firmy
      </label>
      <div className="company-autocomplete">
        <input
          id={inputId}
          type="text"
          autoComplete="off"
          value={value}
          onFocus={onFocus}
          onChange={(event) => {
            onHighlightChange(-1)
            onClearError()
            onChange(event.target.value)
            onFocus()
          }}
          onKeyDown={onKeyDown}
        />
        {showDropdown && filteredCompanies.length > 0 && (
          <div className="company-dropdown" role="listbox">
            {filteredCompanies.map((item, index) => (
              <button
                key={`${item.name}-${item.production_day}`}
                type="button"
                className={
                  highlightedIndex === index
                    ? 'company-option autocomplete-item autocomplete-item--highlighted'
                    : 'company-option autocomplete-item'
                }
                role="option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect(item)}
              >
                {item.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default CompanyAutocomplete
