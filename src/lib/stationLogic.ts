import { BASTION_STAGE_DEFS, BASTION_TITAN_STAGE_DEFS, STA_DISTING_STAGE_DEFS, ST_STAGE_DEFS, ST_TITAN_STAGE_DEFS } from '../constants'
import type { AluPosition, Complaint, Order, StageDef, WhatComplained, WorkerStage } from '../types'
import { mergeIncomingStages } from './stageWrites'
import {
  getComplaintBlockedStages,
  hasGlassExtra,
  isReleaseDateEmpty,
  isRushOrderSequence,
  orderRouteMark,
  isStaTitanLinked,
  isStTitanOrder,
  isTitanBastionOrder,
  parseProductionStages,
} from '../utils'

export type MyTask = {
  order: Order
  stageKey: string
  actualStageKey: string
  category: string
  stageHeader: string
  stageTitle: string
  readyToWork: boolean
  /** Zadanie z REKLAMACJI (etapy pisze update_complaint_stage, bez magazynu) */
  isComplaint?: boolean
  complaintId?: number
  complaintNumber?: string
  linkedComplaintId?: number | null
  /** Zadanie ALUMINIUM: pozycja zlecenia, etap per SZTUKA (lib/aluStation) */
  alu?: AluTaskInfo
}

export type AluTaskInfo = {
  position: AluPosition
  positionId: number
  posNo: number
  /** sztuki z tym etapem / wszystkie */
  done: number
  quantity: number
  /** ile sztuk można teraz odkliknąć (poprzedni etap je przepuścił) */
  readyCount: number
}

export type DetailField = { label: string; value: string }

// ── Kto robił etap? ───────────────────────────────────────────────────
// Stanowisko to często JEDEN komputer i KILKA osób (np. 3 na okuwaniu).
// Przy oznaczaniu etapu pokazujemy kafelki osób przypisanych do tego etapu
// w worker_stages — klik w kafelek = potwierdzenie z inicjałami tej osoby.
export type StationWorker = { id: string; initials: string; fullName: string }

export function workersForTask(
  task: MyTask,
  allStages: WorkerStage[],
  profiles: Array<{ id: string; initials?: string | null; full_name?: string | null }>,
): StationWorker[] {
  const ids = new Set(
    allStages
      .filter(
        (ws) =>
          ws.category === task.category &&
          (ws.stage_key === task.stageKey || ws.stage_key === task.actualStageKey),
      )
      .map((ws) => ws.worker_id),
  )
  const out: StationWorker[] = []
  for (const p of profiles) {
    if (!ids.has(p.id)) continue
    const initials = String(p.initials ?? '').trim()
    if (!initials) continue
    out.push({ id: p.id, initials, fullName: String(p.full_name ?? '').trim() })
  }
  out.sort((a, b) => a.initials.localeCompare(b.initials, 'pl'))
  return out
}

// Graf zależności etapów — które etapy muszą być ukończone, by dany etap był "gotowy".
// Produkcja ma RÓWNOLEGŁE tory (skrzydło niezależne od ościeżnicy), więc nie jest liniowa.
const STAGE_DEPS: Record<string, Record<string, string[]>> = {
  STA: {
    e1: [], e2_1: ['e1'], e2_2: [], e3: [], e4: ['e3'], e5: ['e2_1', 'e2_2', 'e4'],
  },
  Disting: {
    e1: [], e2_1: ['e1'], e2_2: [], e3: [], e4: ['e3'], e5: ['e2_1', 'e2_2', 'e4'],
  },
  ST: {
    cnc: [], osc: [], skr: ['cnc'], mon: ['osc', 'skr'], mag: ['mon'],
    e1: [], e2: [], e3: ['e2'], e4: ['e1', 'e3'],
  },
}

