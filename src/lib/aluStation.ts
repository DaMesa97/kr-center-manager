// =====================================================================
// Stolarka aluminiowa na stanowisku (desktop + mobile — jedna logika).
// Zadanie = (pozycja zlecenia, etap). Etap per SZTUKA: pozycja z ilością 3
// to 3 kliknięcia na każdym etapie. Sztukę można odkliknąć na etapie k tylko
// wtedy, gdy poprzedni etap ma więcej zrobionych sztuk (przepływ sztukowy),
// pierwszy etap — do ilości. Zadanie znika, gdy done >= quantity.
// Zapis robi RPC mark_alu_position_stage / undo_alu_position_stage (baza
// pilnuje tych samych reguł), tu tylko widok i scalanie wyników.
// =====================================================================
import { ALU_CATEGORY, ALU_CONSTRUCTION_LABELS, ALU_STAGE_DEFS } from '../constants'
import { aluLoadingDate, aluOrderExtra, aluStageDone, formatAluDims, formatAluGlass, formatAluNotes, formatPlDateWithDow } from './alu'
import { isReleaseDateEmpty } from '../utils'
import type { DetailField, MyTask } from './stationLogic'
import type { AluPosition, AluPositionStages, Order, WorkerStage } from '../types'

export const ALU_STAGE_KEYS = ALU_STAGE_DEFS.map((d) => d.key)

export function aluStageIndex(stageKey: string): number {
  return ALU_STAGE_KEYS.indexOf(stageKey)
}

/** Ile sztuk pozycji można TERAZ odkliknąć na etapie (limit z poprzedniego etapu − zrobione) */
export function aluReadyCount(stages: AluPositionStages | null | undefined, stageKey: string, quantity: number): number {
  const idx = aluStageIndex(stageKey)
  if (idx < 0 || quantity <= 0) return 0
  const done = aluStageDone(stages, stageKey, quantity)
  const limit = idx === 0 ? quantity : aluStageDone(stages, ALU_STAGE_KEYS[idx - 1], quantity)
  return Math.max(0, limit - done)
}

/** Czy da się cofnąć sztukę na etapie (następny etap jej nie „zużył”) */
export function aluCanUndo(stages: AluPositionStages | null | undefined, stageKey: string, quantity: number): boolean {
  const idx = aluStageIndex(stageKey)
  if (idx < 0) return false
  const done = aluStageDone(stages, stageKey, quantity)
  if (done <= 0) return false
  const next = ALU_STAGE_KEYS[idx + 1]
  return !next || aluStageDone(stages, next, quantity) <= done - 1
}

function isOpenAluOrder(o: Order): boolean {
  if (o.category !== ALU_CATEGORY) return false
  if (!isReleaseDateEmpty(o.release_date)) return false
  return (o.extra_fields as Record<string, unknown> | null)?.cancelled !== true
}

/**
 * Zadania aluminium dla pracownika: tylko etapy przypisane w worker_stages
 * (category 'Aluminium'), tylko otwarte zlecenia, tylko pozycje z niezrobionymi
 * sztukami. Kolejność: termin rosnąco (brak terminu na końcu), numer zlecenia,
 * pozycja, etap.
 */
export function buildAluTasks(
  orders: Order[],
  positionsByOrder: Record<number, AluPosition[]>,
  workerStages: WorkerStage[],
): MyTask[] {
  const myKeys = new Set(
    workerStages.filter((ws) => ws.category === ALU_CATEGORY && aluStageIndex(ws.stage_key) >= 0).map((ws) => ws.stage_key),
  )
  if (myKeys.size === 0) return []
  const tasks: MyTask[] = []
  for (const order of orders) {
    if (order.id == null || !isOpenAluOrder(order)) continue
    const positions = positionsByOrder[order.id] ?? []
    for (const pos of positions) {
      const qty = Math.max(0, Number(pos.quantity) || 0)
      for (const def of ALU_STAGE_DEFS) {
        if (!myKeys.has(def.key)) continue
        const done = aluStageDone(pos.production_stages, def.key, qty)
        if (qty <= 0 || done >= qty) continue
        const readyCount = aluReadyCount(pos.production_stages, def.key, qty)
        tasks.push({
          order,
          stageKey: def.key,
          actualStageKey: def.key,
          category: ALU_CATEGORY,
          stageHeader: def.header,
          stageTitle: def.title ?? '',
          readyToWork: readyCount > 0,
          alu: { position: pos, positionId: pos.id, posNo: pos.pos_no, done, quantity: qty, readyCount },
        })
      }
    }
  }
  return tasks.sort(compareAluTasks)
}

