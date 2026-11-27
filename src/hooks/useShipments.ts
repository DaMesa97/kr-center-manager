// =====================================================================
// Wysyłki kurierem (SUUS): dane ekranu „Wysyłki” — zlecenia Po Drzwi do wysłania
// i wysyłki (order_shipments). Palety zdejmuje / oddaje trigger w bazie — tu tylko
// zapis statusu i liczby palet.
// =====================================================================
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { fetchAllPages } from '../lib/fetchPaged'
import { blFromClientOrder, blOrderId, clientFromClientOrder, isoDate, isPendingForShipment } from '../lib/shipments'
import type { OrderShipment, OrderShipmentStatus, ToastVariant } from '../types'

export type PendingOrder = {
  id: number
  order_number: string | null
  client_order_number: string | null
  company: string | null
  category: string
  model: string | null
  system: string | null
  quantity: number | null
  release_date: string | null
  /** nr zamówienia BaseLinker (przed „/”) */
  bl: string
  /** klient (po „/”) */
  client: string
  /** skrót pozycji — model albo pozycje drzwi wewnętrznych („2 × SKRZYDŁO … ; 1 × OŚCIEŻNICA …”) */
  items: string
}

export type ShipmentWithOrders = OrderShipment & {
  orders: Array<Pick<PendingOrder, 'id' | 'order_number' | 'client_order_number' | 'category' | 'model' | 'quantity'> & { client: string }>
}

const ORDER_COLS = 'id, order_number, client_order_number, company, category, model, system, quantity, release_date, extra_fields'
const CHUNK = 150

type OrderRow = {
  id: number
  order_number: string | null
  client_order_number: string | null
  company: string | null
  category: string
  model: string | null
  system: string | null
  quantity: number | null
  release_date: string | null
  extra_fields: Record<string, unknown> | null
}

