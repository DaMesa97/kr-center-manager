// =====================================================================
// ZKP AS 75EI — protokół badań wyrobu gotowego (zał. 6.17.5), deklaracje
// KDWU / DWU (zał. 6.9), tabliczka 6.26 i etykieta 6.8. Reguły (kto, NOK =
// wstrzymany, numeracja deklaracji) pilnuje baza: migrate/zkp_07_protokol_deklaracje.sql.
// Tu typy, treść sprawdzeń z załącznika i pomocnicze do formularza / wydruku.
// =====================================================================
import type { ZkpProductCard, ZkpRange } from './zkpCard'

export type ZkpCheckResult = 'OK' | 'NOK' | 'nd'

export type ZkpProtocolEvalRow = {
  sort: number
  key: string
  label: string
  nominal: string
  measured: string
  criterion: string
  /** null = bez wyniku (brak pomiaru / oceny) */
  result: ZkpCheckResult | null
  auto: boolean
}

export type ZkpTestProtocol = {
  id: number
  card_id: number
  construction_id: number
  order_id: number
  attempt: number
  protocol_no: string
  produced_on: string | null
  inspected_on: string
  instruments: string
  checks: Record<string, ZkpCheckResult>
  measurements: Record<string, ZkpMeasurementInput>
  eval: ZkpProtocolEvalRow[]
  nok_count: number
  assessment: 'zgodny' | 'niezgodny' | null
  nonconformity_ref: string
  decision: 'zwolniony' | 'wstrzymany' | null
  notes: string
  inspector_initials: string
  saved_by_name: string
  created_at: string
  updated_at: string
  closed_at: string | null
  closed_by_name: string
}

/** Wpis pomiaru w formularzu: n = nominał (gdy wpisywany), m = zmierzone, t = tekst, r = ocena ręczna */
export type ZkpMeasurementInput = { n?: string; m?: string[]; t?: string; r?: ZkpCheckResult | '' }

export type ZkpCheckDef = { key: string; label: string; allowNa: boolean; criterion?: string; source?: string }

/** B. Przegląd dokumentacji */
export const ZKP_PROTOCOL_CHECKS_B: ZkpCheckDef[] = [
  { key: 'b1', label: 'Karta wyrobu cz. A–B: zakres raportu wskazany; limity z tabeli K potwierdzone i podpisane; dla S200 / Sa4 — brak nad- i doświetla', allowNa: false },
  { key: 'b2', label: 'Karta wyrobu cz. C: wszystkie etapy OK i podpisane; numery partii wkładów, uszczelek pęczniejących (każde miejsce) i szkła wpisane', allowNa: false },
  { key: 'b3', label: 'Karta wyrobu cz. D: okucia z zał. 6.10.5 cz. F dla zakresu; numery DWU wpisane; warunki komponentów dopuszczonych warunkowo potwierdzone', allowNa: false },
  { key: 'b4', label: 'Karta wyrobu cz. E: wypełnienia z wiersza tabeli raportu wskazanego w karcie (zał. 6.10.5 cz. D)', allowNa: false },
  { key: 'b5', label: 'Dokumenty jakości komponentów dostępne w rejestrze przyjęć (6.24) dla wpisanych partii', allowNa: false },
]

/** D. Oględziny */
export const ZKP_PROTOCOL_CHECKS_D: ZkpCheckDef[] = [
  { key: 'd1', label: 'Powłoka bez uszkodzeń; naroża szczelne, bez przesunięć', allowNa: false },
  { key: 'd2', label: 'Wkłady ogniochronne w komorach wg zał. 6.10.5 cz. B.5 (odkryte końce / zapis w karcie); komora zewnętrzna pusta. Zakres S: wkłady opcjonalne — zgodność z kartą', allowNa: true },
  { key: 'd3', label: 'Uszczelki pęczniejące wg miejsca (obwiednia skrzydła, próg, obwiednia wypełnienia, styk z profilem odwracającym) — numery jak w karcie, ciągłe, przyklejone. Zakres S: opcjonalne — zgodność z kartą', allowNa: true },
  { key: 'd4', label: 'Uszczelki przymykowe i narożniki ciągłe, bez przerw w narożach', allowNa: false },
  { key: 'd5', label: 'Rozwiązanie progowe / uszczelka opadająca zgodne z kartą (zał. 6.10.5 cz. C); uszczelka doszczelniająca (jeżeli stosowana)', allowNa: false },
  { key: 'd6', label: 'Listwy, uszczelki przyszybowe, kątowniki i podkładki wg zał. 6.10.5 cz. D', allowNa: false },
  { key: 'd7', label: 'Oznakowanie tafli szkła widoczne i zgodne z kartą wyrobu', allowNa: false },
  { key: 'd8', label: 'Okucia zamocowane kompletem elementów mocujących wg dokumentacji systemodawcy', allowNa: false },
]

