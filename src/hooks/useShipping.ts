import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { isReleaseDateEmpty, orderRouteMark } from '../utils'
import { cleanCompanyValue } from '../lib/companyMatch'
import type { Order } from '../types'
import type { ToastVariant } from '../types'
import type React from 'react'

type UseShippingParams = {
  pushToast: (msg: string, variant: ToastVariant) => void
  touchSession: () => void
  fetchInternalDoorItemsForVisibleOrders: (orders: Order[]) => Promise<void>
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>
  setInternalDoorDetailsModal: React.Dispatch<
    React.SetStateAction<{ open: boolean; order: Order | null }>
  >
  handleRushToggle: (order: Order, checked: boolean) => Promise<void>
  isActive: boolean
}

/** Zamówienie widoczne w Wysyłce (nie anulowane, nie wydane) */
function passesShippingFilter(o: Order): boolean {
  const extra = o.extra_fields as Record<string, unknown> | null
  if (extra?.cancelled === true) return false
  if (o.release_date && !isReleaseDateEmpty(o.release_date)) return false
  return true
}

const RELEASED_WINDOW_DAYS = 14

// Granica „wydane w ost. 14 dniach" — data lokalna (toISOString dawał UTC)
function releasedCutoffDate(): string {
  return new Date(Date.now() - RELEASED_WINDOW_DAYS * 24 * 60 * 60 * 1000).toLocaleDateString('sv-SE')
}

/** Wydane niedawno (lista „Pokaż wydane") — nie anulowane, release_date >= granica */
function passesReleasedFilter(o: Order, cutoff: string): boolean {
  const extra = o.extra_fields as Record<string, unknown> | null
  if (extra?.cancelled === true) return false
  if (!o.release_date || isReleaseDateEmpty(o.release_date)) return false
  return String(o.release_date).slice(0, 10) >= cutoff
}

