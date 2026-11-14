import { useMemo, useState } from 'react'
import type { DbProfileRow, ToastVariant } from '../types'
import Spinner from './Spinner'
import DataTable, { type DataTableColumn } from './DataTable'
import { appConfirm, appPrompt } from '../lib/appDialogs'
import CrmAccessSection from './crm/CrmAccessSection'

// Legenda ról — to samo, co macierz w lib/permissions.ts, ludzkim językiem.
// Aktualizować przy zmianach macierzy!
const ROLE_LEGEND: Array<{ role: string; opis: string }> = [
  { role: 'pracownik_produkcji', opis: 'Widzi przypisane kategorie, oznacza TYLKO swoje przypisane etapy (przycisk „Etapy produkcji"), dodaje komentarze i drukuje etykiety.' },
  { role: 'magazynier', opis: 'Podgląd zleceń + Wysyłka + ruchy magazynowe (PZ/MM). Bez edycji zleceń, komponentów i receptur.' },
  { role: 'obsluga_klienta', opis: 'Podgląd wszystkich zleceń + komentarze + druk etykiet. Bez edycji.' },
  { role: 'kierownik_dzialu', opis: 'Pełny kierownik (tworzenie/edycja/wydawanie zleceń, etapy, magazyn, weryfikacja, statystyki) — ale TYLKO w przypisanych kategoriach. Np. brygadzista STA. Sam zakłada konta pracowników produkcji w swoich kategoriach, edytuje je, przypisuje etapy i resetuje hasła (nie usuwa kont, nie zmienia ról).' },
  { role: 'kierownik_magazynu', opis: 'Pełna firma, wszystkie kategorie — bez oznaczania „gotowe do fakturowania".' },
  { role: 'kierownik_produkcji', opis: 'Pełna firma, wszystkie kategorie, wszystko poza panelem administracyjnym.' },
  { role: 'admin', opis: 'Wszystko + grupa Ustawienia (Konfiguracja, Kontrahenci, Użytkownicy, Integracje). Ceny widzą tylko kierownicy i admin. NIE widzi CRM Po Drzwi, chyba że superadministrator nada mu dostęp.' },
  { role: 'superadmin', opis: 'Właściciel: wszystko co administrator + moduł CRM Po Drzwi i nadawanie do niego dostępu. Tylko superadministrator nadaje i odbiera tę rolę oraz zarządza kontami innych superadministratorów.' },
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
  /** twarde usuwanie kont — tylko admin */
  canDelete: boolean
  /** null = admin (wszyscy); tablica = kierownik działu widzi tylko pracowników produkcji z tych kategorii */
  scopedCategories: string[] | null
  /** superadmin: sekcja „Dostęp do CRM Po Drzwi” i przyciski przy kontach innych superadminów */
  isSuperadmin?: boolean
  pushToast?: (message: string, variant: ToastVariant) => void
  /** po zmianie listy dostępu do CRM (App odświeża widoczność zakładki) */
  onCrmAccessChanged?: () => void
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
  canDelete,
  scopedCategories,
  isSuperadmin = false,
  pushToast,
  onCrmAccessChanged,
}: UsersViewProps) {
  // Kierownik działu: tylko konta, którymi baza pozwoli mu zarządzać
  // (pracownik produkcji, wszystkie kategorie w jego kategoriach) — inaczej
  // klikałby w przyciski, które kończą się błędem uprawnień.
  const visibleProfiles = useMemo(() => {
    if (scopedCategories == null) return profiles
    return profiles.filter(
      (p) =>
        p.role === 'pracownik_produkcji' &&
        (p.categories ?? []).length > 0 &&
        (p.categories ?? []).every((c) => scopedCategories.includes(c)),
    )
  }, [profiles, scopedCategories])

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
        render: (row) => {
          // Konto superadministratora: hasło / dezaktywacja / usunięcie tylko dla
          // superadmina (manage-users odpowiada 403, baza blokuje usunięcie) — nie-superadmin
          // widzi tylko Edytuj (imię, inicjały; roli i tak nie zmieni)
          const lockedSuperadmin = row.role === 'superadmin' && !isSuperadmin
          if (lockedSuperadmin) {
            return (
              <div className="contractor-actions">
                <button type="button" className="btn btn-sm btn-primary" onClick={() => onEditUser(row)}>
                  Edytuj
                </button>
                <span className="user-modal-hint" title="Hasło, dezaktywację i usunięcie konta superadministratora obsługuje tylko superadministrator">
                  konto superadministratora
                </span>
              </div>
            )
          }
          return (
          <div className="contractor-actions">
            {/* Kierownik działu też pracuje na stanowisku (brygadzista) —
                bez przypisań jego „Moje stanowisko" było puste */}
            {(row.role === 'pracownik_produkcji' || row.role === 'worker' || row.role === 'kierownik_dzialu') && (
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
            {canDelete && (
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
            )}
          </div>
          )
        },
      },
    ]
  }, [currentUserId, canDelete, isSuperadmin, onEditUser, onDeleteUser, onDeactivateUser, onResetPassword, onManageWorkerStages, getRoleLabel, getDepartmentLabel])

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

      {scopedCategories != null && (
        <p className="user-modal-hint users-scope-hint">
          Jako kierownik działu widzisz i zakładasz tylko konta <b>pracowników produkcji</b> w kategoriach:{' '}
          <b>{scopedCategories.length > 0 ? scopedCategories.join(', ') : '(brak przypisanych kategorii — poproś administratora)'}</b>.
          Nowe konto: „Dodaj użytkownika" u góry. Zapomniane hasło: przycisk „Hasło". Etapy na stanowisku: „Etapy produkcji".
        </p>
      )}

      {profilesLoading ? (
        <Spinner center label="Ładowanie użytkowników…" />
      ) : (
        <DataTable
          rows={visibleProfiles}
          rowKey={(r) => r.id}
          columns={columns}
          className="contractors-table users-table"
          emptyText={scopedCategories != null ? 'Brak kont pracowników produkcji w Twoich kategoriach. Dodaj pierwsze przyciskiem „Dodaj użytkownika".' : 'Brak użytkowników w bazie.'}
        />
      )}

      {/* CRM Po Drzwi: kto widzi moduł — tylko superadmin (RLS crm.dostep) */}
      {isSuperadmin && !profilesLoading && pushToast && (
        <CrmAccessSection profiles={profiles} currentUserId={currentUserId} pushToast={pushToast} onChanged={onCrmAccessChanged} />
      )}
    </>
  )
}