/** E. Sprawdzenia funkcjonalne */
export const ZKP_PROTOCOL_CHECKS_E: ZkpCheckDef[] = [
  { key: 'e1', label: 'Samozamykanie: otwarcie na 90° i zwolnienie', criterion: 'domknięcie i zatrzaśnięcie', source: 'ZKP pkt 5.7 (klasa C z raportu)', allowNa: false },
  { key: 'e2', label: 'Domknięcie z 15°', criterion: 'zatrzaśnięcie', source: 'jw.', allowNa: false },
  { key: 'e3', label: 'Kolejność zamykania (2-skrz.)', criterion: 'bierne zamyka się pierwsze', source: 'zał. 6.10.5 cz. F (samozamykacz / RKZ, pkt .7.6)', allowNa: true },
  { key: 'e4', label: 'Zamek: wkładka, zapadka, rygiel; ryglowanie skrzydła biernego', criterion: 'płynne działanie', source: 'instrukcja producenta okucia', allowNa: false },
  { key: 'e5', label: 'Funkcja awaryjna / przeciwpaniczna od strony ewakuacji', criterion: 'otwarcie jednym ruchem bez klucza', source: 'PN-EN 179 / PN-EN 1125; zał. 6.10.5 cz. F (.7.1, .7.3)', allowNa: true },
  { key: 'e6', label: 'Uszczelka opadająca / próg (zakresy z dymoszczelnością)', criterion: 'przylega na całej długości po zamknięciu', source: 'zał. 6.10.5 cz. C', allowNa: true },
  { key: 'e7', label: 'Elektrotrzymacz / zwora / kontrola dostępu', criterion: 'zwolnienie przy odcięciu zasilania', source: 'zał. 6.10.5 cz. F (.7.8–.7.10); PN-EN 1155', allowNa: true },
]

/** F. Oznakowanie */
export const ZKP_PROTOCOL_CHECKS_F: ZkpCheckDef[] = [
  { key: 'f1', label: 'Tabliczka znamionowa zamocowana; numer, rok, klasa, S200 / Sa4, C, nr certyfikatu, PN-EN 179 / 1125 zgodne z kartą wyrobu', allowNa: false },
  { key: 'f2', label: 'Etykieta B / CE wg wzoru zał. 6.8; kod typu i numer deklaracji nadane', allowNa: false },
]

export const ZKP_PROTOCOL_CHECK_SECTIONS: Array<{ key: 'B' | 'D' | 'E' | 'F'; title: string; checks: ZkpCheckDef[] }> = [
  { key: 'B', title: 'B. Przegląd dokumentacji', checks: ZKP_PROTOCOL_CHECKS_B },
  { key: 'D', title: 'D. Oględziny', checks: ZKP_PROTOCOL_CHECKS_D },
  { key: 'E', title: 'E. Sprawdzenia funkcjonalne', checks: ZKP_PROTOCOL_CHECKS_E },
  { key: 'F', title: 'F. Oznakowanie', checks: ZKP_PROTOCOL_CHECKS_F },
]

export const ZKP_ALL_CHECK_KEYS = ZKP_PROTOCOL_CHECK_SECTIONS.flatMap((s) => s.checks.map((c) => c.key))

/**
 * C. Pomiary — co wpisuje kontroler. `inputs` = podpisy pól „zmierzono" (m[]),
 * `nominalInput` = nominał wpisywany w protokole (ościeżnica nie ma go w karcie),
 * `manual` = ocenę OK/NOK/n-d daje kontroler (baza liczy tylko tam, gdzie się da).
 * Lustro zkp_protocol_eval — klucze muszą się zgadzać.
 */
export type ZkpMeasurementDef = {
  key: string
  label: string
  inputs: string[]
  unit: string
  nominalInput?: boolean
  text?: boolean
  manual?: boolean
  /** pokazuj tylko, gdy karta ma tę część */
  when?: (card: ZkpProductCard) => boolean
}

