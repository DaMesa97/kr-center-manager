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
  ],

  [R.KIER_MAGAZYNU]: [
    'orders.view', 'orders.create', 'orders.edit', 'orders.release', 'stages.markAny',
    'comments.write', 'shipping.view', 'prices.view',
    'warehouse.movements', 'warehouse.manage', 'warehouse.ordering',
    'review.handle', 'stats.view', 'audit.view', 'labels.print', 'labels.manageTemplates',
  ],

  // KP = KF (bez różnicy) — pełna firma poza panelem admina
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

  // Admin obsłużony osobno (wszystko) — pusta lista nie ma znaczenia
  [R.ADMIN]: [],
}

// Stare role (zgodność wsteczna w okresie przejściowym, zanim wszyscy przemigrują)
const LEGACY_MANAGER = new Set(['manager'])

export function isAdminRole(role: string | null | undefined): boolean {
  return role === R.ADMIN
}

// "Kierownik" = role z szerokimi uprawnieniami (do gate'ów typu dawne isManager).
export function isManagerRole(role: string | null | undefined): boolean {
  const r = String(role ?? '')
  if (LEGACY_MANAGER.has(r)) return true
  return r === R.ADMIN || r === R.KIER_DZIALU || r === R.KIER_MAGAZYNU || r === R.KIER_PRODUKCJI || r === R.KIER_FIRMOWY
}

export function can(role: string | null | undefined, perm: Permission): boolean {
  const r = String(role ?? '')
  if (r === R.ADMIN) return true // superrola
  if (LEGACY_MANAGER.has(r)) return true // stary 'manager' ~ pełny dostęp (okres przejściowy)
  return (ROLE_PERMISSIONS[r] ?? []).includes(perm)
}

// Czy rola jest "zawężona" do przypisanych kategorii (PP, KD)?
export function isCategoryScoped(role: string | null | undefined): boolean {
  return can(role, 'categories.scoped') && !isAdminRole(role)
}
