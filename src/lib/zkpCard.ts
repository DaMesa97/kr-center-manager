// =====================================================================
// ZKP AS 75EI — karta wyrobu (zał. 6.25) i rejestr wyrobów (6.33).
// Reguły (tabela K, lista 6.10.5 per zakres, partie przyjęte, zwolnienie)
// pilnuje baza: migrate/zkp_05_karta_wyrobu.sql. Tu typy, etykiety i
// podpowiedzi widoku (filtr partii, bieżące wpisy).
// =====================================================================
import type { ZkpCriticalKind, ZkpMaterialLot, ZkpComponent } from './zkp'

export type ZkpRangeCode = 'EI30' | 'EI30S' | 'EI60' | 'EI60S' | 'S'
/** okna techniczne poza zakresem ZKP (brief pkt 5) */
export type ZkpProductType = 'drzwi_wewn' | 'drzwi_zewn'
export type ZkpOpening = 'do_wewnatrz' | 'na_zewnatrz'
export type ZkpEvacuation = 'nie' | 'EN179' | 'EN1125'
export type ZkpLight = 'brak' | 'nadswietle' | 'doswietle_L' | 'doswietle_P'
export type ZkpStageResult = 'OK' | 'NOK' | 'nd'
export type ZkpCardDecision = 'zwolniony' | 'niezgodny'

export type ZkpRange = {
  code: ZkpRangeCode
  sort: number
  label: string
  report: string
  classification: string
  transom_w: number | null
  side_w: number | null
  fill_min: number
  fill_max: number
  pins_mandatory: boolean
  gaps: Record<'A' | 'B' | 'C', Record<'zaw' | 'zamk' | 'nad', number>>
}

export type ZkpProductCard = {
  id: number
  construction_id: number
  order_id: number
  product_type: ZkpProductType | null
  leaves: 1 | 2 | null
  opening: ZkpOpening | null
  hand: 'L' | 'P' | null
  range_code: ZkpRangeCode | null
  evacuation: ZkpEvacuation
  light: ZkpLight
  type_code: string
  active_w: number | null
  active_h: number | null
  passive_w: number | null
  passive_h: number | null
  light_w: number | null
  light_h: number | null
  leaf_mass_kg: number | null
  fill_thickness_mm: number | null
  hinges_count: number | null
  pins_count: number | null
  fill_ref: string
  profiles_ref: string
  threshold_ref: string
  mounting_ref: string
  profiles_ok: boolean
  threshold_ok: boolean
  hardware_ok: boolean
  mounting_ok: boolean
  range_confirmed_at: string | null
  range_confirmed_by_name: string
  range_reopen_reason: string
  decision: ZkpCardDecision | null
  test_protocol_no: string
  declaration_no: string
  nonconformity_ref: string
  released_on: string | null
  decision_notes: string
  decided_at: string | null
  decided_by_name: string
}

/** Pola części A/B wysyłane do zkp_save_card (liczby jako tekst z formularza). */
export type ZkpCardForm = {
  product_type: ZkpProductType | ''
  leaves: '' | '1' | '2'
  opening: ZkpOpening | ''
  hand: '' | 'L' | 'P'
  range_code: ZkpRangeCode | ''
  evacuation: ZkpEvacuation
  light: ZkpLight
  active_w: string
  active_h: string
  passive_w: string
  passive_h: string
  light_w: string
  light_h: string
  leaf_mass_kg: string
  fill_thickness_mm: string
  hinges_count: string
  pins_count: string
  fill_ref: string
  profiles_ref: string
  threshold_ref: string
  mounting_ref: string
  profiles_ok: boolean
  threshold_ok: boolean
  hardware_ok: boolean
  mounting_ok: boolean
}

export type ZkpCardCheck = { r_sort: number; r_key: string; r_label: string; r_value: string | null; r_limit: string; r_ok: boolean }

export type ZkpGaps = Record<'A' | 'B' | 'C', Record<'zaw' | 'zamk' | 'nad', number | null>>

export type ZkpStageRecord = {
  id: number
  card_id: number
  stage_key: ZkpStageKey
  catalog_no: string
  lot_id: number | null
  result: ZkpStageResult
  gaps: ZkpGaps | null
  notes: string
  operator: string
  recorded_at: string
  recorded_by_name: string
}

export type ZkpHardwareRecord = {
  id: number
  card_id: number
  slot: ZkpHardwareSlot
  producer_model: string
  dwu_no: string
  count: number
  condition_ref: string
  lot_id: number | null
  recorded_at: string
  recorded_by_name: string
}