export function isStageReady(
  category: string,
  actualKey: string,
  parsed: Record<string, string>,
  defs: StageDef[],
  opts?: { blocked?: Set<string>; glassExtra?: boolean },
): boolean {
  if (category === 'Bastion') return true
  const blocked = opts?.blocked ?? new Set<string>()
  // Etap "zrobiony" = dowolna niepusta wartość (inicjały/'T'/'X'), nie tylko 'T'.
  // Etap BLOKOWANY (robi go partner pary/Titana) nie może wstrzymywać naszych —
  // bez tego E5 (pakowanie) wisiało wiecznie na parach i Titanach.
  // E2.2 (szklenie dodatków) liczy się jako zrobione, gdy zamówienie nie ma
  // szklanych dodatków — to zadanie wtedy w ogóle nie istnieje.
  const done = (k: string) => {
    if (blocked.has(k)) return true
    if (k === 'e2_2' && (category === 'STA' || category === 'Disting') && opts?.glassExtra === false) return true
    return String(parsed[k] ?? '').trim() !== ''
  }
  let deps = STAGE_DEPS[category]?.[actualKey]
  if (deps) {
    // Titan STA: e4 (okuwanie) robi Bastion — tor skrzydła pilnuje wtedy e3
    if (deps.includes('e4') && blocked.has('e4') && !blocked.has('e3')) {
      deps = [...deps.filter((d) => d !== 'e4'), 'e3']
    }
    return deps.every(done)
  }
  const idx = defs.findIndex((d) => d.key === actualKey)
  return defs.slice(0, idx).every((d) => done(d.key))
}

// Etapy, których NIE robi się w danej kategorii dla zleceń łączonych
// (robione po stronie partnera / innej stacji) — nie są zadaniami w „Moje stanowisko".
function blockedStationKeys(
  order: Order,
  category: string,
  allOrders: Order[] | Map<number, Order>,
): Set<string> {
  const ef = order.extra_fields as Record<string, unknown> | null
  const hasTitanGroup = ef?.titan_group != null
  if (category === 'STA') {
    // Titan: STA robi tylko skrzydło (E3, E5). E1/E2.1 = ST, E4 = Bastion.
    if (hasTitanGroup || isStaTitanLinked(order, allOrders)) return new Set(['e1', 'e2_1', 'e4'])
    // Disting Plus: STA robi skrzydło (E3, E4, E5). E1/E2.1/E2.2 = Disting.
    if (order.linked_order_id != null) return new Set(['e1', 'e2_1', 'e2_2'])
  }
  if (category === 'Disting') {
    // Disting Plus: Disting robi ościeżnicę/dostawkę. E3/E4 = STA.
    if (order.linked_order_id != null) return new Set(['e3', 'e4'])
  }
  if (category === 'ST') {
    // Titan ST: tylko ościeżnica (E1). E2/E3/E4 = STA/Bastion.
    if (isStTitanOrder(order)) return new Set(['e2', 'e3', 'e4'])
  }
  return new Set()
}

function defsForCategory(order: Order, category: string): StageDef[] {
  if (category === 'STA' || category === 'Disting') return STA_DISTING_STAGE_DEFS
  // Noga Titana w Bastionie robi TYLKO okuwanie/montaż/pakowanie (tit_*) —
  // standardowe etapy Bastiona (CNC, okleinowanie, OŚCIEŻNICA…) nie są jej
  // zadaniami: ościeżnicę dla Titana składa ST (zgłoszenie Mariusza).
  if (category === 'Bastion') return isTitanBastionOrder(order) ? BASTION_TITAN_STAGE_DEFS : BASTION_STAGE_DEFS
  if (category === 'ST') return isStTitanOrder(order) ? ST_TITAN_STAGE_DEFS : ST_STAGE_DEFS
  return []
}

