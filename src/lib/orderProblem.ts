import type { Order } from '../types'

/**
 * Flaga „problem" na zleceniu (#87, Mariusz 6.11.2026): brak materiału,
 * uszkodzony komponent, niejasny rysunek… — zlecenie nie idzie dalej, dopóki
 * ktoś tego nie wyjaśni. Trzymana w `orders.extra_fields.problem`
 * (zapis przez RPC merge_order_extra_fields — NIE nadpisujemy całego JSONB).
 * Widoczna jako pomarańczowe tło wiersza (legenda, wyłączalne) i plakietka ⚠
 * za numerem z powodem, datą i inicjałami zgłaszającego.
 */
export type OrderProblem = {
  reason: string
  /** ISO — kiedy zgłoszono */
  at: string
  /** inicjały / nazwa zgłaszającego */
  by: string
}

export const getOrderProblem = (order: Pick<Order, 'extra_fields'>): OrderProblem | null => {
  const ef = order.extra_fields
  if (typeof ef !== 'object' || ef === null) return null
  const p = (ef as Record<string, unknown>).problem
  if (typeof p !== 'object' || p === null) return null
  const r = p as Record<string, unknown>
  const reason = String(r.reason ?? '').trim()
  if (!reason) return null
  return { reason, at: String(r.at ?? ''), by: String(r.by ?? '') }
}

export const hasOrderProblem = (order: Pick<Order, 'extra_fields'>): boolean => getOrderProblem(order) !== null

const fmtWhen = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** Tekst do title/dymka: „Problem: brak szyby — MK, 12.11 09:27". */
export const orderProblemText = (p: OrderProblem): string => {
  const who = [p.by, p.at ? fmtWhen(p.at) : ''].filter(Boolean).join(', ')
  return `Problem: ${p.reason}${who ? ` — ${who}` : ''}`
}
