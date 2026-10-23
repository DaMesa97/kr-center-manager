// =====================================================================
// Stolarka aluminiowa — helpery wspólne dla tabeli, szczegółów, importu
// i (etap 2) stanowiska. Etapy per POZYCJA i per SZTUKA: patrz AluStageProgress.
// =====================================================================
import { ALU_STAGE_DEFS } from '../constants'
import type { AluGlassLine, AluOrderExtra, AluPosition, AluPositionStages, AluProductionNotes, Order } from '../types'

const NOTE_LABELS: Array<[keyof AluProductionNotes, string]> = [
  ['okucia', 'Okucia'],
  ['klamka', 'Klamka'],
  ['dodatki', 'Dodatki'],
  ['prog', 'Próg'],
  ['inne', 'Inne'],
]

/** „Okucia: … · Klamka: …” — tylko wypełnione pola */
export function formatAluNotes(notes: AluProductionNotes | null | undefined): string {
  if (!notes) return ''
  return NOTE_LABELS.filter(([k]) => String(notes[k] ?? '').trim() !== '')
    .map(([k, label]) => `${label}: ${String(notes[k]).trim()}`)
    .join(' · ')
}

/** Pola zlecenia Aluminium z orders.extra_fields.alu (brak = puste wartości) */
export function aluOrderExtra(order: Order): AluOrderExtra {
  const raw = (order.extra_fields as Record<string, unknown> | null)?.alu as Partial<AluOrderExtra> | undefined
  return {
    lp_number: String(raw?.lp_number ?? ''),
    lp_created_at: raw?.lp_created_at ?? null,
    deadline: String(raw?.deadline ?? ''),
    realizacja: raw?.realizacja === 'montaz' ? 'montaz' : 'wysylka',
    positions_count: Number(raw?.positions_count ?? 0) || 0,
    area_m2: raw?.area_m2 == null ? null : Number(raw.area_m2),
    weight_kg: raw?.weight_kg == null ? null : Number(raw.weight_kg),
  }
}

/** Ile sztuk pozycji ma zrobiony dany etap (done przycięte do ilości) */
export function aluStageDone(stages: AluPositionStages | null | undefined, stageKey: string, quantity: number): number {
  const done = Number(stages?.[stageKey]?.done ?? 0)
  return Math.max(0, Math.min(quantity, Number.isFinite(done) ? done : 0))
}

export function aluStageComplete(stages: AluPositionStages | null | undefined, stageKey: string, quantity: number): boolean {
  return quantity > 0 && aluStageDone(stages, stageKey, quantity) >= quantity
}

/** Postęp pozycji: zrobione „sztuko-etapy” / wszystkie (ilość × liczba etapów) */
export function aluPositionProgress(pos: Pick<AluPosition, 'quantity' | 'production_stages'>): { done: number; total: number } {
  const qty = Math.max(0, Number(pos.quantity) || 0)
  const total = qty * ALU_STAGE_DEFS.length
  const done = ALU_STAGE_DEFS.reduce((sum, d) => sum + aluStageDone(pos.production_stages, d.key, qty), 0)
  return { done, total }
}

export function aluOrderProgress(positions: Array<Pick<AluPosition, 'quantity' | 'production_stages'>>): { done: number; total: number; percent: number } {
  const acc = positions.reduce(
    (a, p) => {
      const pr = aluPositionProgress(p)
      return { done: a.done + pr.done, total: a.total + pr.total }
    },
    { done: 0, total: 0 },
  )
  return { ...acc, percent: acc.total > 0 ? Math.round((acc.done / acc.total) * 100) : 0 }
}

/** „841×1022 ×1 (4/16/4 Ug=1,1)” */
export function formatAluGlass(lines: AluGlassLine[] | null | undefined): string {
  return (lines ?? [])
    .map((g) => `${g.width_mm}×${g.height_mm} ×${g.qty}${g.spec ? ` (${g.spec})` : ''}`)
    .join('; ')
}

export function formatAluDims(w: number | null | undefined, h: number | null | undefined): string {
  if (!w && !h) return ''
  return `${w ?? '?'}×${h ?? '?'}`
}

/**
 * Załadunek = 1 dzień ROBOCZY przed terminem (dniem trasy): pn–pt, bez świąt
 * (jak workingDaysBetween). Poniedziałek → piątek. Pusty/zły termin → ''.
 */
export function aluLoadingDate(deadline: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(deadline ?? '').trim())
  if (!m) return ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  do {
    d.setDate(d.getDate() - 1)
  } while (d.getDay() === 0 || d.getDay() === 6)
  return d.toLocaleDateString('sv-SE')
}

/** „19.11.2026 (czw.)” — data po polsku ze skrótem dnia tygodnia */
export function formatPlDateWithDow(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? '').trim())
  if (!m) return ymd || '—'
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return `${d.toLocaleDateString('pl-PL')} (${d.toLocaleDateString('pl-PL', { weekday: 'short' })})`
}

/** Sobota/niedziela? Tras w weekend nie ma — termin (dzień trasy) to zawsze pn–pt. */
export function isWeekendYmd(ymd: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? '').trim())
  if (!m) return false
  const dow = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()
  return dow === 0 || dow === 6
}

/** Domyślny termin przy imporcie: dziś + N tygodni, weekend → najbliższy poniedziałek */
export function defaultAluDeadline(weeks = 4, from = new Date()): string {
  const d = new Date(from)
  d.setDate(d.getDate() + weeks * 7)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('sv-SE')
}

/** Podsumowanie typów konstrukcji w zleceniu: „Drzwi ×2 · Okno ×1” */
export function summarizeAluTypes(positions: Array<Pick<AluPosition, 'construction_type' | 'quantity'>>, labels: Record<string, string>): string {
  const counts = new Map<string, number>()
  for (const p of positions) counts.set(p.construction_type, (counts.get(p.construction_type) ?? 0) + (Number(p.quantity) || 0))
  return [...counts.entries()].map(([t, n]) => `${labels[t] ?? t} ×${n}`).join(' · ')
}