export function buildTasks(orders: Order[], workerStages: WorkerStage[]): MyTask[] {
  const tasks: MyTask[] = []
  // Przygotowane raz — przy tysiącach zamówień find()/filter() w pętli robiły O(n²)
  const ordersById = new Map<number, Order>()
  for (const o of orders) if (o.id != null) ordersById.set(o.id, o)
  const stagesByCategory = new Map<string, WorkerStage[]>()
  for (const ws of workerStages) {
    const list = stagesByCategory.get(ws.category) ?? []
    list.push(ws)
    stagesByCategory.set(ws.category, list)
  }

  for (const order of orders) {
    const category = order.category ?? ''
    if (!category) continue

    const stagesForCategory = stagesByCategory.get(category) ?? []
    if (stagesForCategory.length === 0) continue

    const defs = defsForCategory(order, category)
    const parsed = parseProductionStages(order.production_stages, category)
    const blocked = blockedStationKeys(order, category, ordersById)

    for (const ws of stagesForCategory) {
      const hasTitanPrefix = ws.stage_key.startsWith('titan_')
      const actualKey = hasTitanPrefix ? ws.stage_key.replace('titan_', '') : ws.stage_key

      // Etap zablokowany w tej kategorii (robiony po stronie partnera) — nie jest zadaniem
      if (blocked.has(actualKey)) continue

      if (category === 'ST') {
        const isTitan = isStTitanOrder(order)
        if (hasTitanPrefix && !isTitan) continue
        if (!hasTitanPrefix && isTitan) continue
      }

      const def = defs.find((d) => d.key === actualKey)
      if (!def) continue
      if (String(parsed[actualKey] ?? '').trim() !== '') continue // już zrobione (inicjały/'T'/'X')

      if (
        actualKey === 'e2_2' &&
        (category === 'STA' || category === 'Disting') &&
        !hasGlassExtra(order)
      ) {
        continue
      }

      tasks.push({
        order,
        stageKey: ws.stage_key,
        actualStageKey: actualKey,
        category,
        stageHeader: def.header,
        stageTitle: def.title ?? '',
        readyToWork: isStageReady(category, actualKey, parsed, defs, {
          blocked,
          glassExtra: hasGlassExtra(order),
        }),
      })
    }
  }

  return sortTasks(tasks)
}

/** Wspólne sortowanie zadań (zamówienia + reklamacje): gotowe → pilne → data. */
export function sortTasks(tasks: MyTask[]): MyTask[] {
  // Plan wydań nad wszystkim: XX (towar na magazyn DZIŚ) → X (jutro) → reszta.
  // To, co brygadzista oznaczył do wydania, hala robi w pierwszej kolejności.
  const markRank = (t: MyTask) => {
    const m = orderRouteMark(t.order)
    return m === 'XX' ? 2 : m === 'X' ? 1 : 0
  }
  tasks.sort((a, b) => {
    const aMark = markRank(a)
    const bMark = markRank(b)
    if (aMark !== bMark) return bMark - aMark
    if (a.readyToWork !== b.readyToWork) return a.readyToWork ? -1 : 1
    const aUrgent = a.isComplaint ? (a.order as unknown as Complaint).is_rush === true : isRushOrderSequence(a.order.sequence)
    const bUrgent = b.isComplaint ? (b.order as unknown as Complaint).is_rush === true : isRushOrderSequence(b.order.sequence)
    if (aUrgent !== bUrgent) return aUrgent ? -1 : 1
    const aDate = a.order.order_date ?? ''
    const bDate = b.order.order_date ?? ''
    return aDate.localeCompare(bDate)
  })
  return tasks
}

/**
 * Domyślnie widoczne na stanowisku: gotowe do pracy ALBO w Planie wydań (X/XX).
 * Pakowacz nie musi oglądać 800 drzwi, z których gotowych jest 5 — ale
 * niegotowe X/XX zostają, bo to towar na dziś/jutro i stanowisko ma wiedzieć,
 * co zaraz do niego przyjdzie. Resztę odsłania przełącznik „Pokaż czekające”.
 */
export const isTaskShownByDefault = (t: MyTask): boolean => t.readyToWork || orderRouteMark(t.order) !== ''