function compareAluTasks(a: MyTask, b: MyTask): number {
  const da = aluOrderExtra(a.order).deadline || '9999'
  const db = aluOrderExtra(b.order).deadline || '9999'
  if (da !== db) return da < db ? -1 : 1
  const na = String(a.order.order_number ?? '')
  const nb = String(b.order.order_number ?? '')
  if (na !== nb) return na.localeCompare(nb, 'pl', { numeric: true })
  const pa = a.alu?.posNo ?? 0
  const pb = b.alu?.posNo ?? 0
  if (pa !== pb) return pa - pb
  return aluStageIndex(a.stageKey) - aluStageIndex(b.stageKey)
}

/** Klucz wiersza/rozwinięcia zadania alu (pozycja + etap) */
export function aluTaskKey(task: MyTask): string {
  return `alu-${task.alu?.positionId ?? task.order.id}-${task.stageKey}`
}

/** Szczegóły pozycji na stanowisku — zależne od etapu (uwagi na okuwaniu/składaniu, szkło na szkleniu) */
export function aluDetailFields(position: AluPosition, order: Order, stageKey: string): DetailField[] {
  const extra = aluOrderExtra(order)
  const notes = formatAluNotes(position.notes)
  const glass = formatAluGlass(position.glass)
  const idx = aluStageIndex(stageKey)
  const fields: DetailField[] = [
    { label: 'Pozycja', value: `${position.pos_no} · ${ALU_CONSTRUCTION_LABELS[position.construction_type] ?? position.construction_type}` },
    { label: 'Opis', value: position.description },
    { label: 'System', value: position.system },
    { label: 'Wymiar (S×W)', value: formatAluDims(position.width_mm, position.height_mm) },
    { label: 'Kolor profili', value: position.profile_color },
    { label: 'Kolor okuć', value: position.hardware_color },
    { label: 'Sztuki', value: `${position.quantity}` },
    { label: 'Termin (dzień trasy)', value: extra.deadline ? formatPlDateWithDow(extra.deadline) : '' },
    { label: 'Załadunek', value: extra.deadline ? formatPlDateWithDow(aluLoadingDate(extra.deadline)) : '' },
  ]
  if (stageKey === 'okuwanie' || stageKey === 'skladanie') fields.push({ label: 'Uwagi produkcyjne', value: notes })
  if (stageKey === 'szklenie' || stageKey === 'pakowanie' || idx < 0) {
    fields.push({ label: 'Wypełnienia', value: position.fillings }, { label: 'Szkło', value: glass })
  }
  if (stageKey === 'pakowanie') fields.push({ label: 'Uwagi produkcyjne', value: notes })
  fields.push({ label: 'Uwagi zlecenia', value: String(order.notes ?? '') })
  return fields.filter((f) => String(f.value ?? '').trim() !== '')
}

/** Lokalna podmiana etapów pozycji po odpowiedzi RPC / zdarzeniu realtime */
export function applyAluPositionStages(
  byOrder: Record<number, AluPosition[]>,
  positionId: number,
  stages: AluPositionStages,
): Record<number, AluPosition[]> {
  let changed = false
  const next: Record<number, AluPosition[]> = {}
  for (const [k, list] of Object.entries(byOrder)) {
    const i = list.findIndex((p) => p.id === positionId)
    if (i < 0) {
      next[Number(k)] = list
      continue
    }
    changed = true
    const copy = list.slice()
    copy[i] = { ...copy[i], production_stages: stages }
    next[Number(k)] = copy
  }
  return changed ? next : byOrder
}

