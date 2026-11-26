import { useOptimaSync } from '../../hooks/useOptimaSync'
import { OPTIMA_BAZA_LABEL, OPTIMA_SYNC_COUNTERS, syncErrors, type OptimaBaza } from '../../lib/optimaRo'
import Spinner from '../Spinner'
import type { ToastVariant } from '../../types'

type Props = {
  /** „Synchronizuj teraz" — tylko kierownicy (RPC optima_ro_import_now sprawdza current_user_is_manager) */
  canSync: boolean
  pushToast: (message: string, variant: ToastVariant) => void
}

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString('pl-PL') : '—')

/**
 * Ustawienia → Integracje → Optima → Drzwi wewnętrzne: stan importu RO
 * (edge function optima-ro-import, pg_cron co godzinę) dla baz KR i MR.
 * Tylko odczyt optima_ro_sync_state + ręczne uruchomienie.
 */
export default function OptimaSyncCard({ canSync, pushToast }: Props) {
  const { states, loading, running, reload, runNow } = useOptimaSync(pushToast)

  return (
    <div className="config-main">
      <div className="config-main-header">
        <h2 className="config-main-title">Optima → Drzwi wewnętrzne</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => void reload()}>
            Odśwież
          </button>
          {canSync && (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void runNow()} disabled={running}>
              {running ? 'Synchronizuję…' : 'Synchronizuj teraz'}
            </button>
          )}
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Rezerwacje odbiorcy (RO) z pozycjami drzwi wewnętrznych z baz KR Center i MR Profil wpadają jako zlecenia w zakładce Drzwi
        wewnętrzne. Import działa automatycznie co godzinę; „Synchronizuj teraz” uruchamia go od razu (wynik po 1–2 minutach).
        {!canSync && ' Ręczne uruchomienie jest dostępne dla kierowników.'}
      </p>
      {loading ? (
        <Spinner center label="Wczytywanie stanu synchronizacji…" />
      ) : states.length === 0 ? (
        <p className="no-results">Brak danych — import jeszcze się nie uruchomił.</p>
      ) : (
        <div className="optima-sync-cards">
          {states.map((s) => {
            const errors = syncErrors(s)
            const r = s.last_result ?? {}
            return (
              <div key={s.baza} className={`optima-sync-card${errors.length > 0 ? ' optima-sync-card--error' : ''}`}>
                <div className="optima-sync-card-head">
                  <span className={`optima-badge optima-badge--${s.baza === 'MR' ? 'mr' : 'kr'}`}>
                    {OPTIMA_BAZA_LABEL[s.baza as OptimaBaza] ?? s.baza}
                  </span>
                  {canSync && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => void runNow(s.baza as OptimaBaza)}
                      disabled={running}
                      title={`Synchronizuj tylko ${OPTIMA_BAZA_LABEL[s.baza as OptimaBaza] ?? s.baza}`}
                    >
                      ↻ tylko ta baza
                    </button>
                  )}
                </div>
                <dl className="optima-readonly-grid">
                  <dt>Ostatnie uruchomienie</dt>
                  <dd>{fmt(s.last_run_at)}</dd>
                  <dt title="Data ostatniej zmiany RO w Optimie, od której import czyta przy następnym przebiegu">Kursor (zmiany od)</dt>
                  <dd>{fmt(s.last_u_date)}</dd>
                </dl>
                <div className="optima-sync-counters">
                  {OPTIMA_SYNC_COUNTERS.map(({ key, label }) => (
                    <span key={key} className="optima-sync-counter">
                      <strong>{Number(r[key] ?? 0)}</strong> {label}
                    </span>
                  ))}
                </div>
                {errors.length > 0 ? (
                  <div className="optima-sync-errors">
                    <strong>Błędy ({errors.length}):</strong>
                    <ul>
                      {errors.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="muted">Bez błędów</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