export type ZkpFillingRecord = {
  id: number
  card_id: number
  field: ZkpFillingField
  table_row: string
  product: string
  thickness_mm: number | null
  dims: string
  lot_id: number | null
  recorded_at: string
  recorded_by_name: string
}

/** Wiersz zkp_product_register — rejestr wyrobów 6.33 (konstrukcja + karta). */
export type ZkpRegisterRow = {
  r_construction_id: number
  r_construction_no: string
  r_year: number
  r_zz: number
  r_pp: number
  r_status: 'aktywna' | 'anulowana'
  r_order_id: number
  r_order_number: string
  r_company: string | null
  r_pos_no: number
  r_started_at: string | null
  r_release_date: string | null
  r_card_id: number | null
  r_product_type: ZkpProductType | null
  r_range_code: ZkpRangeCode | null
  r_type_code: string | null
  r_leaves: number | null
  r_active_w: number | null
  r_active_h: number | null
  r_range_confirmed: boolean | null
  r_decision: ZkpCardDecision | null
  r_test_protocol_no: string | null
  r_declaration_no: string | null
  r_released_on: string | null
  r_decided_by_name: string | null
  r_decided_at: string | null
  r_mont_doc: boolean
}

// ── Słowniki ─────────────────────────────────────────────────────────────
export const ZKP_PRODUCT_TYPE_LABELS: Record<ZkpProductType, string> = {
  drzwi_wewn: 'Drzwi wewnętrzne',
  drzwi_zewn: 'Drzwi zewnętrzne',
}
export const ZKP_OPENING_LABELS: Record<ZkpOpening, string> = { do_wewnatrz: 'do wewnątrz', na_zewnatrz: 'na zewnątrz' }
export const ZKP_EVACUATION_LABELS: Record<ZkpEvacuation, string> = { nie: 'nie', EN179: 'PN-EN 179', EN1125: 'PN-EN 1125' }
export const ZKP_LIGHT_LABELS: Record<ZkpLight, string> = {
  brak: 'brak',
  nadswietle: 'nadświetle',
  doswietle_L: 'doświetle L',
  doswietle_P: 'doświetle P',
}

export type ZkpStageKey =
  | 'ciecie' | 'wklady' | 'usz_skrzydlo' | 'usz_prog' | 'usz_wypelnienie' | 'usz_styk'
  | 'laczenie' | 'okucia' | 'szklenie' | 'regulacja'

/** Operacje z matrycy kompetencji (zał. 6.27) — instrukcje stanowiskowe, kontrola odbiorcza, montaż */
export type ZkpOperation = 'IS-01' | 'IS-02' | 'IS-03' | 'IS-04' | 'IS-05' | 'IS-06' | 'kontrola_odbiorcza' | 'montaz'

export const ZKP_OPERATIONS: Array<{ key: ZkpOperation; label: string; short: string }> = [
  { key: 'IS-01', label: 'IS-01 Cięcie i obróbka (CNC, piła)', short: 'IS-01' },
  { key: 'IS-02', label: 'IS-02 Wkłady ogniochronne', short: 'IS-02' },
  { key: 'IS-03', label: 'IS-03 Uszczelki pęczniejące, łączenie', short: 'IS-03' },
  { key: 'IS-04', label: 'IS-04 Okucia', short: 'IS-04' },
  { key: 'IS-05', label: 'IS-05 Szklenie / wypełnienia', short: 'IS-05' },
  { key: 'IS-06', label: 'IS-06 Regulacja', short: 'IS-06' },
  { key: 'kontrola_odbiorcza', label: 'Kontrola odbiorcza (6.17.5)', short: 'Kontrola' },
  { key: 'montaz', label: 'Montaż (6.28)', short: 'Montaż' },
]

/** Stanowiska wg zał. 6.1 (skład zakładu) */
export type ZkpPosition = 'wlasciciel' | 'pelnomocnik_kp' | 'zastepca' | 'operator_cnc' | 'monter' | 'pomocnik'
export const ZKP_POSITION_LABELS: Record<ZkpPosition, string> = {
  wlasciciel: 'Właściciel',
  pelnomocnik_kp: 'Pełnomocnik ZKP / Kierownik Produkcji',
  zastepca: 'Zastępca Pełnomocnika',
  operator_cnc: 'Operator CNC i piły',
  monter: 'Monter',
  pomocnik: 'Pomocnik montera',
}