// Reklamacje jako zadania stanowisk — do tej pory istniały TYLKO w podzakładce
// Reklamacje i stolarz/ościeżniczarz nigdy ich nie widział w swojej kolejce.
// Etapy pisze update_complaint_stage (bez magazynu — komponenty napraw
// rozlicza kierownik przez Zniszczenia/ręczne WZ).
export function buildComplaintTasks(complaints: Complaint[], workerStages: WorkerStage[]): MyTask[] {
  const tasks: MyTask[] = []

  for (const c of complaints) {
    const category = c.category ?? ''
    if (!category) continue
    const ef = (c as { extra_fields?: Record<string, unknown> | null }).extra_fields
    if (ef?.cancelled === true) continue
    if (!isReleaseDateEmpty((c as { release_date?: string | null }).release_date ?? null)) continue

    const stagesForCategory = workerStages.filter((ws) => ws.category === category)
    if (stagesForCategory.length === 0) continue

    const defs: StageDef[] =
      category === 'STA' || category === 'Disting'
        ? STA_DISTING_STAGE_DEFS
        : category === 'ST'
          ? ST_STAGE_DEFS
          : category === 'Bastion'
            ? BASTION_STAGE_DEFS
            : []
    if (defs.length === 0) continue

    const parsed = parseProductionStages(c.production_stages, category)
    const blocked = new Set(
      getComplaintBlockedStages(category, (c.what_complained ?? '') as WhatComplained | '', c.linked_complaint_id),
    )
    const orderLike = c as unknown as Order

    for (const ws of stagesForCategory) {
      if (ws.stage_key.startsWith('titan_')) continue // reklamacje nie są titanowe
      const actualKey = ws.stage_key
      if (blocked.has(actualKey)) continue
      const def = defs.find((d) => d.key === actualKey)
      if (!def) continue
      if (String(parsed[actualKey] ?? '').trim() !== '') continue
      if (actualKey === 'e2_2' && (category === 'STA' || category === 'Disting') && !hasGlassExtra(orderLike)) {
        continue
      }

      tasks.push({
        order: orderLike,
        stageKey: ws.stage_key,
        actualStageKey: actualKey,
        category,
        stageHeader: def.header,
        stageTitle: def.title ?? '',
        readyToWork: isStageReady(category, actualKey, parsed, defs, {
          blocked,
          glassExtra: hasGlassExtra(orderLike),
        }),
        isComplaint: true,
        complaintId: c.id,
        complaintNumber: c.complaint_number,
        linkedComplaintId: c.linked_complaint_id ?? null,
      })
    }
  }

  return tasks
}

/**
 * Dobiera istotne pola zamówienia w zależności od etapu (stanowiska).
 * Uwagi zawsze na górze — zwykle dotyczą całych drzwi. Puste pola są odfiltrowane.
 */
