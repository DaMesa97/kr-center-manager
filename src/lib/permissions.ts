// =====================================================================
// Model ról i uprawnień (RBAC). Jedno źródło prawdy — zamiast isManager wszędzie.
// =====================================================================

export const ROLES = {
  OBSLUGA: 'obsluga_klienta',
  PRODUKCJA: 'pracownik_produkcji',
  MAGAZYNIER: 'magazynier',
  KIER_DZIALU: 'kierownik_dzialu',
  KIER_MAGAZYNU: 'kierownik_magazynu',
  KIER_PRODUKCJI: 'kierownik_produkcji',
  KIER_FIRMOWY: 'kierownik_firmowy',
  ADMIN: 'admin',
  // Właściciel (CRM Po Drzwi, 14.11.2026): wszystko co admin + moduł CRM i nadawanie
  // dostępu do niego. Rolę nadaje/odbiera tylko superadmin (trigger
  // trg_protect_superadmin_role w bazie). Widoczność CRM NIE wynika z roli, tylko
  // z rpc current_user_has_crm() (superadmin albo wpis w crm.dostep).
  SUPERADMIN: 'superadmin',
} as const

export type Role = (typeof ROLES)[keyof typeof ROLES]

export const ROLE_LABELS: Record<string, string> = {
  obsluga_klienta: 'Obsługa klienta',
  pracownik_produkcji: 'Pracownik produkcji',
  magazynier: 'Magazynier',
  kierownik_dzialu: 'Kierownik działu',
  kierownik_magazynu: 'Kierownik magazynu',
  kierownik_produkcji: 'Kierownik produkcji',
  kierownik_firmowy: 'Kierownik firmowy',
  admin: 'Administrator',
  superadmin: 'Superadministrator',
}

export type Permission =
  | 'orders.view'
  | 'orders.create'
  | 'orders.edit'          // edycja / anulowanie / przywracanie / zmiana kategorii
  | 'orders.release'       // wydanie + odbiór ościeżnicy
  | 'stages.markAny'       // oznacza dowolny etap
  | 'comments.write'
  | 'shipping.view'
  | 'shipping.invoice'     // „gotowe do fakturowania"
  | 'prices.view'          // wartość konfiguratora / ceny
  | 'warehouse.movements'  // stany + PZ/MM
  | 'warehouse.manage'     // komponenty + receptury
  | 'warehouse.ordering'   // zamawianie + inwentaryzacja
  | 'review.handle'        // weryfikacja BOT
  | 'stats.view'
  | 'audit.view'
  | 'labels.print'
  | 'labels.manageTemplates'
  | 'admin.panel'          // użytkownicy / konfiguracja / kontrahenci / klucze API
  | 'users.manageProduction' // zakłada/edytuje konta pracowników produkcji w swoich kategoriach, resetuje hasła
  | 'categories.scoped'    // widzi/działa tylko w przypisanych kategoriach (nie wszystkich)

const R = ROLES