export function useShipping({
  pushToast,
  touchSession,
  fetchInternalDoorItemsForVisibleOrders,
  setInternalDoorDetailsModal,
  handleRushToggle,
  isActive,
}: UseShippingParams) {
  const [shippingOrders, setShippingOrders] = useState<Order[]>([])
  // Wydane w ostatnich 14 dniach — „gotowe do fakturowania" nie może znikać
  // z Wysyłki w momencie wydania (fakturowanie bywa później niż wydanie)
  const [shippingReleasedOrders, setShippingReleasedOrders] = useState<Order[]>([])
  const [shippingOrdersLoading, setShippingOrdersLoading] = useState(false)
  const [shippingCompaniesMap, setShippingCompaniesMap] = useState<
    Map<string, { production_day: string; route_day: string }>
  >(new Map())
  const [shippingDetailsModal, setShippingDetailsModal] = useState<{
    open: boolean
    order: Order | null
  }>({ open: false, order: null })

  const fetchShippingOrders = useCallback(async () => {
    touchSession()
    setShippingOrdersLoading(true)

    const releasedCutoff = releasedCutoffDate()
    // Paginacja — PostgREST ucina każde zapytanie do 1000 wierszy, a otwartych
    // zamówień jest kilka tysięcy: stary .limit(2000) pokazywał ~1000 i przez
    // sortowanie alfabetyczne po kategorii znikały Techniczne i ogon STA.
    // Anulowane odfiltrowane po stronie serwera (nie zjadają stron).
    const fetchAllOpen = async (): Promise<{ data: Order[]; error: { message: string } | null }> => {
      const all: Order[] = []
      let from = 0
      const PAGE = 1000
      for (;;) {
        const { data, error } = await supabase
          .from('orders')
          .select('*')
          .is('release_date', null)
          .or('extra_fields->>cancelled.is.null,extra_fields->>cancelled.eq.false')
          .order('id', { ascending: false })
          .range(from, from + PAGE - 1)
        if (error) return { data: all, error }
        if (!data || data.length === 0) break
        all.push(...(data as Order[]))
        if (data.length < PAGE) break
        from += PAGE
      }
      return { data: all, error: null }
    }
    const [ordersRes, releasedRes, companiesRes] = await Promise.all([
      fetchAllOpen(),
      supabase
        .from('orders')
        .select('*')
        .gte('release_date', releasedCutoff)
        .order('release_date', { ascending: false })
        .limit(1000),
      supabase.from('companies').select('name, production_day, route_day'),
    ])

    setShippingOrdersLoading(false)

    if (ordersRes.error) {
      pushToast(`Błąd: ${ordersRes.error.message}`, 'error')
      setShippingCompaniesMap(new Map())
      return
    }

    if (companiesRes.error) {
      pushToast(`Błąd firm: ${companiesRes.error.message}`, 'error')
      setShippingCompaniesMap(new Map())
    } else {
      const companiesMap = new Map<string, { production_day: string; route_day: string }>()
      for (const c of (companiesRes.data ?? []) as Array<{
        name?: string
        production_day?: string
        route_day?: string
      }>) {
        // '#N/A' / '-' z importu = puste (nie trafia do filtrów)
        companiesMap.set((c.name ?? '').trim().toLowerCase(), {
          production_day: cleanCompanyValue(c.production_day),
          route_day: cleanCompanyValue(c.route_day),
        })
      }
      setShippingCompaniesMap(companiesMap)
    }

    const filtered = (ordersRes.data ?? []).filter((o: Order) => {
      const extra = o.extra_fields as Record<string, unknown> | null
      if (extra?.cancelled === true) return false
      if (o.release_date && !isReleaseDateEmpty(o.release_date)) return false
      return true
    }) as Order[]

    setShippingOrders(filtered)
    if (!releasedRes.error) {
      const released = ((releasedRes.data ?? []) as Order[]).filter((o) => {
        const extra = o.extra_fields as Record<string, unknown> | null
        return extra?.cancelled !== true
      })
      setShippingReleasedOrders(released)
    }
    const internalDoorOrdersInShipping = filtered.filter((o) => o.category === 'DrzwiWewnetrzne')
    if (internalDoorOrdersInShipping.length > 0) {
      await fetchInternalDoorItemsForVisibleOrders(internalDoorOrdersInShipping)
    }
  }, [pushToast, touchSession, fetchInternalDoorItemsForVisibleOrders])

  const handleToggleReadyToInvoice = useCallback(
    async (order: Order, ready: boolean) => {
      const id = order.id
      if (id === undefined) return

      // Merge po stronie bazy (RPC) — nie nadpisujemy całego extra_fields
      // lokalną kopią, żeby nie skasować zmian z innych stanowisk
      const { data: newExtra, error } = await supabase.rpc('merge_order_extra_fields', {
        p_order_id: id,
        p_patch: { ready_to_invoice: ready },
      })

      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }

      const applyExtra = (prev: Order[]) =>
        prev.map((o) =>
          o.id === id ? { ...o, extra_fields: (newExtra as Order['extra_fields']) ?? o.extra_fields } : o,
        )
      setShippingOrders(applyExtra)
      setShippingReleasedOrders(applyExtra)

      pushToast(ready ? 'Oznaczono jako gotowe do fakturowania' : 'Usunięto oznaczenie', 'success')
    },
    [pushToast],
  )

  // Plan wydań: klik przełącza puste → X (na jutro) → XX (na dziś) → puste.
  // Merge po stronie bazy — jak fakturowanie.
  const handleToggleRouteMark = useCallback(
    async (order: Order) => {
      const id = order.id
      if (id === undefined) return
      const cur = orderRouteMark(order)
      const next = cur === '' ? 'X' : cur === 'X' ? 'XX' : ''
      const { data: newExtra, error } = await supabase.rpc('merge_order_extra_fields', {
        p_order_id: id,
        p_patch: { route_mark: next },
      })
      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }
      const applyExtra = (prev: Order[]) =>
        prev.map((o) =>
          o.id === id ? { ...o, extra_fields: (newExtra as Order['extra_fields']) ?? o.extra_fields } : o,
        )
      setShippingOrders(applyExtra)
      setShippingReleasedOrders(applyExtra)
    },
    [pushToast],
  )

  const handleShippingRushToggle = useCallback(
    async (order: Order, checked: boolean) => {
      await handleRushToggle(order, checked)

      const nextSeq = checked ? 'X' : ''
      const applySeq = (prev: Order[]) =>
        prev.map((o) => (o.id === order.id ? { ...o, sequence: nextSeq } : o))
      setShippingOrders(applySeq)
      setShippingReleasedOrders(applySeq)
    },
    [handleRushToggle],
  )

  const handleOpenShippingOrder = useCallback(
    (order: Order) => {
      if (order.category === 'DrzwiWewnetrzne') {
        setInternalDoorDetailsModal({ open: true, order })
      } else {
        setShippingDetailsModal({ open: true, order })
      }
    },
    [setInternalDoorDetailsModal],
  )

  // ── Realtime ─────────────────────────────────────────────────────────────────
  // Ref do aktualnego stanu zamówień, żeby handler nie "zamrażał" closury
  const shippingOrdersRef = useRef<Order[]>([])
  shippingOrdersRef.current = shippingOrders

  useEffect(() => {
    if (!isActive) return

    const channel = supabase
      .channel('shipping:orders:realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { id?: number }).id
            if (deletedId === undefined) return
            setShippingOrders((prev) => prev.filter((o) => o.id !== deletedId))
            setShippingReleasedOrders((prev) => prev.filter((o) => o.id !== deletedId))
            return
          }

          const updated = payload.new as Order
          // Lista „Pokaż wydane": wydanie przenosi zamówienie z otwartych do wydanych
          // (wcześniej znikało z obu do ręcznego odświeżenia)
          const releasedNow = passesReleasedFilter(updated, releasedCutoffDate())
          setShippingReleasedOrders((prev) => {
            const exists = prev.some((o) => o.id === updated.id)
            if (!releasedNow) return exists ? prev.filter((o) => o.id !== updated.id) : prev
            if (exists) return prev.map((o) => (o.id === updated.id ? updated : o))
            return [updated, ...prev]
          })

          if (payload.eventType === 'INSERT') {
            if (!passesShippingFilter(updated)) return
            setShippingOrders((prev) => {
              if (prev.some((o) => o.id === updated.id)) return prev
              return [updated, ...prev]
            })
            return
          }

          if (payload.eventType === 'UPDATE') {
            const passes = passesShippingFilter(updated)
            setShippingOrders((prev) => {
              const exists = prev.some((o) => o.id === updated.id)
              if (!passes) {
                // zamówienie zostało wydane / anulowane → usuń z listy
                return prev.filter((o) => o.id !== updated.id)
              }
              if (exists) {
                return prev.map((o) => (o.id === updated.id ? updated : o))
              }
              // nowe zamówienie, które teraz pasuje do filtra (np. release_date wyczyszczona)
              return [updated, ...prev]
            })
          }
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [isActive])

  return {
    shippingOrders,
    setShippingOrders,
    shippingReleasedOrders,
    shippingOrdersLoading,
    setShippingOrdersLoading,
    shippingCompaniesMap,
    setShippingCompaniesMap,
    shippingDetailsModal,
    setShippingDetailsModal,
    fetchShippingOrders,
    handleToggleReadyToInvoice,
    handleToggleRouteMark,
    handleShippingRushToggle,
    handleOpenShippingOrder,
  }
}