export const ZKP_MEASUREMENTS: ZkpMeasurementDef[] = [
  { key: 'frame_w', label: 'Szerokość ościeżnicy zewn.', inputs: ['góra', 'dół'], unit: 'mm', nominalInput: true },
  { key: 'frame_h', label: 'Wysokość ościeżnicy zewn.', inputs: ['L', 'P'], unit: 'mm', nominalInput: true },
  { key: 'frame_diag', label: 'Przekątne ościeżnicy', inputs: ['1', '2'], unit: 'mm' },
  { key: 'leaf_active', label: 'Skrzydło czynne', inputs: ['szer.', 'wys.'], unit: 'mm' },
  { key: 'leaf_passive', label: 'Skrzydło bierne', inputs: ['szer.', 'wys.'], unit: 'mm', when: (c) => c.leaves === 2 },
  { key: 'light', label: 'Nadświetle / doświetle', inputs: ['szer.', 'wys.'], unit: 'mm', when: (c) => c.light !== 'brak' },
  { key: 'leaf_diag', label: 'Przekątne skrzydła', inputs: ['1', '2'], unit: 'mm' },
  { key: 'fill_thick', label: 'Grubość wypełnienia', inputs: ['skrzydło', 'nad-/doświetle'], unit: 'mm' },
  { key: 'fill_dims', label: 'Wymiary wypełnienia (szer. × wys. × pow.)', inputs: [], unit: '', text: true, manual: true },
  { key: 'gap_zaw', label: 'Szczeliny — krawędź zawiasowa', inputs: ['A', 'B', 'C'], unit: 'mm' },
  { key: 'gap_zamk', label: 'Szczeliny — krawędź zamkowa / przeciwzamkowa', inputs: ['A', 'B', 'C'], unit: 'mm' },
  { key: 'gap_nad', label: 'Szczeliny — krawędź nadprożowa', inputs: ['A', 'B', 'C'], unit: 'mm' },
  { key: 'threshold', label: 'Szczelina progowa / rozwiązanie progowe', inputs: [], unit: '', text: true, manual: true },
  { key: 'hinges', label: 'Zawiasy', inputs: ['liczba', 'od krawędzi [mm]', 'między [mm]'], unit: '', manual: true },
  { key: 'pins', label: 'Trzpienie antywyważeniowe', inputs: ['liczba', 'rozmieszczenie'], unit: '', manual: true },
  { key: 'mass', label: 'Masa skrzydła', inputs: ['kg'], unit: 'kg' },
]

export type ZkpProtocolForm = {
  inspector: string
  produced_on: string
  inspected_on: string
  instruments: string
  notes: string
  checks: Record<string, ZkpCheckResult | ''>
  measurements: Record<string, ZkpMeasurementInput>
}

const today = () => new Date().toLocaleDateString('sv-SE')

/** Formularz z otwartego protokołu albo pusty — nominały ościeżnicy można podpowiedzieć z LP. */
export function protocolToForm(p: ZkpTestProtocol | null, hint?: { frameW?: number | null; frameH?: number | null }): ZkpProtocolForm {
  if (p) {
    return {
      inspector: p.inspector_initials,
      produced_on: p.produced_on ?? '',
      inspected_on: p.inspected_on,
      instruments: p.instruments,
      notes: p.notes,
      checks: { ...p.checks },
      measurements: JSON.parse(JSON.stringify(p.measurements ?? {})) as Record<string, ZkpMeasurementInput>,
    }
  }
  const measurements: Record<string, ZkpMeasurementInput> = {}
  if (hint?.frameW != null) measurements.frame_w = { n: String(hint.frameW), m: [] }
  if (hint?.frameH != null) measurements.frame_h = { n: String(hint.frameH), m: [] }
  return { inspector: '', produced_on: '', inspected_on: today(), instruments: '', notes: '', checks: {}, measurements }
}

/** Co jeszcze brakuje w formularzu przed zapisem (żeby nie latać do bazy po każdy pusty wynik). */
export function protocolFormProblems(f: ZkpProtocolForm, card: ZkpProductCard): string[] {
  const out: string[] = []
  if (!f.inspector.trim()) out.push('Podaj kontrolera (inicjały z matrycy 6.27).')
  const missing = ZKP_ALL_CHECK_KEYS.filter((k) => !f.checks[k])
  if (missing.length) out.push(`Sprawdzenia bez wyniku: ${missing.map((k) => k.toUpperCase()).join(', ')}.`)
  const noMeasure = ZKP_MEASUREMENTS.filter((d) => !d.when || d.when(card)).filter((d) => {
    const v = f.measurements[d.key]
    if (d.manual) return !v?.r
    return d.inputs.some((_, i) => !(v?.m?.[i] ?? '').trim()) || (d.nominalInput && !(v?.n ?? '').trim())
  })
  if (noMeasure.length) out.push(`Pomiary niekompletne: ${noMeasure.map((d) => d.label).join(', ')}.`)
  return out
}

export function nokKeys(p: ZkpTestProtocol): string[] {
  const fromChecks = Object.entries(p.checks).filter(([, v]) => v === 'NOK').map(([k]) => k.toUpperCase())
  const fromEval = p.eval.filter((e) => e.result === 'NOK').map((e) => e.label)
  return [...fromChecks, ...fromEval]
}

