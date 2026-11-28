// =====================================================================
// Zamawianie — status SKU i sugerowana ilość.
//
// D9 (28.11): „ile zamówić” liczy BAZA — get_reorder_proposals (komponent, suma
// magazynów; pozycja = stan − rezerwacje + w drodze; cel bez smart ROP = 2×
// miesięczne zużycie; zaokrąglenie do partii). Czytają ją Zamawianie, Stany
// („Wszystkie”) i Alerty. Tu: odczyt wiersza RPC i przełożenie na status /
// sugestię ekranu.
//
// computeReorder = STARA reguła (pozycja = stan + w drodze, rezerwacje NIE
// odejmowane, bez targetu 4× min) — zostaje jako zapas, gdy baza nie ma jeszcze
// funkcji (PGRST202, aplikacja przed wgraniem migracji 20261128050000).
// =====================================================================
import type { ReorderProposal, StockLevel } from '../types'

export type ReorderStatus = 'no_threshold' | 'critical' | 'observe' | 'ok'

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const numOrNull = (v: unknown): number | null => (v == null || v === '' ? null : num(v))

const LEVELS: StockLevel[] = ['critical', 'covered', 'low', 'ok', 'inactive']
const STATUSES: ReorderStatus[] = ['critical', 'observe', 'ok', 'no_threshold']

/** Wiersz get_reorder_proposals z PostgREST (numeric jako string) → ReorderProposal */
export function normalizeReorderProposal(r: Record<string, unknown>): ReorderProposal {
  const level = String(r.r_level ?? 'ok') as StockLevel
  const status = String(r.r_status ?? 'no_threshold') as ReorderStatus
  const minSrc = r.r_min_source == null ? null : String(r.r_min_source)
  const tSrc = r.r_target_source == null ? null : String(r.r_target_source)
  return {
    component_id: num(r.r_component_id),
    stock: num(r.r_stock),
    reserved: num(r.r_reserved),
    available: num(r.r_available),
    incoming: num(r.r_incoming),
    earliest_eta: r.r_earliest_eta == null ? null : String(r.r_earliest_eta),
    open_pos: num(r.r_open_pos),
    draft_qty: num(r.r_draft_qty),
    position: num(r.r_position),
    min: numOrNull(r.r_min),
    min_source: minSrc === 'shelf' || minSrc === 'smart' || minSrc === 'component' ? minSrc : null,
    target: numOrNull(r.r_target),
    target_source: tSrc === 'smart' || tSrc === 'component' || tSrc === 'consumption' || tSrc === 'min_x4' ? tSrc : null,
    monthly_consumption: num(r.r_monthly_consumption),
    smart: r.r_smart === true,
    level: LEVELS.includes(level) ? level : 'ok',
    status: STATUSES.includes(status) ? status : 'no_threshold',
    proposal: num(r.r_proposal),
    order_lot: numOrNull(r.r_order_lot),
  }
}

/** Czy komponent trzeba zamówić teraz (PILNE / OBSERWUJ) */
export function proposalNeedsOrder(p: Pick<ReorderProposal, 'status'>): boolean {
  return p.status === 'critical' || p.status === 'observe'
}

/** „Do zamówienia” w Stanach („Wszystkie”): propozycja tylko, gdy trzeba zamówić teraz */
export function proposalShortage(p: Pick<ReorderProposal, 'status' | 'proposal'>): number {
  return proposalNeedsOrder(p) ? Math.max(0, p.proposal) : 0
}

/** Status i sugestia Zamawiania z wiersza bazy (ten sam kształt co computeReorder) */
export function reorderFromProposal(p: ReorderProposal): ReorderResult {
  const suggested = proposalNeedsOrder(p)
    ? Math.max(p.proposal, 1)
    : p.proposal > 0 ? p.proposal : null
  return { position: p.position, status: p.status, suggested }
}

/** D65: ostrzeżenie przed dodaniem do listy, gdy towar jest już w niewysłanym szkicu ZD; null = bez ostrzeżenia */
export function draftWarningText(componentName: string, draftQty: number | null | undefined): string | null {
  const q = Number(draftQty)
  if (!Number.isFinite(q) || q <= 0) return null
  return `„${componentName}” jest już w niewysłanym szkicu ZD (${Number(q.toFixed(3))} szt.). Szkic nie liczy się jako „w drodze” — dodać mimo to do listy zakupowej?`
}

export type ReorderInput = {
  /** stan fizyczny (suma magazynów) */
  stock: number
  /** w drodze — niedostarczone pozycje wysłanych ZD */
  incoming: number
  min: number | null
  target: number | null
  unitsPerPallet: number | null
  /** minimum logistyczne (#168): wielokrotność zamówienia u dostawcy, np. 8 albo 12; ma pierwszeństwo przed paletą */
  orderMultiple?: number | null
}

export type ReorderResult = {
  position: number
  status: ReorderStatus
  suggested: number | null
}

/** Zaokrąglenie w górę do pełnych palet, gdy SKU jeździ paletami. */
export function roundToPallets(qty: number, unitsPerPallet: number | null): number {
  if (unitsPerPallet != null && unitsPerPallet > 0) return Math.ceil(qty / unitsPerPallet) * unitsPerPallet
  return qty
}

/** Partia logistyczna SKU (#168, Tymek 24.11): minimum logistyczne, a gdy go nie ma — pełna paleta; null = sztuki. */
export function orderLot(orderMultiple: number | null | undefined, unitsPerPallet: number | null | undefined): number | null {
  if (orderMultiple != null && orderMultiple > 0) return orderMultiple
  if (unitsPerPallet != null && unitsPerPallet > 0) return unitsPerPallet
  return null
}

/** Zaokrąglenie w górę do partii logistycznej (orderLot). To samo liczy baza w stock_order_lot (widok v_stock_levels). */
export function roundToLot(qty: number, orderMultiple: number | null | undefined, unitsPerPallet: number | null | undefined): number {
  return roundToPallets(qty, orderLot(orderMultiple, unitsPerPallet))
}

export function computeReorder({ stock, incoming, min, target, unitsPerPallet, orderMultiple = null }: ReorderInput): ReorderResult {
  const position = stock + Math.max(0, incoming)
  if (min == null) return { position, status: 'no_threshold', suggested: null }

  let status: ReorderStatus = 'ok'
  if (position <= min) status = 'critical'
  else if (position <= min * 1.5) status = 'observe'

  let suggested: number | null = null
  if (status === 'critical' || status === 'observe') {
    // bez targetu: uzupełnij do 4× min (jak dotąd)
    const rawQty = Math.max((target ?? min * 4) - position, 1)
    suggested = Math.max(roundToLot(rawQty, orderMultiple, unitsPerPallet), 1)
  } else if (target != null) {
    // OK: podpowiedź „z wyprzedzeniem" tylko, gdy do targetu czegoś brakuje
    const rawQty = target - position
    if (rawQty > 0) suggested = roundToLot(rawQty, orderMultiple, unitsPerPallet)
  }
  return { position, status, suggested }
}