export type ZkpCompetency = {
  id: number
  profile_id: string
  operation: ZkpOperation
  granted_on: string
  basis: string
  granted_by_name: string
  created_at: string
  withdrawn_at: string | null
  withdrawn_by_name: string
  withdraw_reason: string | null
}

export type ZkpPerson = { id: string; initials: string; full_name: string; zkp_position: ZkpPosition | null }

/** Osoby z aktywnym uprawnieniem do operacji (podpis etapu — zał. 6.27). */
export function peopleWithCompetency(people: ZkpPerson[], competencies: ZkpCompetency[], operation: ZkpOperation): ZkpPerson[] {
  const ids = new Set(competencies.filter((c) => c.operation === operation && !c.withdrawn_at).map((c) => c.profile_id))
  return people.filter((p) => ids.has(p.id)).sort((a, b) => a.initials.localeCompare(b.initials, 'pl'))
}

const POSITION_ORDER: Record<string, number> = { wlasciciel: 0, pelnomocnik_kp: 1, zastepca: 2, operator_cnc: 3, monter: 4, pomocnik: 5 }

/** Wiersze matrycy 6.27: osoby ze stanowiskiem ZKP albo z jakimkolwiek uprawnieniem (reszta po zaznaczeniu „wszyscy"). */
export function matrixPeople(people: ZkpPerson[], competencies: ZkpCompetency[], all: boolean): ZkpPerson[] {
  const withAny = new Set(competencies.map((c) => c.profile_id))
  return people
    .filter((p) => all || p.zkp_position || withAny.has(p.id))
    .sort((a, b) => (POSITION_ORDER[a.zkp_position ?? ''] ?? 9) - (POSITION_ORDER[b.zkp_position ?? ''] ?? 9) || a.initials.localeCompare(b.initials, 'pl'))
}

export type ZkpStageDef = {
  key: ZkpStageKey
  no: string
  label: string
  /** operacja z matrycy 6.27, którą podpisuje operator etapu — lustro zkp_stage_operation */
  operation: ZkpOperation
  /** etap krytyczny (K) — oznaczenie z zał. 6.25 */
  critical: boolean
  /** rodzaj komponentu partii — partia obowiązkowa przy OK, nr katalogowy z listy 6.10.5 zakresu */
  lotKind: ZkpCriticalKind | null
  /** dozwolone „n/d" */
  allowNa: boolean
}

export const ZKP_STAGES: ZkpStageDef[] = [
  { key: 'ciecie', no: '1', label: 'Cięcie i obróbka (IS-01)', operation: 'IS-01', critical: false, lotKind: null, allowNa: false },
  { key: 'wklady', no: '2', label: 'Wkłady ogniochronne (IS-02) — wg 6.10.5 B.5', operation: 'IS-02', critical: true, lotKind: 'wklad', allowNa: false },
  { key: 'usz_skrzydlo', no: '3a', label: 'Uszczelki pęczniejące — obwiednia skrzydła (IS-03)', operation: 'IS-03', critical: true, lotKind: 'uszczelka', allowNa: false },
  { key: 'usz_prog', no: '3b', label: 'Uszczelki pęczniejące — ramiak progowy / próg (IS-03)', operation: 'IS-03', critical: true, lotKind: 'uszczelka', allowNa: true },
  { key: 'usz_wypelnienie', no: '3c', label: 'Uszczelki pęczniejące — obwiednia wypełnienia (IS-03)', operation: 'IS-03', critical: true, lotKind: 'uszczelka', allowNa: false },
  { key: 'usz_styk', no: '3d', label: 'Uszczelki pęczniejące — styk z profilem odwracającym / ścianą (IS-03)', operation: 'IS-03', critical: true, lotKind: 'uszczelka', allowNa: true },
  { key: 'laczenie', no: '4', label: 'Łączenie profili, uszczelki przymykowe, narożniki, próg (IS-03)', operation: 'IS-03', critical: false, lotKind: null, allowNa: false },
  { key: 'okucia', no: '5', label: 'Okucia (IS-04) — wg cz. D', operation: 'IS-04', critical: true, lotKind: null, allowNa: false },
  { key: 'szklenie', no: '6', label: 'Szklenie / wypełnienie (IS-05) — wg cz. E', operation: 'IS-05', critical: true, lotKind: null, allowNa: false },
  { key: 'regulacja', no: '7', label: 'Regulacja (IS-06) — szczeliny A/B/C', operation: 'IS-06', critical: true, lotKind: null, allowNa: false },
]

