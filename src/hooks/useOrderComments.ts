import { useCallback, useState } from 'react'
import { supabase } from '../supabaseClient'
import type { Order } from '../types'

type UseOrderCommentsParams = {
  orders: Order[]
}

export function useOrderComments({ orders }: UseOrderCommentsParams) {
  const [orderCommentsCounts, setOrderCommentsCounts] = useState<Map<number, { total: number; unread: number }>>(
    new Map(),
  )
  const [commentsPanelState, setCommentsPanelState] = useState<{
    open: boolean
    orderId: number | null
    orderNumber: string
    orderCategory: string
  }>({ open: false, orderId: null, orderNumber: '', orderCategory: '' })

  const fetchOrderCommentsCounts = useCallback(async (orderIds: number[]) => {
    if (orderIds.length === 0) {
      setOrderCommentsCounts(new Map())
      return
    }

    const { data, error } = await supabase.rpc('get_order_comments_counts', {
      p_order_ids: orderIds,
    })

    if (error) {
      console.error('Błąd pobierania liczników komentarzy:', error)
      return
    }

    const map = new Map<number, { total: number; unread: number }>()
    for (const row of (data ?? []) as Array<{ r_order_id: number; r_total: number; r_unread: number }>) {
      map.set(row.r_order_id, {
        total: row.r_total,
        unread: row.r_unread,
      })
    }

    setOrderCommentsCounts(map)
  }, [])

  const handleOpenCommentsPanel = useCallback((order: Order) => {
    if (order.id === undefined) return
    setCommentsPanelState({
      open: true,
      orderId: order.id,
      orderNumber: order.order_number,
      orderCategory: order.category ?? '',
    })
  }, [])

  const handleCloseCommentsPanel = useCallback(() => {
    setCommentsPanelState({ open: false, orderId: null, orderNumber: '', orderCategory: '' })

    const ids = orders.map((o) => o.id).filter((x): x is number => x !== undefined)
    void fetchOrderCommentsCounts(ids)
  }, [orders, fetchOrderCommentsCounts])

  const handleCommentsCountChange = useCallback((orderId: number, total: number) => {
    setOrderCommentsCounts((prev) => {
      const next = new Map(prev)
      const current = next.get(orderId) ?? { total: 0, unread: 0 }
      next.set(orderId, { ...current, total })
      return next
    })
  }, [])

  return {
    orderCommentsCounts,
    setOrderCommentsCounts,
    commentsPanelState,
    setCommentsPanelState,
    fetchOrderCommentsCounts,
    handleOpenCommentsPanel,
    handleCloseCommentsPanel,
    handleCommentsCountChange,
  }
}
