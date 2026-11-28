// =====================================================================
// ZKP AS 75EI — etap F (przyjęcia komponentów krytycznych, dostawcy
// kwalifikowani, lista 6.10.5): etykiety i reguły widoku. Te same reguły
// pilnuje baza (migrate/zkp_03_przyjecia.sql) — tu tylko podpowiedzi w UI.
// =====================================================================

export type ZkpCriticalKind = 'wklad' | 'uszczelka' | 'szklo' | 'wypelnienie' | 'okucie'
export type ZkpLotDecision = 'przyjeto' | 'kwarantanna' | 'zwrot'
export type ZkpAssessmentKind = 'wstepna' | 'okresowa'
export type ZkpAssessmentResult = 'pozytywna' | 'warunkowa' | 'negatywna'

export type ZkpComponent = {
  id: number
  code: string
  name: string
  unit: string
  category: string | null
  is_active: boolean
  zkp_critical_kind: ZkpCriticalKind | null
  zkp_model: string
  zkp_dwu_number: string
}

export type ZkpSupplier = { id: number; name: string; is_active: boolean }

export type ZkpSupplierQualification = {
  supplier_id: number
  scope: string
  is_critical: boolean
  required_quality_doc: string
  updated_at: string
  updated_by_name: string
}

export type ZkpSupplierAssessment = {
  id: number
  supplier_id: number
  kind: ZkpAssessmentKind
  assessed_on: string
  result: ZkpAssessmentResult
  notes: string
  next_assessment_on: string | null
  created_at: string
  created_by_name: string
}

export type ZkpMaterialLot = {
  id: number
  received_on: string
  supplier_id: number
  delivery_doc: string
  component_id: number
  catalog_no: string
  quantity: number
  lot_no: string
  quality_doc_kind: string
  quality_doc_no: string
  quality_doc_path: string | null
  conforms_to_order: boolean
  conforms_to_list_6105: boolean
  condition_ok: boolean
  condition_notes: string
  decision: ZkpLotDecision
  decision_reason: string
  pz_reference: string
  qty_issued: number
  received_by_name: string
  created_at: string
  decided_at: string | null
  decided_by_name: string
}

export const ZKP_CRITICAL_KIND_LABELS: Record<ZkpCriticalKind, string> = {
  wklad: 'Wkład ogniochronny',
  uszczelka: 'Uszczelka pęczniejąca',
  szklo: 'Szkło ogniochronne',
  wypelnienie: 'Wypełnienie nieprzezierne',
  okucie: 'Okucie',
}

export const ZKP_LOT_DECISION_LABELS: Record<ZkpLotDecision, string> = {
  przyjeto: 'Przyjęto',
  kwarantanna: 'Kwarantanna',
  zwrot: 'Zwrot',
}

export const ZKP_ASSESSMENT_KIND_LABELS: Record<ZkpAssessmentKind, string> = {
  wstepna: 'Wstępna',
  okresowa: 'Okresowa',
}

export const ZKP_ASSESSMENT_RESULT_LABELS: Record<ZkpAssessmentResult, string> = {
  pozytywna: 'Pozytywna',
  warunkowa: 'Warunkowa',
  negatywna: 'Negatywna',
}

/** Podpowiedzi rodzaju dokumentu jakości (pole w bazie jest tekstem — można wpisać inny). */
export const ZKP_QUALITY_DOC_KINDS = [
  'Deklaracja właściwości użytkowych',
  'Krajowa deklaracja właściwości użytkowych',
  'Świadectwo odbioru 3.1',
  'Atest',
  'Certyfikat',
]

/** Bucket na skany dokumentów jakości (prywatny, bez kasowania — zał. 6.34). */
export const ZKP_DOCUMENTS_BUCKET = 'zkp-documents'

// Uprawnienia jak w funkcjach bazy (current_user_has_zkp_role)
const hasAny = (roles: string[] | null | undefined, wanted: string[]) => (roles ?? []).some((r) => wanted.includes(r))
/** Rejestruje przyjęcie i uzupełnia partię w kwarantannie */
export const zkpCanReceive = (roles?: string[] | null) => hasAny(roles, ['magazyn', 'pelnomocnik', 'zastepca'])
/** Decyzja o partii z kwarantanny, wykaz dostawców, oceny, lista 6.10.5 */
export const zkpCanDecide = (roles?: string[] | null) => hasAny(roles, ['pelnomocnik', 'zastepca'])