// ── Deklaracje (zał. 6.9) ─────────────────────────────────────────────────
export type ZkpDeclarationKind = 'KDWU' | 'DWU'

export type ZkpDeclaration = {
  id: number
  kind: ZkpDeclarationKind
  year: number
  seq: number
  number: string
  order_id: number
  construction_ids: number[]
  type_code: string
  product_type: string
  range_code: string
  leaves: number
  opening: string | null
  evacuation: string
  fire_class: string
  smoke: string
  release_capability: string
  height_mm: number | null
  height_tol_mm: number
  mounting_text: string
  certificate_no: string
  test_reports: string
  water_class: string
  impact_class: string
  ud_value: string
  odt: string
  issued_on: string
  signer_name: string
  signer_title: string
  status: 'wydana' | 'wycofana'
  withdrawn_at: string | null
  withdrawn_by_name: string
  withdraw_reason: string | null
  created_at: string
  created_by_name: string
}

export type ZkpDeclarationCandidate = {
  r_order_id: number
  r_order_number: string
  r_company: string | null
  r_construction_id: number
  r_construction_no: string
  r_type_code: string
  r_product_type: string
  r_range_code: string
  r_leaves: number
  r_active_h: number | null
  r_passive_h: number | null
  r_released_on: string | null
}

export type ZkpSetting = { key: string; value: string; updated_at: string; updated_by_name: string }

export const ZKP_SETTING_LABELS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'cert_krajowy_nr', label: 'Krajowy certyfikat (CERTBUD, AC 158)', hint: 'KDWU pkt 7 — wpisać po certyfikacji' },
  { key: 'cert_ce_nr', label: 'Certyfikat stałości właściwości (CERTBUD, NB 2310)', hint: 'DWU pkt 6a' },
  { key: 'ltb_sprawozdania', label: 'Sprawozdania z badań LTB (NB 1827)', hint: 'DWU pkt 6a — zał. 6.7 cz. C' },
  { key: 'odt', label: 'Odpowiednia dokumentacja techniczna', hint: 'ODT/MRP/1' },
  { key: 'mounting_default', label: 'Konstrukcje mocujące (domyślnie)', hint: 'pkt 3 KDWU / pkt 2 DWU — wg raportu 2.2.2.8 / 2.2.3.8' },
  { key: 'signer_name', label: 'Podpisujący deklaracje — imię i nazwisko', hint: 'Właściciel lub osoba upoważniona (zał. 6.4)' },
  { key: 'signer_title', label: 'Podpisujący — stanowisko', hint: '' },
  { key: 'ud_default', label: 'Współczynnik UD (DWU)', hint: 'NPD do czasu obliczeń ALURON' },
  { key: 'impact_default', label: 'Odporność na uderzenie (DWU)', hint: 'NPD do czasu świadectw ITT dla wariantów' },
]

/** Grupy kandydatów do jednej deklaracji: zlecenie × kod typu (jedna deklaracja = jeden typ). */
export function groupDeclarationCandidates(rows: ZkpDeclarationCandidate[]): Array<{
  orderId: number
  orderNumber: string
  company: string
  typeCode: string
  kind: ZkpDeclarationKind
  rows: ZkpDeclarationCandidate[]
}> {
  const map = new Map<string, { orderId: number; orderNumber: string; company: string; typeCode: string; kind: ZkpDeclarationKind; rows: ZkpDeclarationCandidate[] }>()
  for (const r of rows) {
    const k = `${r.r_order_id}|${r.r_type_code}`
    const g = map.get(k) ?? {
      orderId: r.r_order_id, orderNumber: r.r_order_number, company: r.r_company ?? '', typeCode: r.r_type_code,
      kind: r.r_product_type === 'drzwi_zewn' ? 'DWU' : 'KDWU', rows: [],
    }
    g.rows.push(r)
    map.set(k, g)
  }
  return [...map.values()]
}

/** Tekst dymoszczelności / klasy na tabliczce i etykiecie (zał. 6.26, 6.8). */
export function fireClassLabel(range: string): string {
  if (range === 'EI30' || range === 'EI30S') return 'EI2 30'
  if (range === 'EI60' || range === 'EI60S') return 'EI2 60'
  return '—'
}
export function smokeLabel(range: string): string {
  return range.endsWith('S') ? 'S200 / Sa4' : '—'
}

/** Limity tabeli K do protokołu — krótki opis zakresu (nagłówek wydruku). */
export function rangeShort(r: ZkpRange | null | undefined): string {
  return r ? `${r.code} — ${r.label} (${r.report})` : '—'
}
