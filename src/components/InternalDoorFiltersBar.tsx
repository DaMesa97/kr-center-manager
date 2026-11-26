import { useOptimaSync } from '../hooks/useOptimaSync'
import {
  INT_DOOR_FILTER_DEFAULT,
  OPTIMA_BAZA_LABEL,
  formatOptimaDateTime,
  isIntDoorFilterActive,
  syncErrors,
  type IntDoorFilter,
  type OptimaBaza,
} from '../lib/optimaRo'
import type { ToastVariant } from '../types'

type Props = {
  filter: IntDoorFilter
  onChange: (f: IntDoorFilter) => void
  /** zleceń bez komponentu na bieżącej liście (przed filtrem „bez komponentu") */
  unmappedOrders: number
  /** „Synchronizuj teraz" — tylko kierownicy (current_user_is_manager) */
  canSync: boolean
  onImported: () => void
  pushToast: (message: string, variant: ToastVariant) => void
}

/** Filtry zakładki Drzwi wewnętrzne (baza / źródło / bez komponentu) + stan importu z Optimy. */
export default function InternalDoorFiltersBar({ filter, onChange, unmappedOrders, canSync, onImported, pushToast }: Props) {
  const { states, running, runNow } = useOptimaSync(pushToast, onImported)
  const errorCount = states.reduce((n, s) => n + syncErrors(s).length, 0)

  return (
    <div className="int-door-filters">
      <label className="int-door-filter">
        <span>Źródło</span>
        <select value={filter.zrodlo} onChange={(e) => onChange({ ...filter, zrodlo: e.target.value as IntDoorFilter['zrodlo'] })}>
          <option value="all">Wszystkie</option>
          <option value="optima">Z Optimy</option>
          <option value="manual">Ręczne</option>
        </select>
      </label>
      <label className="int-door-filter">
        <span>Baza</span>
        <select
          value={filter.baza}
          onChange={(e) => onChange({ ...filter, baza: e.target.value as IntDoorFilter['baza'] })}
          title="Baza Optimy, z której przyszło RO (ręczne zlecenia nie mają bazy)"
        >
          <option value="all">KR Center i MR Profil</option>
          {(Object.keys(OPTIMA_BAZA_LABEL) as OptimaBaza[]).map((b) => (
            <option key={b} value={b}>{OPTIMA_BAZA_LABEL[b]}</option>
          ))}
        </select>
      </label>
      <label className="orders-filter-checkbox" title="Zlecenia z pozycjami, których kodu z Optimy nie powiązano z komponentem magazynu">
        <input
          type="checkbox"
          checked={filter.bezKomponentu}
          onChange={(e) => onChange({ ...filter, bezKomponentu: e.target.checked })}
        />
        <span>
          Tylko bez komponentu{unmappedOrders > 0 && <span className="optima-unmapped-badge" style={{ marginLeft: 6 }}>{unmappedOrders}</span>}
        </span>
      </label>
      {isIntDoorFilterActive(filter) && (
        <button type="button" className="date-filter-clear" onClick={() => onChange(INT_DOOR_FILTER_DEFAULT)} title="Wyczyść filtry drzwi wewnętrznych">
          ✕
        </button>
      )}

      <div className="int-door-sync" title="Import rezerwacji odbiorcy z Optimy — automatycznie co godzinę">
        <span className="muted">Optima:</span>
        {states.length === 0 ? (
          <span className="muted">brak danych o synchronizacji</span>
        ) : (
          states.map((s) => (
            <span key={s.baza} className="int-door-sync-item">
              {OPTIMA_BAZA_LABEL[s.baza as OptimaBaza] ?? s.baza} {s.last_run_at ? formatOptimaDateTime(new Date(s.last_run_at).toLocaleString('sv-SE')) : '—'}
            </span>
          ))
        )}
        {errorCount > 0 && (
          <span className="optima-unmapped-badge" title="Szczegóły: Ustawienia → Integracje → Optima → Drzwi wewnętrzne">
            ⚠ błędy: {errorCount}
          </span>
        )}
        {canSync && (
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => void runNow()} disabled={running}>
            {running ? 'Synchronizuję…' : 'Synchronizuj teraz'}
          </button>
        )}
      </div>
    </div>
  )
}