export type ZkpHardwareSlot =
  | 'zamek' | 'przeciwzamek' | 'klamka' | 'zawiasy' | 'trzpienie' | 'samozamykacz' | 'rkz' | 'elektro' | 'odwodnienie'

export const ZKP_HARDWARE_SLOTS: Array<{ key: ZkpHardwareSlot; label: string }> = [
  { key: 'zamek', label: 'Zamek główny / elektrozaczep' },
  { key: 'przeciwzamek', label: 'Przeciwzamek / zamek dodatkowy / ryglowanie skrzydła biernego' },
  { key: 'klamka', label: 'Klamka / gałka / dźwignia przeciwpaniczna' },
  { key: 'zawiasy', label: 'Zawiasy (liczba wg tabeli K)' },
  { key: 'trzpienie', label: 'Trzpienie antywyważeniowe' },
  { key: 'samozamykacz', label: 'Samozamykacz' },
  { key: 'rkz', label: 'Regulator kolejności zamykania / wspomaganie otwierania' },
  { key: 'elektro', label: 'Elektrotrzymacz / zwora / kontaktron / kontrola dostępu / przepust kablowy' },
  { key: 'odwodnienie', label: 'Odwodnienie / kratka wentylacyjna (tylko jeżeli dopuszczone w zakresie)' },
]

export type ZkpFillingField = 'czynne' | 'bierne' | 'nadswietle' | 'doswietle'
export const ZKP_FILLING_FIELDS: Array<{ key: ZkpFillingField; label: string }> = [
  { key: 'czynne', label: 'Skrzydło czynne' },
  { key: 'bierne', label: 'Skrzydło bierne' },
  { key: 'nadswietle', label: 'Nadświetle' },
  { key: 'doswietle', label: 'Doświetle' },
]

export const ZKP_GAP_SIDES = [
  { key: 'zaw', label: 'zawiasowa' },
  { key: 'zamk', label: 'zamkowa / przeciwzamkowa' },
  { key: 'nad', label: 'nadprożowa' },
] as const

// ── Reguły widoku ────────────────────────────────────────────────────────

/** Najnowszy wpis na klucz (wpisy tylko dopisywane — bieżący = najwyższe id). */
export function latestBy<T extends { id: number }, K extends string>(rows: T[], key: (r: T) => K): Map<K, T> {
  const out = new Map<K, T>()
  for (const r of rows) {
    const k = key(r)
    const cur = out.get(k)
    if (!cur || r.id > cur.id) out.set(k, r)
  }
  return out
}

/** Pola wypełnień wymagane przez część A (jak zkp_card_release_problems). */
export function requiredFillingFields(card: Pick<ZkpProductCard, 'leaves' | 'light'>): ZkpFillingField[] {
  const out: ZkpFillingField[] = ['czynne']
  if (card.leaves === 2) out.push('bierne')
  if (card.light === 'nadswietle') out.push('nadswietle')
  if (card.light === 'doswietle_L' || card.light === 'doswietle_P') out.push('doswietle')
  return out
}

/** Token nr katalogowego jak w zkp_catalog_allowed: litera + 3–4 cyfry (+ XX / 2 cyfry koloru). */
export function catalogToken(catalog: string): string | null {
  const m = /[A-Za-z][0-9]{3,4}(?:[Xx]{2}|[0-9]{2})?/.exec(catalog.replace(/\s/g, ''))
  return m ? m[0].toUpperCase() : null
}

/** Lustro zkp_catalog_allowed — do filtrowania partii w oknie (baza i tak sprawdza). */
export function catalogAllowed(allowedCodes: Set<string>, catalog: string): boolean {
  const tok = catalogToken(catalog)
  if (!tok) return false
  if (allowedCodes.has(tok)) return true
  for (const code of allowedCodes) {
    if (code.endsWith('XX') && new RegExp(`^${code.slice(0, -2)}([0-9]{2}|XX)$`).test(tok)) return true
  }
  return false
}

/** Partie do wyboru w etapie: przyjęte, właściwego rodzaju i (dla etapów K) z listy zakresu. */
export function lotsForStage(
  lots: ZkpMaterialLot[],
  components: ZkpComponent[],
  kind: ZkpCriticalKind | ZkpCriticalKind[],
  allowedCodes: Set<string> | null,
): ZkpMaterialLot[] {
  const kinds = Array.isArray(kind) ? kind : [kind]
  const kindById = new Map(components.map((c) => [c.id, c.zkp_critical_kind]))
  return lots.filter((l) => {
    if (l.decision !== 'przyjeto') return false
    const k = kindById.get(l.component_id)
    if (!k || !kinds.includes(k)) return false
    return allowedCodes ? catalogAllowed(allowedCodes, l.catalog_no) : true
  })
}

