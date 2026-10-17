import { useMemo } from 'react'
import type { DbProfileRow } from '../types'
import Spinner from './Spinner'
import DataTable, { type DataTableColumn } from './DataTable'
import { appConfirm, appPrompt } from '../lib/appDialogs'

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

  return (
    <>
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