// Macierz: jakie uprawnienia ma dana rola. Admin = wszystko (obsłużone w can()).
const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  [R.OBSLUGA]: ['orders.view', 'comments.write', 'labels.print'],

  [R.PRODUKCJA]: ['orders.view', 'comments.write', 'labels.print', 'categories.scoped'],
  // (oznaczanie etapów dla PP jest ograniczone do PRZYPISANYCH etapów — patrz canMarkStage)

  [R.MAGAZYNIER]: ['orders.view', 'comments.write', 'labels.print', 'shipping.view', 'warehouse.movements'],

  [R.KIER_DZIALU]: [
    'orders.view', 'orders.create', 'orders.edit', 'orders.release', 'stages.markAny',
    'comments.write', 'shipping.view', 'shipping.invoice', 'prices.view',
    'warehouse.movements', 'warehouse.manage', 'warehouse.ordering',
    'review.handle', 'stats.view', 'audit.view', 'labels.print', 'labels.manageTemplates',
    'categories.scoped', // KD widzi tylko przypisane kategorie
    'users.manageProduction', // zwiad #7 / decyzja 2.11.2026: KD sam zakłada konta i resetuje hasła
  ],

  [R.KIER_MAGAZYNU]: [
    'orders.view', 'orders.create', 'orders.edit', 'orders.release', 'stages.markAny',
    'comments.write', 'shipping.view', 'prices.view',
    'warehouse.movements', 'warehouse.manage', 'warehouse.ordering',
    'review.handle', 'stats.view', 'audit.view', 'labels.print', 'labels.manageTemplates',
  ],

  // KP = pełna firma poza panelem admina. KF scalony z KP (2026-10-21):
  // nie do przydzielania (usunięty z UserModal), macierz zostaje dla
  // zgodności wstecznej, gdyby gdzieś ostało się stare konto.
  [R.KIER_PRODUKCJI]: [
    'orders.view', 'orders.create', 'orders.edit', 'orders.release', 'stages.markAny',
    'comments.write', 'shipping.view', 'shipping.invoice', 'prices.view',
    'warehouse.movements', 'warehouse.manage', 'warehouse.ordering',
    'review.handle', 'stats.view', 'audit.view', 'labels.print', 'labels.manageTemplates',
  ],
  [R.KIER_FIRMOWY]: [
    'orders.view', 'orders.create', 'orders.edit', 'orders.release', 'stages.markAny',
    'comments.write', 'shipping.view', 'shipping.invoice', 'prices.view',
    'warehouse.movements', 'warehouse.manage', 'warehouse.ordering',
    'review.handle', 'stats.view', 'audit.view', 'labels.print', 'labels.manageTemplates',
  ],

  // Admin i superadmin obsłużone osobno (wszystko) — pusta lista nie ma znaczenia
  [R.ADMIN]: [],
  [R.SUPERADMIN]: [],
}

// Stare role (zgodność wsteczna w okresie przejściowym, zanim wszyscy przemigrują)
const LEGACY_MANAGER = new Set(['manager'])

// Admin ALBO superadmin — superadmin ma w całej reszcie systemu to samo, co admin
// (tak jak current_user_is_admin() w bazie).
export function isAdminRole(role: string | null | undefined): boolean {
  return role === R.ADMIN || role === R.SUPERADMIN
}

// Tylko superadmin: nadaje rolę superadmin, nadaje dostęp do CRM Po Drzwi,
// zarządza kontami innych superadminów.
export function isSuperadminRole(role: string | null | undefined): boolean {
  return role === R.SUPERADMIN
}

// "Kierownik" = role z szerokimi uprawnieniami (do gate'ów typu dawne isManager).
export function isManagerRole(role: string | null | undefined): boolean {
  const r = String(role ?? '')
  if (LEGACY_MANAGER.has(r)) return true
  return isAdminRole(r) || r === R.KIER_DZIALU || r === R.KIER_MAGAZYNU || r === R.KIER_PRODUKCJI || r === R.KIER_FIRMOWY
}

export function can(role: string | null | undefined, perm: Permission): boolean {
  const r = String(role ?? '')
  if (isAdminRole(r)) return true // superrola (admin, superadmin)
  if (LEGACY_MANAGER.has(r)) return true // stary 'manager' ~ pełny dostęp (okres przejściowy)
  return (ROLE_PERMISSIONS[r] ?? []).includes(perm)
}

// Kto wchodzi do zakładki Użytkownicy: admin (wszystko) albo kierownik działu
// (tylko pracownicy produkcji w swoich kategoriach — zob. usersScopeFor).
// Po stronie bazy pilnują tego polityki profiles_insert/update, trigger
// protect_profile_privileges i edge function manage-users.
export function canManageUsers(role: string | null | undefined): boolean {
  const r = String(role ?? '')
  return isAdminRole(r) || LEGACY_MANAGER.has(r) || can(r, 'users.manageProduction')
}

// null = bez ograniczeń (admin); tablica = tylko pracownicy produkcji w tych kategoriach
export function usersScopeFor(role: string | null | undefined, categories?: string[] | null): string[] | null {
  const r = String(role ?? '')
  if (isAdminRole(r) || LEGACY_MANAGER.has(r)) return null
  return categories ?? []
}

// Czy rola jest "zawężona" do przypisanych kategorii (PP, KD)?
export function isCategoryScoped(role: string | null | undefined): boolean {
  return can(role, 'categories.scoped') && !isAdminRole(role)
}
