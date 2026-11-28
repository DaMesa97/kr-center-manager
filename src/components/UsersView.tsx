import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DbProfileRow, ToastVariant } from '../types'
import Spinner from './Spinner'
import DataTable, { type DataTableColumn } from './DataTable'
import { appAlert, appConfirm, appPrompt } from '../lib/appDialogs'
import { ZKP_PIN_WLACZONY, zkpPinSetupFlow } from '../lib/zkpPin'
import { setZkpPin } from '../lib/zkpPinRpc'
import CrmAccessSection from './crm/CrmAccessSection'
import { fetchAccountStatus, type AccountStatus } from '../hooks/useUsers'

// Legenda ról — to samo, co macierz w lib/permissions.ts, ludzkim językiem.
// Aktualizować przy zmianach macierzy!
const ROLE_LEGEND: Array<{ role: string; opis: string }> = [
  { role: 'pracownik_produkcji', opis: 'Widzi przypisane kategorie, oznacza TYLKO swoje przypisane etapy (przycisk „Etapy produkcji"), dodaje komentarze i drukuje etykiety.' },
  { role: 'magazynier', opis: 'Podgląd zleceń + Wysyłka + ruchy magazynowe (PZ/MM). Bez edycji zleceń, komponentów i receptur.' },
  { role: 'obsluga_klienta', opis: 'Podgląd wszystkich zleceń + komentarze + druk etykiet. Bez edycji.' },
  { role: 'kierownik_dzialu', opis: 'Pełny kierownik (tworzenie/edycja/wydawanie zleceń, etapy, magazyn, weryfikacja, statystyki) — ale TYLKO w przypisanych kategoriach. Np. brygadzista STA. Sam zakłada konta pracowników produkcji w swoich kategoriach, edytuje je, przypisuje etapy i resetuje hasła (nie usuwa kont, nie zmienia ról).' },
  { role: 'kierownik_magazynu', opis: 'Pełna firma, wszystkie kategorie — bez oznaczania „gotowe do fakturowania".' },
  { role: 'kierownik_produkcji', opis: 'Pełna firma, wszystkie kategorie, wszystko poza panelem administracyjnym.' },
  { role: 'admin', opis: 'Wszystko + grupa Ustawienia (Konfiguracja, Kontrahenci, Użytkownicy, Integracje). Ceny widzą tylko kierownicy i admin.' },
  // rola 'superadmin' celowo poza legendą (Tymek 14.11: ma nie rzucać się w oczy)
]