export type ZkpCardStatus = 'brak' | 'szkic' | 'zakres' | 'zwolniony' | 'niezgodny'
export const ZKP_CARD_STATUS_LABELS: Record<ZkpCardStatus, string> = {
  brak: 'brak karty',
  szkic: 'szkic — zakres do potwierdzenia',
  zakres: 'w produkcji',
  zwolniony: 'zwolniony',
  niezgodny: 'niezgodny',
}

export function cardStatus(row: { card_id: number | null; range_confirmed: boolean | null; decision: ZkpCardDecision | null }): ZkpCardStatus {
  if (row.card_id == null) return 'brak'
  if (row.decision) return row.decision
  return row.range_confirmed ? 'zakres' : 'szkic'
}

/** Formularz A/B z karty (albo pusty). Typ zawsze wybiera człowiek — okna techniczne są poza ZKP. */
export function cardToForm(card: ZkpProductCard | null): ZkpCardForm {
  const n = (v: number | null | undefined) => (v == null ? '' : String(v))
  if (!card) {
    return {
      product_type: '',
      leaves: '', opening: '', hand: '', range_code: '', evacuation: 'nie', light: 'brak',
      active_w: '', active_h: '', passive_w: '', passive_h: '', light_w: '', light_h: '',
      leaf_mass_kg: '', fill_thickness_mm: '', hinges_count: '', pins_count: '',
      fill_ref: '', profiles_ref: '', threshold_ref: '', mounting_ref: '',
      profiles_ok: false, threshold_ok: false, hardware_ok: false, mounting_ok: false,
    }
  }
  return {
    product_type: card.product_type ?? '',
    leaves: card.leaves ? (String(card.leaves) as '1' | '2') : '',
    opening: card.opening ?? '',
    hand: card.hand ?? '',
    range_code: card.range_code ?? '',
    evacuation: card.evacuation,
    light: card.light,
    active_w: n(card.active_w), active_h: n(card.active_h),
    passive_w: n(card.passive_w), passive_h: n(card.passive_h),
    light_w: n(card.light_w), light_h: n(card.light_h),
    leaf_mass_kg: n(card.leaf_mass_kg), fill_thickness_mm: n(card.fill_thickness_mm),
    hinges_count: n(card.hinges_count), pins_count: n(card.pins_count),
    fill_ref: card.fill_ref, profiles_ref: card.profiles_ref, threshold_ref: card.threshold_ref, mounting_ref: card.mounting_ref,
    profiles_ok: card.profiles_ok, threshold_ok: card.threshold_ok, hardware_ok: card.hardware_ok, mounting_ok: card.mounting_ok,
  }
}

/** Formularz → JSON dla zkp_save_card (liczby z przecinkiem dziesiętnym też). */
export function formToPayload(f: ZkpCardForm): Record<string, string | boolean> {
  const num = (s: string) => s.trim().replace(',', '.')
  return {
    ...f,
    active_w: num(f.active_w), active_h: num(f.active_h), passive_w: num(f.passive_w), passive_h: num(f.passive_h),
    light_w: num(f.light_w), light_h: num(f.light_h), leaf_mass_kg: num(f.leaf_mass_kg),
    fill_thickness_mm: num(f.fill_thickness_mm), hinges_count: num(f.hinges_count), pins_count: num(f.pins_count),
  }
}

/** Kod typu wyrobu wg zał. 6.8 — lustro zkp_type_code (podgląd przed zapisem). */
export function zkpTypeCode(f: Pick<ZkpCardForm, 'product_type' | 'range_code' | 'leaves' | 'opening' | 'evacuation'>): string {
  if (!f.product_type || !f.range_code || !f.leaves) return ''
  const zew = f.product_type === 'drzwi_zewn'
  const cls = f.range_code === 'S' ? 'S' : f.range_code.slice(0, 4)
  const smoke = f.range_code.endsWith('S') ? 'S' : '–'
  const dir = zew ? `-${f.opening === 'do_wewnatrz' ? 'DW' : f.opening === 'na_zewnatrz' ? 'NZ' : '?'}` : ''
  return `AS75EI-${zew ? 'Z' : 'W'}-${cls}-${smoke}-${f.leaves}${dir}-${f.evacuation === 'nie' ? '–' : 'E'}`
}