/** Zdarzenie realtime z order_alu_positions (INSERT/UPDATE/DELETE) scalone z mapą pozycji */
export function mergeAluPositionEvent(
  byOrder: Record<number, AluPosition[]>,
  eventType: string,
  row: Partial<AluPosition> | null,
  oldRow: { id?: number; order_id?: number } | null,
): Record<number, AluPosition[]> {
  if (eventType === 'DELETE') {
    const id = oldRow?.id
    if (id == null) return byOrder
    const next: Record<number, AluPosition[]> = {}
    let changed = false
    for (const [k, list] of Object.entries(byOrder)) {
      const filtered = list.filter((p) => p.id !== id)
      if (filtered.length !== list.length) changed = true
      next[Number(k)] = filtered
    }
    return changed ? next : byOrder
  }
  if (!row || row.id == null || row.order_id == null) return byOrder
  const list = byOrder[row.order_id]
  if (!list) return byOrder // zlecenie spoza naszego zakresu
  const i = list.findIndex((p) => p.id === row.id)
  const merged = (i >= 0 ? { ...list[i], ...row } : row) as AluPosition
  const copy = i >= 0 ? list.map((p, j) => (j === i ? merged : p)) : [...list, merged].sort((a, b) => a.pos_no - b.pos_no)
  return { ...byOrder, [row.order_id]: copy }
}

/** Kod błędu bazy dla blokad ZKP przy etapach (D54: przed uruchomieniem / pakowanie przed zwolnieniem karty). */
export const ALU_ZKP_BLOCK_CODE = 'P0423'

// D53: podpis etapu ZKP PIN-em osoby podpisującej (migracja 20261128035300)
/** baza: wpisz PIN (aplikacja pokazuje okienko PIN i ponawia) */
export const ALU_PIN_REQUIRED_CODE = 'P0428'
/** aplikacja: baza zwróciła {_zkp_pin_error} — błędny PIN (licznik prób zapisany w bazie) */
export const ALU_PIN_WRONG_CODE = 'P0401'
/** baza: osoba nie ma PIN-u */
export const ALU_PIN_MISSING_CODE = 'P0424'
/** baza: PIN zablokowany po 5 błędach */
export const ALU_PIN_LOCKED_CODE = 'P0429'
/** aplikacja: pracownik zamknął okienko PIN */
export const ALU_PIN_CANCELLED_CODE = 'PIN_CANCELLED'

/** Odpowiedź mark_alu_position_stage z błędnym PIN-em → komunikat; inaczej null. */
export function aluPinErrorFromData(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const msg = (data as Record<string, unknown>)._zkp_pin_error
  return typeof msg === 'string' && msg ? msg : null
}

/** Tekst dla pracownika po nieudanym oznaczeniu sztuki — blokady i podpis ZKP wyraźnie nazwane. */
export function aluMarkErrorText(error: { code?: string | null; message: string }): string {
  if (error.code === ALU_ZKP_BLOCK_CODE) return `Blokada ZKP — ${error.message}`
  if (error.code === ALU_PIN_CANCELLED_CODE) return 'Nie podpisano — etap ZKP wymaga PIN-u osoby podpisującej'
  if (
    error.code === ALU_PIN_WRONG_CODE ||
    error.code === ALU_PIN_MISSING_CODE ||
    error.code === ALU_PIN_LOCKED_CODE ||
    error.code === ALU_PIN_REQUIRED_CODE
  ) {
    return `Podpis ZKP — ${error.message}`
  }
  return `Nie oznaczono sztuki: ${error.message}`
}

export type AluMarkResult = { data: unknown; error: { code?: string | null; message: string } | null }

/**
 * D53: oznaczenie z podpisem PIN-em. Najpierw bez PIN-u; gdy baza prosi o PIN (P0428) albo PIN był
 * błędny (P0401) — okienko PIN z komunikatem bazy i ponowienie (najwyżej `maxAsks` razy; blokadę
 * po 5 błędach pilnuje baza). Zamknięcie okienka = PIN_CANCELLED. Zwykłe zlecenia: jedno wywołanie.
 */
export async function aluMarkWithPin(
  call: (pin: string | null) => Promise<AluMarkResult>,
  askPin: (message: string) => Promise<string | null>,
  maxAsks = 4,
): Promise<AluMarkResult> {
  let res = await call(null)
  for (let i = 0; i < maxAsks; i++) {
    const code = res.error?.code
    if (code !== ALU_PIN_REQUIRED_CODE && code !== ALU_PIN_WRONG_CODE) break
    const pin = (await askPin(res.error?.message ?? 'Wpisz PIN'))?.trim()
    if (!pin) return { data: null, error: { code: ALU_PIN_CANCELLED_CODE, message: 'Anulowano podpis' } }
    res = await call(pin)
  }
  return res
}