export function fieldsForStage(order: Order, category: string, actualKey: string): DetailField[] {
  const o = order as Record<string, unknown>
  const str = (v: unknown) => (v == null ? '' : String(v)).trim()
  const wh = [str(order.width), str(order.height)].filter(Boolean).join(' × ')

  const NOTES: DetailField[] = [
    { label: 'Uwagi', value: str(order.notes) },
    { label: 'Uwagi 2', value: str(o.bastion_notes_2) },
  ]
  // strona zamka/zawiasów i rozstaw frezów — potrzebne i na ościeżnicy, i na skrzydle
  const ORIENTATION: DetailField[] = [
    { label: 'Wymiar (S×W)', value: wh },
    { label: 'Kierunek', value: str(order.direction) },
    { label: 'Otwieranie', value: str(order.opening) },
  ]
  const FRAME: DetailField[] = [
    { label: 'Kolor ościeżnicy', value: str(order.frame_color) },
    ...ORIENTATION,
    { label: 'System', value: str(order.system) },
    { label: 'Próg', value: str(order.threshold_color) },
    { label: 'Poszerzenie', value: str(order.extension) },
    // zaczep montowany w ościeżnicy — frez robi stanowisko ościeżnic
    { label: 'Elektrozaczep', value: str(order.electric_strike) },
    // podwalina idzie pod ościeżnicę (z konfiguratora: extra_fields.podwalina)
    { label: 'Podwalina', value: str((o.extra_fields as Record<string, unknown> | null)?.podwalina) },
  ]
  const GLASS: DetailField[] = [
    { label: 'Naświetle górne', value: str(order.top_light) },
    { label: 'Szklenie naświetla', value: str(order.top_light_glazing) },
    { label: 'Dostawka boczna', value: str(order.side_panel_a || order.side_panel) },
    { label: 'Szklenie dostawki', value: str(order.side_panel_a_glazing || order.side_panel_glazing) },
    { label: 'Dostawka B', value: str(order.side_panel_b) },
    { label: 'Szklenie dostawki B', value: str(order.side_panel_b_glazing) },
    { label: 'Szyba', value: str(order.glazing) },
  ]
  const WING: DetailField[] = [
    { label: 'Model', value: str(order.model) },
    { label: 'Kolor skrzydła', value: str(order.wing_color) },
    ...ORIENTATION,
    { label: 'Szyba', value: str(order.glazing) },
    { label: 'Okucia', value: str(order.hardware) },
    { label: 'Pochwyt', value: str(order.handle) },
    { label: 'Wizjer', value: str(order.peephole) },
    { label: 'Panel dekoracyjny', value: str(order.decorative_panel) },
    { label: 'Intarsja', value: str(order.intarsja) },
    { label: 'Elektrozaczep', value: str(order.electric_strike) },
  ]
  const FULL: DetailField[] = [
    { label: 'Model', value: str(order.model) },
    { label: 'Kolor skrzydła', value: str(order.wing_color) },
    { label: 'Kolor ościeżnicy', value: str(order.frame_color) },
    ...ORIENTATION,
    { label: 'System', value: str(order.system) },
  ]
  // pakowanie: co ma trafić do kartonu oprócz drzwi
  const PACK: DetailField[] = [
    ...FULL,
    { label: 'Naświetle górne', value: str(order.top_light) },
    { label: 'Dostawka boczna', value: str(order.side_panel_a || order.side_panel) },
    { label: 'Dostawka B', value: str(order.side_panel_b) },
    { label: 'Osłonki', value: str(order.oslonki) },
    { label: 'Podwalina', value: str((o.extra_fields as Record<string, unknown> | null)?.podwalina) },
  ]
  const ef = (o.extra_fields as Record<string, unknown> | null) ?? {}
  const BASTION: DetailField[] = [
    { label: 'Model', value: str(order.model) },
    { label: 'Kolekcja', value: str(o.bastion_collection) },
    { label: 'Typ ościeżnicy', value: str(o.bastion_frame_type) },
    { label: 'Zakres ościeżnicy', value: str(o.bastion_frame_range) },
    { label: 'Kolor skrzydła', value: str(order.wing_color) },
    { label: 'Kolor skrzydła WF (wewn.)', value: str(ef.kolor_skrzydla_wf) },
    { label: 'Kolor ościeżnicy', value: str(order.frame_color) },
    { label: 'Kolor ościeżnicy WF (wewn.)', value: str(ef.kolor_oscieznicy_wf) },
    ...ORIENTATION,
  ]
  // stolarnia Bastiona: zabudowy, progi, opaski
  const BASTION_JOINERY: DetailField[] = [...BASTION, { label: 'Próg', value: str(order.threshold_color) }]

  const k = actualKey.toLowerCase()
  let group: DetailField[] = FULL

  if (category === 'STA' || category === 'Disting') {
    if (k === 'e1' || k === 'e2_1') group = FRAME
    else if (k === 'e2_2') group = GLASS
    else if (k === 'e3') group = WING
    else if (k === 'e4') group = [...WING, { label: 'Naświetle', value: str(order.top_light) }]
    else if (k === 'e5') group = PACK
  } else if (category === 'Bastion') {
    if (k.includes('oscieznica')) {
      group = [
        ...FRAME,
        { label: 'Kolor ościeżnicy WF (wewn.)', value: str(ef.kolor_oscieznicy_wf) },
        { label: 'Typ ościeżnicy', value: str(o.bastion_frame_type) },
        { label: 'Zakres ościeżnicy', value: str(o.bastion_frame_range) },
      ]
    } else if (k.includes('skrzydla') || k === 'tit_oku') {
      group = [...WING, { label: 'Kolor skrzydła WF (wewn.)', value: str(ef.kolor_skrzydla_wf) }]
    }
    else if (k === 'stolarnia') group = BASTION_JOINERY
    else if (k === 'tit_mon') group = FULL
    else if (k === 'tit_pak') group = PACK
    else group = BASTION
  } else if (category === 'ST') {
    if (k.includes('osc') || k === 'e1') group = FRAME
    // CNC w ST frezuje skrzydło
    else if (k.includes('skr') || k === 'e3' || k === 'cnc') group = WING
    else if (k === 'mag') group = PACK
  }

  // Ilość na KAŻDYM etapie — 2 szt. to dwie ościeżnice/skrzydła do zrobienia
  const QTY: DetailField = { label: 'Ilość', value: str(order.quantity) }
  return [QTY, ...NOTES, ...group].filter((f) => f.value !== '')
}

