import { useCallback, useState } from 'react'
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
}

export function useShipping({
  pushToast,
  touchSession,
  fetchInternalDoorItemsForVisibleOrders,
  setInternalDoorDetailsModal,
  handleRushToggle,
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
