import { PRODUCTION_DAYS } from '../constants'
import { DATE_PRESET_LABELS, describeDateRange, isDateFilterActive, type DateRangeFilter } from '../lib/dateRange'

const WYKONAWCA_OPTIONS = [
  { value: 'Center', label: 'CENTER', color: '#9b1c1c' },
  { value: 'Profil', label: 'PROFIL', color: '#16a34a' },
  { value: 'WZ', label: 'WZ', color: '#0369a1' },
]

type OrdersFiltersProps = {
  searchTerm: string
  selectedProductionDay: string
  hideCompletedOrders: boolean
  showCancelledOrders: boolean
  sourceFilter: 'all' | 'manual' | 'bot'
  sourceFilterCounts: { all: number; manual: number; bot: number }
  showSourceFilter: boolean
  wykonawcaFilter: string[]
  showWykonawcaFilter: boolean
  /** filtr dnia produkcji — aluminium ma termin z kalendarza, nie dzień tygodnia */
  showDayFilter?: boolean
  /** filtr dat zamówienia (presety + własny zakres) */
  dateFilter: DateRangeFilter
  onDateFilterChange: (v: DateRangeFilter) => void
  onSearchChange: (v: string) => void
  // Enter w polu = wyszukaj natychmiast (bez czekania na debounce)
  onSearchCommit?: (v: string) => void
  onDayChange: (v: string) => void
  onHideCompletedChange: (v: boolean) => void
  onShowCancelledChange: (v: boolean) => void
  onSourceFilterChange: (v: 'all' | 'manual' | 'bot') => void
  onWykonawcaFilterChange: (vals: string[]) => void
}

export default function OrdersFilters({
  searchTerm,
  selectedProductionDay,
  hideCompletedOrders,
  showCancelledOrders,
  wykonawcaFilter,
  showWykonawcaFilter,
  showDayFilter,
  dateFilter,
  onDateFilterChange,
  onSearchChange,
  onSearchCommit,
  onDayChange,
  onHideCompletedChange,
  onShowCancelledChange,
  onWykonawcaFilterChange,
}: OrdersFiltersProps) {

  const toggleWykonawca = (val: string) => {
    if (wykonawcaFilter.includes(val)) {
      onWykonawcaFilterChange(wykonawcaFilter.filter((v) => v !== val))
    } else {
      onWykonawcaFilterChange([...wykonawcaFilter, val])
    }
  }

  return (
    <div className="orders-filters">
      <input
        type="text"
        className="search-input"
        placeholder="Wyszukaj po numerze, firmie, systemie, modelu lub kolorze..."
        value={searchTerm}
        onChange={(event) => onSearchChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSearchCommit?.(event.currentTarget.value)
        }}
      />
      {showDayFilter !== false && (
        <select
          className="day-filter"
          value={selectedProductionDay}
          onChange={(event) => onDayChange(event.target.value)}
        >
          <option>Wszystkie dni</option>
          {PRODUCTION_DAYS.map((day) => (
            <option key={day}>{day}</option>
          ))}
        </select>
      )}
      <div className={`date-filter${isDateFilterActive(dateFilter) ? ' date-filter--active' : ''}`} title="Data zamówienia">
        <select
          className="day-filter date-filter-preset"
          value={dateFilter.preset}
          onChange={(e) => onDateFilterChange({ ...dateFilter, preset: e.target.value as DateRangeFilter['preset'] })}
        >
          {DATE_PRESET_LABELS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        {dateFilter.preset === 'custom' ? (
          <>
            <input
              type="date"
              className="day-filter date-filter-input"
              value={dateFilter.from}
              max={dateFilter.to || undefined}
              onChange={(e) => onDateFilterChange({ ...dateFilter, from: e.target.value })}
              title="Od (data zamówienia)"
            />
            <span className="date-filter-sep">–</span>
            <input
              type="date"
              className="day-filter date-filter-input"
              value={dateFilter.to}
              min={dateFilter.from || undefined}
              onChange={(e) => onDateFilterChange({ ...dateFilter, to: e.target.value })}
              title="Do (data zamówienia)"
            />
          </>
        ) : (
          isDateFilterActive(dateFilter) && <span className="date-filter-desc">{describeDateRange(dateFilter)}</span>
        )}
        {isDateFilterActive(dateFilter) && (
          <button
            type="button"
            className="date-filter-clear"
            onClick={() => onDateFilterChange({ preset: 'all', from: '', to: '' })}
            title="Wyczyść filtr dat"
          >
            ✕
          </button>
        )}
      </div>
      <div className="orders-filter-checkbox-row">
        <label className="orders-filter-checkbox">
          <input
            type="checkbox"
            checked={hideCompletedOrders}
            onChange={(event) => onHideCompletedChange(event.target.checked)}
          />
          <span>Ukryj zrealizowane</span>
        </label>
        <label className="orders-filter-checkbox">
          <input
            type="checkbox"
            checked={showCancelledOrders}
            onChange={(e) => onShowCancelledChange(e.target.checked)}
          />
          <span>Pokaż anulowane</span>
        </label>
      </div>

      {showWykonawcaFilter && (
        <div className="wykonawca-filter-row">
          <span className="wykonawca-filter-label">Wykonawca:</span>
          {WYKONAWCA_OPTIONS.map((opt) => {
            const active = wykonawcaFilter.includes(opt.value)
            return (
              <button
                key={opt.value}
                type="button"
                className="wykonawca-filter-pill"
                style={{
                  background: active ? opt.color : 'transparent',
                  color: active ? '#fff' : opt.color,
                  borderColor: opt.color,
                }}
                onClick={() => toggleWykonawca(opt.value)}
              >
                {opt.label}
              </button>
            )
          })}
          {wykonawcaFilter.length > 0 && (
            <button
              type="button"
              className="wykonawca-filter-clear"
              onClick={() => onWykonawcaFilterChange([])}
            >
              ✕ Wszystkie
            </button>
          )}
        </div>
      )}

    </div>
  )
}