export type StationOrderEvent = {
  eventType: string
  row: Partial<Order> | null
  oldRow: { id?: number } | null
}

/**
 * Zdarzenie realtime z tabeli orders scalone z listą stanowiska (bez pełnego
 * refetchu). scope = kategorie, w których zalogowany ma etapy. Partnerzy
 * zleceń łączonych spoza scope zostają na liście także po wydaniu — od nich
 * zależą blokady etapów (blockedStationKeys).
 */
export function mergeStationOrderEvent(prev: Order[], ev: StationOrderEvent, scope: Set<string>): Order[] {
  if (ev.eventType === 'DELETE') {
    const id = ev.oldRow?.id
    return id == null ? prev : prev.filter((o) => o.id !== id)
  }
  const incoming = ev.row as Order | null
  if (incoming?.id == null) return prev
  const extra = incoming.extra_fields as Record<string, unknown> | null
  const open = isReleaseDateEmpty(incoming.release_date) && extra?.cancelled !== true
  const inScope = scope.has(incoming.category ?? '')
  const idx = prev.findIndex((o) => o.id === incoming.id)
  if (idx < 0) return open && inScope ? [incoming, ...prev] : prev
  if (!open && (inScope || extra?.cancelled === true)) return prev.filter((o) => o.id !== incoming.id)
  const cur = prev[idx]
  const next = prev.slice()
  // spread cur: kolumny pominięte w zdarzeniu (TOAST) zostają z poprzedniej wersji
  next[idx] = {
    ...cur,
    ...incoming,
    production_stages: mergeIncomingStages(incoming.id, cur.production_stages, incoming.production_stages),
  }
  return next
}

/** Nowe/otwarte zlecenie łączone, którego partnera nie ma na liście → potrzebny pełny refetch. */
export function stationEventNeedsRefetch(prev: Order[], ev: StationOrderEvent, scope: Set<string>): boolean {
  if (ev.eventType === 'DELETE') return false
  const incoming = ev.row as Order | null
  const partnerId = incoming?.linked_order_id
  if (incoming?.id == null || partnerId == null) return false
  const extra = incoming.extra_fields as Record<string, unknown> | null
  const open = isReleaseDateEmpty(incoming.release_date) && extra?.cancelled !== true
  return open && scope.has(incoming.category ?? '') && !prev.some((o) => o.id === partnerId)
}
