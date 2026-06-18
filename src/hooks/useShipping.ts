import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { isReleaseDateEmpty } from '../utils'
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

export function useShipping({
  pushToast,
  touchSession,
  fetchInternalDoorItemsForVisibleOrders,
  setInternalDoorDetailsModal,
  handleRushToggle,
  isActive,
}: UseShippingParams) {
  const [shippingOrders, setShippingOrders] = useState<Order[]>([])
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

    const [ordersRes, companiesRes] = await Promise.all([
      supabase
        .from('orders')
        .select('*')
        .is('release_date', null)
        .order('category', { ascending: true })
        .order('order_number', { ascending: false })
        .limit(2000),
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
        companiesMap.set((c.name ?? '').trim().toLowerCase(), {
          production_day: String(c.production_day ?? ''),
          route_day: String(c.route_day ?? ''),
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
    const internalDoorOrdersInShipping = filtered.filter((o) => o.category === 'DrzwiWewnetrzne')
    if (internalDoorOrdersInShipping.length > 0) {
      await fetchInternalDoorItemsForVisibleOrders(internalDoorOrdersInShipping)
    }
  }, [pushToast, touchSession, fetchInternalDoorItemsForVisibleOrders])

  const handleToggleReadyToInvoice = useCallback(
    async (order: Order, ready: boolean) => {
      const id = order.id
      if (id === undefined) return

      const currentExtra = (order.extra_fields as Record<string, unknown>) ?? {}
      const newExtra = { ...currentExtra, ready_to_invoice: ready }

      const { error } = await supabase.from('orders').update({ extra_fields: newExtra }).eq('id', id)

      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }

      setShippingOrders((prev) => prev.map((o) => (o.id === id ? { ...o, extra_fields: newExtra } : o)))

      pushToast(ready ? 'Oznaczono jako gotowe do fakturowania' : 'Usunięto oznaczenie', 'success')
    },
    [pushToast],
  )

  const handleShippingRushToggle = useCallback(
    async (order: Order, checked: boolean) => {
      await handleRushToggle(order, checked)

      const nextSeq = checked ? 'X' : ''
      setShippingOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, sequence: nextSeq } : o)),
      )
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
            return
          }

          const updated = payload.new as Order

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
    shippingOrdersLoading,
    setShippingOrdersLoading,
    shippingCompaniesMap,
    setShippingCompaniesMap,
    shippingDetailsModal,
    setShippingDetailsModal,
    fetchShippingOrders,
    handleToggleReadyToInvoice,
    handleShippingRushToggle,
    handleOpenShippingOrder,
  }
}
