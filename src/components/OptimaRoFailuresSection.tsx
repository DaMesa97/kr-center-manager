import { useCallback, useEffect, useMemo, useState } from 'react'
import DataTable, { type DataTableColumn } from './DataTable'
import { fmtErpDate } from '../lib/erpStatus'
import {
  bazaLabel, failureLabel, failureStatus, fetchOptimaRoFailures, retryOptimaRoFailure, skipOptimaRoFailure,
  type OptimaRoFailure,
} from '../lib/optimaRoFailures'

/**
 * Weryfikacja → „Nieudane RO z Optimy” (D10, 28.11.2026). RO (rezerwacje odbiorcy) z KR Center i MR Profil,
 * których import drzwi wewnętrznych nie zdołał zapisać. Import sam ponawia (do 5 prób); „Ponów” oznacza RO
 * i od razu uruchamia import tej bazy, „Pomiń” zamyka wpis. Bez migracji 20261128036100 sekcja się nie pokazuje.
 */
export default function OptimaRoFailuresSection() {
  const [rows, setRows] = useState<OptimaRoFailure[] | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null)

  const load = useCallback(async () => {
    setRows(await fetchOptimaRoFailures())
  }, [])

  useEffect(() => { void load() }, [load])

  const act = useCallback(async (row: OptimaRoFailure, kind: 'ponow' | 'pomin') => {
    if (kind === 'pomin' && !window.confirm(`Pominąć ${failureLabel(row)}? Import nie będzie go już ponawiał (wróci, jeśli RO zmieni się w Optimie i znowu się nie zapisze).`)) return
    setBusyId(row.id)
    const err = kind === 'ponow' ? await retryOptimaRoFailure(row.id) : await skipOptimaRoFailure(row.id)
    setBusyId(null)
    setMsg(err
      ? { text: `Nie udało się: ${err}`, error: true }
      : { text: kind === 'ponow' ? `${failureLabel(row)}: import uruchomiony — odśwież listę za minutę.` : `${failureLabel(row)}: pominięte.`, error: false })
    await load()
  }, [load])

  const columns = useMemo<DataTableColumn<OptimaRoFailure>[]>(
    () => [
      { key: 'full_number', label: 'RO', sortValue: (r) => failureLabel(r), render: (r) => <strong>{failureLabel(r)}</strong> },
      { key: 'baza', label: 'Firma', sortValue: (r) => r.baza, render: (r) => bazaLabel(r.baza) },
      {
        key: 'error',
        label: 'Błąd zapisu',
        sortValue: (r) => r.error ?? '',
        render: (r) => <span className="erp-error-text">{r.error?.trim() || '—'}</span>,
      },
      { key: 'attempts', label: 'Stan', sortValue: (r) => r.attempts, render: (r) => failureStatus(r) },
      { key: 'last_failed_at', label: 'Ostatnia próba', sortValue: (r) => r.last_failed_at, render: (r) => fmtErpDate(r.last_failed_at) },
      {
        key: 'actions',
        label: 'Akcje',
        render: (r) => (
          <div className="contractor-actions">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={busyId === r.id}
              onClick={() => void act(r, 'ponow')}
              title="Uruchom import tej bazy teraz — to RO zostanie ponowione jako pierwsze (najpierw usuń przyczynę, np. kartotekę w Optimie)"
            >
              {busyId === r.id ? '…' : '↻ Ponów'}
            </button>
            <button type="button" className="btn btn-sm btn-secondary" disabled={busyId === r.id} onClick={() => void act(r, 'pomin')}>
              Pomiń
            </button>
          </div>
        ),
      },
    ],
    [busyId, act],
  )

  if (rows === null) return null

  return (
    <>
      <div className="orders-review-header" style={{ marginTop: 32 }} id="review-optima-ro">
        <h2>📥 Nieudane RO z Optimy (drzwi wewnętrzne)</h2>
        <p>
          RO z Optimy (KR Center i MR Profil), których import nie zdołał zapisać jako zlecenia. Import sam ponawia
          je przy kolejnych przebiegach (do 5 razy); potem tylko „Ponów”. Po udanym zapisie RO znika z listy.
        </p>
        <div className="orders-review-count">
          {rows.length} nieudanych RO{' '}
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => void load()}>Odśwież</button>
        </div>
        {msg && <p className={msg.error ? 'erp-error-text' : undefined}>{msg.text}</p>}
      </div>
      {rows.length === 0 ? (
        <p className="no-results">🎉 Brak nieudanych RO — wszystkie zaimportowane.</p>
      ) : (
        <DataTable rows={rows} rowKey={(r) => r.id} columns={columns} className="orders-review-table" rowClassName={() => 'orders-review-row'} />
      )}
    </>
  )
}