type UsersViewProps = {
  profilesLoading: boolean
  profiles: DbProfileRow[]
  currentUserId?: string
  onEditUser: (row: DbProfileRow) => void
  onDeleteUser: (row: DbProfileRow) => void
  /** true = status konta się zmienił (lista odświeża plakietkę „zablokowane”) */
  onDeactivateUser: (row: DbProfileRow, deactivate: boolean) => boolean | void | Promise<boolean | void>
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

  // Testy 27.11 (runda 3): status kont z manage-users (list_status) — kto jest
  // zablokowany (ban w auth) i którymi kontami zarządza tylko superadmin
  // (superadmin albo dostęp do CRM Po Drzwi). null = nie wiadomo (stary widok przycisków).
  const [status, setStatus] = useState<Map<string, AccountStatus> | null>(null)
  const loadStatus = useCallback(async () => {
    setStatus(await fetchAccountStatus())
  }, [])
  useEffect(() => {
    if (profilesLoading) return
    void loadStatus()
  }, [profiles, profilesLoading, loadStatus])

  const runDeactivate = useCallback(
    async (row: DbProfileRow, deactivate: boolean) => {
      const changed = await onDeactivateUser(row, deactivate)
      if (changed !== false) await loadStatus()
    },
    [onDeactivateUser, loadStatus],
  )

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
        key: 'status',
        label: 'Status',
        sortValue: (r) => (status?.get(r.id)?.banned ? 1 : 0),
        render: (r) => {
          const st = status?.get(r.id)
          if (!st) return null
          return st.banned ? (
            <span className="badge badge-danger" title="Logowanie zablokowane (dezaktywowane). Odblokujesz przyciskiem „Odblokuj”.">
              zablokowane
            </span>
          ) : (
            <span className="badge badge-success">aktywne</span>
          )
        },
      },
      {
        key: 'actions',
        label: 'Akcje',
        render: (row) => {
          // Konto superadministratora: hasło / dezaktywacja / usunięcie tylko dla
          // superadmina (manage-users odpowiada 403, baza blokuje usunięcie) — nie-superadmin
          // widzi tylko Edytuj (imię, inicjały; roli i tak nie zmieni)
          // Testy 27.11 (runda 3): to samo dla konta z dostępem do CRM Po Drzwi
          // (status.locked z manage-users; roli też nie zmieni — pilnuje handleSaveUser)
          const lockedSuperadmin = row.role === 'superadmin' && !isSuperadmin
          const lockedCrm = !lockedSuperadmin && !isSuperadmin && !!status?.get(row.id)?.locked
          if (lockedSuperadmin || lockedCrm) {
            const what = lockedSuperadmin ? 'konto superadministratora' : 'konto z dostępem do CRM Po Drzwi'
            return (
              <div className="contractor-actions">
                <button type="button" className="btn btn-sm btn-primary" onClick={() => onEditUser(row)}>
                  Edytuj
                </button>
                <span className="user-modal-hint" title={`Hasło, rolę, dezaktywację i usunięcie (${what}) obsługuje tylko superadministrator`}>
                  {what}
                </span>
              </div>
            )
          }
          const banned = status?.get(row.id)?.banned
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
            {/* D53: PIN podpisu etapów ZKP — administrator ustawia (pracownik potem zmienia sam: „PIN ZKP”) */}
            {ZKP_PIN_WLACZONY && canDelete && (
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                title="Ustaw PIN do podpisu etapów ZKP (AS 75EI); pracownik może go potem zmienić sam"
                onClick={() => {
                  void zkpPinSetupFlow({
                    needCurrent: false,
                    whose: row.full_name || row.initials || 'pracownik',
                    ask: (message, title) => appPrompt(message, { title, confirmLabel: 'Dalej', inputType: 'password' }),
                    save: async (pin) => (await setZkpPin(row.id, pin)).error,
                    notify: async (message, ok) => {
                      if (ok) pushToast?.(`${message} — przekaż go pracownikowi; może go zmienić przyciskiem „PIN ZKP”`, 'success')
                      else await appAlert(message)
                    },
                  })
                }}
              >
                PIN ZKP
              </button>
            )}
            {/* Testy 27.11 (runda 3): okno obiecywało odblokowanie, a przycisk zawsze
                blokował. Teraz: aktywne → „Dezaktywuj”, zablokowane → „Odblokuj”;
                gdy statusu nie udało się pobrać — oba przyciski. */}
            {banned !== true && (
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                disabled={row.id === currentUserId}
                title="Zablokuj logowanie bez usuwania historii"
                onClick={() => {
                  void (async () => {
                    const deactivate = await appConfirm(
                      `Dezaktywować konto ${row.full_name}? Logowanie zostanie zablokowane, historia zostaje. Odblokować można później przyciskiem „Odblokuj”.`,
                      { title: 'Dezaktywacja konta', confirmLabel: 'Dezaktywuj' },
                    )
                    if (deactivate) void runDeactivate(row, true)
                  })()
                }}
              >
                Dezaktywuj
              </button>
            )}
            {banned !== false && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={row.id === currentUserId}
                title="Odblokuj logowanie dezaktywowanego konta"
                onClick={() => void runDeactivate(row, false)}
              >
                Odblokuj
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => onDeleteUser(row)}
                disabled={row.id === currentUserId}
                title={
                  row.id === currentUserId
                    ? 'Nie można usunąć własnego konta'
                    : 'Twarde usunięcie — tylko konto bez żadnej historii (ruchy magazynowe, ZD, inwentaryzacje, komentarze, zdjęcia, ZKP, CRM). Konto z historią system odrzuci z podaniem liczby wpisów — wtedy użyj Dezaktywuj.'
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
  }, [currentUserId, canDelete, isSuperadmin, status, runDeactivate, onEditUser, onDeleteUser, onResetPassword, onManageWorkerStages, getRoleLabel, getDepartmentLabel, pushToast])

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