/**
 * Powody, dla których baza zapisze przyjęcie „przyjeto” jako KWARANTANNĘ: brak nr partii albo dokumentu
 * jakości (brief pkt 8) oraz — D58 — każda niezgodność (zamówienie, lista 6.10.5, stan / opakowanie).
 */
export function zkpForcedQuarantineReasons(form: {
  decision: ZkpLotDecision
  lot_no: string
  quality_doc_no: string
  hasScan: boolean
  conforms_to_order?: boolean
  conforms_to_list_6105?: boolean
  condition_ok?: boolean
}): string[] {
  if (form.decision !== 'przyjeto') return []
  const why: string[] = []
  if (!form.lot_no.trim() || (!form.quality_doc_no.trim() && !form.hasScan)) why.push('brak nr partii lub dokumentu jakości')
  if (form.conforms_to_order === false) why.push('niezgodne z zamówieniem')
  if (form.conforms_to_list_6105 === false) why.push('niezgodne z listą 6.10.5')
  if (form.condition_ok === false) why.push('uwagi do stanu / opakowania')
  return why
}

/** Baza wymusi kwarantannę (patrz zkpForcedQuarantineReasons). */
export function zkpWillForceQuarantine(form: Parameters<typeof zkpForcedQuarantineReasons>[0]): boolean {
  return zkpForcedQuarantineReasons(form).length > 0
}

export type ZkpSupplierState = {
  onList: boolean
  /** na wykazie, ostatnia ocena pozytywna/warunkowa i termin kolejnej oceny nie minął (D58) — jak zkp_supplier_is_qualified */
  qualified: boolean
  last: ZkpSupplierAssessment | null
  nextDue: string | null
  /** ocena okresowa po terminie albo w ciągu `soonDays` dni */
  dueStatus: 'ok' | 'soon' | 'overdue' | 'none'
}

/** Stan dostawcy na wykazie 6.31 (ostatnia ocena = najpóźniejsza data, przy remisie wyższe id). */
export function zkpSupplierState(
  qualification: ZkpSupplierQualification | undefined,
  assessments: ZkpSupplierAssessment[],
  today: string,
  soonDays = 30,
): ZkpSupplierState {
  const sorted = [...assessments].sort((a, b) => b.assessed_on.localeCompare(a.assessed_on) || b.id - a.id)
  const last = sorted[0] ?? null
  const onList = !!qualification
  const nextDue = last?.next_assessment_on ?? null
  let dueStatus: ZkpSupplierState['dueStatus'] = 'none'
  if (nextDue) {
    const soon = addDays(today, soonDays)
    dueStatus = nextDue < today ? 'overdue' : nextDue <= soon ? 'soon' : 'ok'
  }
  // D58: po terminie oceny okresowej = niekwalifikowany
  const qualified =
    onList && !!last && (last.result === 'pozytywna' || last.result === 'warunkowa') && dueStatus !== 'overdue'
  return { onList, qualified, last, nextDue, dueStatus }
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return dt.toLocaleDateString('sv-SE')
}

/** Ścieżka skanu w buckecie: tylko ASCII (Storage odrzuca polskie znaki i spacje w kluczu). */
export function zkpScanPath(fileName: string, now = new Date()): string {
  const dot = fileName.lastIndexOf('.')
  const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : 'pdf'
  const base = (dot >= 0 ? fileName.slice(0, dot) : fileName)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'dokument'
  return `przyjecia/${now.getFullYear()}/${now.getTime()}_${base}.${ext || 'pdf'}`
}

// D57: ZKP na poziomie pozycji (jak alu_position_is_zkp w bazie, migracja 20261128035400)
/** System pozycji to AS 75EI (wyrób przeciwpożarowy). */
export const isAs75EiSystem = (system: string | null | undefined) => /75\s*-?\s*EI/i.test(system ?? '')
/** Pozycja podlega ZKP: ręczne oznaczenie zlecenia ma pierwszeństwo, inaczej system AS 75EI. */
export function aluPositionIsZkp(system: string | null | undefined, orderOverride: boolean | null | undefined): boolean {
  if (orderOverride === true || orderOverride === false) return orderOverride
  return isAs75EiSystem(system)
}