export function useShipments(pushToast: (msg: string, variant: ToastVariant) => void) {
  const [pending, setPending] = useState<PendingOrder[]>([])
  const [shipments, setShipments] = useState<ShipmentWithOrders[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const today = isoDate(new Date())
      // przypięte zlecenia (unikalne order_id w order_shipment_orders) — nie wracają na listę „Do wysyłki”
      const att = await fetchAllPages<{ order_id: number; shipment_id: number }>((from, to) =>
        supabase.from('order_shipment_orders').select('order_id, shipment_id').order('order_id').range(from, to),
      )
      if (att.error) throw new Error(att.error.message)
      const attached = new Set(att.data.map((r) => Number(r.order_id)))

      const ord = await fetchAllPages<OrderRow>((from, to) =>
        supabase
          .from('orders')
          .select(ORDER_COLS)
          .ilike('company', '%po drzwi%')
          .or(`release_date.is.null,release_date.gte.${today}`)
          .order('id')
          .range(from, to),
      )
      if (ord.error) throw new Error(ord.error.message)
      const pend = ord.data.filter((o) => isPendingForShipment(o, today, attached))

      // pozycje drzwi wewnętrznych (zlecenia z Optimy / ręczne nie mają pola model)
      const wewIds = pend.filter((o) => !String(o.model ?? '').trim()).map((o) => o.id)
      const itemsBy = new Map<number, string[]>()
      for (let i = 0; i < wewIds.length; i += CHUNK) {
        const part = wewIds.slice(i, i + CHUNK)
        const it = await fetchAllPages<{ id: number; order_id: number; quantity: number; optima_name: string | null; component_id: number | null; warehouse_components: { name: string } | Array<{ name: string }> | null }>((from, to) =>
          supabase
            .from('order_internal_door_items')
            .select('id, order_id, quantity, optima_name, component_id, warehouse_components(name)')
            .in('order_id', part)
            .order('id')
            .range(from, to),
        )
        if (it.error) throw new Error(it.error.message)
        for (const x of it.data) {
          const wc = Array.isArray(x.warehouse_components) ? x.warehouse_components[0] : x.warehouse_components
          const name = wc?.name || x.optima_name || `#${x.component_id ?? x.id}`
          itemsBy.set(x.order_id, [...(itemsBy.get(x.order_id) ?? []), `${Number(x.quantity)} × ${name}`])
        }
      }
      setPending(
        pend.map((o) => ({
          id: o.id,
          order_number: o.order_number,
          client_order_number: o.client_order_number,
          company: o.company,
          category: o.category,
          model: o.model,
          system: o.system,
          quantity: o.quantity,
          release_date: o.release_date,
          bl: blFromClientOrder(o.client_order_number),
          client: clientFromClientOrder(o.client_order_number),
          items: String(o.model ?? '').trim() ? [o.system, o.model].filter(Boolean).join(' ') : (itemsBy.get(o.id) ?? []).join('; '),
        })),
      )

      // wysyłki: bez anulowanych; nadane z ostatnich 7 dni
      const weekAgo = isoDate(new Date(Date.now() - 7 * 86_400_000))
      const sh = await fetchAllPages<OrderShipment & { order_shipment_orders: Array<{ order_id: number; orders: Pick<OrderRow, 'id' | 'order_number' | 'client_order_number' | 'category' | 'model' | 'quantity'> | null }> }>((from, to) =>
        supabase
          .from('order_shipments')
          .select('*, order_shipment_orders(order_id, orders(id, order_number, client_order_number, category, model, quantity))')
          .neq('status', 'anulowana')
          .or(`status.neq.nadana,ship_date.gte.${weekAgo}`)
          .order('ship_date', { ascending: true, nullsFirst: false })
          .order('id')
          .range(from, to),
      )
      if (sh.error) throw new Error(sh.error.message)
      setShipments(
        sh.data.map(({ order_shipment_orders, ...s }) => ({
          ...s,
          orders: (order_shipment_orders ?? [])
            .map((x) => x.orders)
            .filter((o): o is NonNullable<typeof o> => o != null)
            .map((o) => ({ ...o, client: clientFromClientOrder(o.client_order_number) })),
        })),
      )
    } catch (e) {
      console.error('[wysyłki]', e)
      pushToast(`Nie wczytano wysyłek: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  useEffect(() => {
    void load()
  }, [load])

  /** Podpowiedź palet wg reguł firmy (rpc suggest_pallets). */
  const suggestPallets = useCallback(async (orderIds: number[]): Promise<{ vertical: number; horizontal: number }> => {
    const { data, error } = await supabase.rpc('suggest_pallets', { p_order_ids: orderIds })
    if (error) {
      pushToast(`Podpowiedź palet: ${error.message}`, 'error')
      return { vertical: 0, horizontal: 0 }
    }
    const row = (Array.isArray(data) ? data[0] : data) as { vertical?: number; horizontal?: number } | null
    return { vertical: Number(row?.vertical) || 0, horizontal: Number(row?.horizontal) || 0 }
  }, [pushToast])

  /** Nowa wysyłka (status zaplanowana) + przypięcie zleceń. Przy konflikcie (zlecenie już w innej wysyłce) — wycofanie nagłówka. */
  const createShipment = useCallback(
    async (p: {
      orderIds: number[]
      bl: string
      shipDate: string
      vertical: number
      horizontal: number
      suggested: { vertical: number; horizontal: number }
      notes: string
    }): Promise<boolean> => {
      const { data, error } = await supabase
        .from('order_shipments')
        .insert({
          bl_order_id: blOrderId(p.bl),
          ship_date: p.shipDate || null,
          status: 'zaplanowana',
          pallets_vertical: p.vertical,
          pallets_horizontal: p.horizontal,
          pallets_suggested: p.suggested,
          notes: p.notes.trim() || null,
        })
        .select('id')
        .single()
      if (error || !data) {
        pushToast(`Nie zapisano wysyłki: ${error?.message ?? 'brak odpowiedzi'}`, 'error')
        return false
      }
      const id = Number((data as { id: number }).id)
      const link = await supabase.from('order_shipment_orders').insert(p.orderIds.map((order_id) => ({ shipment_id: id, order_id })))
      if (link.error) {
        await supabase.from('order_shipments').delete().eq('id', id)
        pushToast(
          link.error.code === '23505' ? 'Któreś zlecenie jest już w innej wysyłce — odśwież listę' : `Nie przypięto zleceń: ${link.error.message}`,
          'error',
        )
        await load()
        return false
      }
      pushToast(`Zaplanowano wysyłkę${p.bl ? ` BL ${p.bl}` : ''} na ${p.shipDate || 'bez daty'}`, 'success')
      await load()
      return true
    },
    [pushToast, load],
  )

  const updateShipment = useCallback(
    async (id: number, patch: Partial<Pick<OrderShipment, 'status' | 'pallets_vertical' | 'pallets_horizontal' | 'ship_date' | 'notes'>>, msg?: string) => {
      const { error } = await supabase.from('order_shipments').update(patch).eq('id', id)
      if (error) {
        pushToast(`Nie zapisano: ${error.message}`, 'error')
        return false
      }
      if (msg) pushToast(msg, 'success')
      await load()
      return true
    },
    [pushToast, load],
  )

  const setStatus = useCallback(
    (id: number, status: OrderShipmentStatus, msg: string) => updateShipment(id, { status }, msg),
    [updateShipment],
  )

  /**
   * Anulowanie: status 'anulowana' (trigger oddaje palety), potem odpięcie zleceń — order_shipment_orders ma
   * UNIQUE(order_id), więc bez odpięcia zlecenia nie dałoby się zaplanować ponownie. Numery zleceń zostają w uwagach.
   */
  const cancelShipment = useCallback(
    async (s: ShipmentWithOrders) => {
      const nr = s.orders.map((o) => o.order_number ?? `#${o.id}`).join(', ')
      const notes = [s.notes, nr ? `anulowana — zlecenia: ${nr}` : 'anulowana'].filter(Boolean).join(' | ')
      const { error } = await supabase.from('order_shipments').update({ status: 'anulowana', notes }).eq('id', s.id)
      if (error) {
        pushToast(`Nie anulowano: ${error.message}`, 'error')
        return false
      }
      const un = await supabase.from('order_shipment_orders').delete().eq('shipment_id', s.id)
      if (un.error) pushToast(`Wysyłka anulowana, ale zlecenia zostały przypięte: ${un.error.message}`, 'error')
      else pushToast('Wysyłka anulowana — palety wróciły na stan, zlecenia wróciły do „Do wysyłki”', 'success')
      await load()
      return true
    },
    [pushToast, load],
  )

  return { pending, shipments, loading, load, suggestPallets, createShipment, updateShipment, setStatus, cancelShipment }
}
