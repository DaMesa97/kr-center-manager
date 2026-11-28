// =====================================================================
// Pulpit — liczenie kafli (D13, 28.11.2026).
// Wcześniej „aktywne zlecenia” i „Do wysłania” były tą samą liczbą (1818 = 1818), w tym 797 Technicznych
// (prawie nigdy niewydawanych), a „Po terminie” 1262, z czego 720 Technicznych.
// Teraz:
//  - „w produkcji” (podtytuł) = niewydane, nieanulowane zlecenia BEZ Technicznych;
//  - „Do wysłania” = zlecenia, których WSZYSTKIE etapy produkcji są odhaczone (countCompletedStages — ta sama
//    reguła co status „Gotowe” w zakładce Wysyłka); para Disting Plus / zestaw Titan = jedno zlecenie i jest
//    „do wysłania”, gdy każda jego NIEWYDANA noga jest gotowa (wydanej nogi nie ma w danych — nie blokuje);
//    drzwi wewnętrzne (gotowość = spakowanie, widać ją w Wysyłkach) i Techniczne nie mają etapów → nie liczą się;
//  - „Techniczne” — osobny kafel: liczba otwartych wierszy i ile z nich po terminie;
//  - „Po terminie” — bez Technicznych.
// =====================================================================
import { countCompletedStages, getOrderAgeStatus } from '../utils'
import type { LeadTimeRule, Order } from '../types'

export type DashboardRow = {
  id: number
  category: string
  linked_order_id: number | null
  titan_group: string | null
  order_date: string | null
  system?: string | null
  production_stages?: unknown
  /** extra_fields->alu->progress (Aluminium: postęp przepisany przez trigger) */
  alu_progress?: unknown
  top_light?: string | null
  side_panel?: string | null
  side_panel_a?: string | null
  side_panel_b?: string | null
  bastion_frame_type?: string | null
}

export const TECHNICZNE = 'Techniczne'

/** Klucz zlecenia „logicznego": trójka Titana (titan_group) i para Disting Plus (linked_order_id) = 1 */
export function logicalOrderKey(o: Pick<DashboardRow, 'id' | 'linked_order_id' | 'titan_group'>): string {
  if (o.titan_group) return `t:${o.titan_group}`
  if (o.linked_order_id != null) return `p:${Math.min(o.id, o.linked_order_id)}`
  return `o:${o.id}`
}

export function countLogicalOrders(rows: Array<Pick<DashboardRow, 'id' | 'linked_order_id' | 'titan_group'>>): number {
  return new Set(rows.map(logicalOrderKey)).size
}

/** Wiersz Pulpitu jako Order — tylko pola, których potrzebują countCompletedStages / getOrderAgeStatus */
function asOrder(o: DashboardRow): Order {
  const extra: Record<string, unknown> = {}
  if (o.titan_group) extra.titan_group = o.titan_group
  if (o.alu_progress != null) extra.alu = { progress: o.alu_progress }
  return { ...o, release_date: null, extra_fields: extra } as unknown as Order
}

/** Wszystkie etapy produkcji odhaczone (kategoria bez etapów → false) */
export function isRowReadyToShip(o: DashboardRow): boolean {
  const st = countCompletedStages(asOrder(o))
  return st.total > 0 && st.completed >= st.total
}

export type DashboardSummary = {
  /** zlecenia logiczne w produkcji, bez Technicznych */
  inProduction: number
  /** zlecenia logiczne ze wszystkimi etapami odhaczonymi (każda niewydana noga) */
  readyToShip: number
  /** otwarte wiersze Technicznych */
  technicalOpen: number
  technicalOverdue: number
  /** po terminie bez Technicznych: suma (zlecenia logiczne) i wiersze per kategoria */
  overdueTotal: number
  overdueByCategory: Record<string, number>
}

export function summarizeDashboard(rows: DashboardRow[], rules: LeadTimeRule[]): DashboardSummary {
  const tech = rows.filter((o) => o.category === TECHNICZNE)
  const prod = rows.filter((o) => o.category !== TECHNICZNE)
  const overdue = (o: DashboardRow) => getOrderAgeStatus(asOrder(o), rules) === 'overdue'

  const ready = new Map<string, boolean>()
  for (const o of prod) {
    const k = logicalOrderKey(o)
    ready.set(k, (ready.get(k) ?? true) && isRowReadyToShip(o))
  }

  const prodOverdue = rules.length ? prod.filter(overdue) : []
  const overdueByCategory: Record<string, number> = {}
  for (const o of prodOverdue) overdueByCategory[o.category] = (overdueByCategory[o.category] ?? 0) + 1

  return {
    inProduction: ready.size,
    readyToShip: [...ready.values()].filter(Boolean).length,
    technicalOpen: tech.length,
    technicalOverdue: rules.length ? tech.filter(overdue).length : 0,
    overdueTotal: countLogicalOrders(prodOverdue),
    overdueByCategory,
  }
}
