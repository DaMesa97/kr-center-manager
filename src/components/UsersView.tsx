import { useMemo, useState } from 'react'
import type { DbProfileRow } from '../types'
import Spinner from './Spinner'
import DataTable, { type DataTableColumn } from './DataTable'
import { appConfirm, appPrompt } from '../lib/appDialogs'

// Legenda ról — to samo, co macierz w lib/permissions.ts, ludzkim językiem.
// Aktualizować przy zmianach macierzy!
const ROLE_LEGEND: Array<{ role: string; opis: string }> = [
  { role: 'pracownik_produkcji', opis: 'Widzi przypisane kategorie, oznacza TYLKO swoje przypisane etapy (przycisk „Etapy produkcji"), dodaje komentarze i drukuje etykiety.' },
  { role: 'magazynier', opis: 'Podgląd zleceń + Wysyłka + ruchy magazynowe (PZ/MM). Bez edycji zleceń, komponentów i receptur.' },
  { role: 'obsluga_klienta', opis: 'Podgląd wszystkich zleceń + komentarze + druk etykiet. Bez edycji.' },
  { role: 'kierownik_dzialu', opis: 'Pełny kierownik (tworzenie/edycja/wydawanie zleceń, etapy, magazyn, weryfikacja, statystyki) — ale TYLKO w przypisanych kategoriach. Np. brygadzista STA.' },
  { role: 'kierownik_magazynu', opis: 'Pełna firma, wszystkie kategorie — bez oznaczania „gotowe do fakturowania".' },
  { role: 'kierownik_produkcji', opis: 'Pełna firma, wszystkie kategorie, wszystko poza panelem administracyjnym.' },
  { role: 'admin', opis: 'Wszystko + panel administracyjny (Użytkownicy, Konfiguracja, Klucze API, Kontrahenci). Ceny widzą tylko kierownicy i admin.' },
]

type UsersViewProps = {
  profilesLoading: boolean
  profiles: DbProfileRow[]
  currentUserId?: string
  onEditUser: (row: DbProfileRow) => void
  onDeleteUser: (row: DbProfileRow) => void
  onDeactivateUser: (row: DbProfileRow, deactivate: boolean) => void | Promise<void>
  onResetPassword: (row: DbProfileRow, newPassword: string) => Promise<boolean> | boolean | void
  onManageWorkerStages: (row: DbProfileRow) => void
  getRoleLabel: (role: string) => string
  getDepartmentLabel: (department: string, role: string) => string
}

export default function UsersView({
  profilesLoading,
  profiles,
  currentUserId,
  onEditUser,
  onDeleteUser,
  onDeactivateUser,
  onResetPassword,
  onManageWorkerStages,
  getRoleLabel,
  getDepartmentLabel,
}: UsersViewProps) {
  const columns = useMemo<DataTableColumn<DbProfileRow>[]>(() => {
    const deptText = (row: DbProfileRow) =>
      row.categories && row.categories.length > 0
        ? row.categories.join(', ')
        : getDepartmentLabel(row.department, row.role)
    return [
      { key: 'full_name', label: 'Imię i nazwisko', sortValue: (r) => r.full_name, render: (r) => r.full_name },
      { key: 'initials', label: 'Inicjały', sortValue: (r) => r.initials, render: (r) => r.initials },
      { key: 'role', label: 'Rola', sortValue: (r) => getRoleLabel(r.role), render: (r) => getRoleLabel(r.role) },
      { key: 'department', label: 'Kategorie / Dział', sortValue: deptText, render: deptText },
      {
        key: 'actions',
        label: 'Akcje',
        render: (row) => (
          <div className="contractor-actions">
            {(row.role === 'pracownik_produkcji' || row.role === 'worker') && (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => onManageWorkerStages(row)}>
                Etapy produkcji
              </button>
            )}
            <button type="button" className="btn btn-sm btn-primary" onClick={() => onEditUser(row)}>
              Edytuj
            </button>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              title="Ustaw nowe hasło użytkownika"
              onClick={() => {
                void (async () => {
                  const pw = await appPrompt(`Nowe hasło dla ${row.full_name} (min. 6 znaków):`, {
                    title: 'Reset hasła',
                    confirmLabel: 'Zmień hasło',
                    inputType: 'password',
                  })
                  if (pw) void onResetPassword(row, pw)
                })()
              }}
            >
              Hasło
            </button>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              disabled={row.id === currentUserId}
              title="Zablokuj logowanie bez usuwania historii (odblokowanie: ten sam przycisk)"
              onClick={() => {
                void (async () => {
                  const deactivate = await appConfirm(
                    `Dezaktywować konto ${row.full_name}? (logowanie zablokowane, historia zostaje). Jeśli konto jest już dezaktywowane — zostanie odblokowane.`,
                    { title: 'Dezaktywacja konta', confirmLabel: 'Dezaktywuj' },
                  )
                  if (deactivate) {
                    void onDeactivateUser(row, true)
                  }
                })()
              }}
            >
              Dezaktywuj
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={row.id === currentUserId}
              title="Odblokuj wcześniej dezaktywowane konto"
              onClick={() => void onDeactivateUser(row, false)}
            >
              Aktywuj
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => onDeleteUser(row)}
              disabled={row.id === currentUserId}
              title={
                row.id === currentUserId
                  ? 'Nie można usunąć własnego konta'
                  : 'Twarde usunięcie — zadziała tylko dla kont bez historii (ruchy magazynowe, ZD). W innym wypadku użyj Dezaktywuj.'
              }
            >
              Usuń
            </button>
          </div>
        ),
      },
    ]
  }, [currentUserId, onEditUser, onDeleteUser, onDeactivateUser, onResetPassword, onManageWorkerStages, getRoleLabel, getDepartmentLabel])

  const [legendOpen, setLegendOpen] = useState(false)

  return (
    <>
      <div className="role-legend">
        <button type="button" className="role-legend-toggle" onClick={() => setLegendOpen((v) => !v)}>
          {legendOpen ? '▾' : '▸'} Legenda ról — kto co może
        </button>
        {legendOpen && (
          <div className="role-legend-body">
            {ROLE_LEGEND.map((l) => (
              <div key={l.role} className="role-legend-row">
                <span className="role-legend-name">{getRoleLabel(l.role)}</span>
                <span className="role-legend-desc">{l.opis}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {profilesLoading ? (
        <Spinner center label="Ładowanie użytkowników…" />
      ) : (
        <DataTable
          rows={profiles}
          rowKey={(r) => r.id}
          columns={columns}
          className="contractors-table users-table"
          emptyText="Brak użytkowników w bazie."
        />
      )}
    </>
  )
}
