// =====================================================================
// Wysyłki kurierem (SUUS): dane ekranu „Wysyłki” — zlecenia Po Drzwi do wysłania
// i wysyłki (order_shipments). Palety zdejmuje / oddaje trigger w bazie (od 27.11 przy
// nadaniu) — tu tylko zapis statusu i liczby palet. Przesyłkę SUUS w BaseLinkerze zakłada
// crm-bl-sync (rpc zlec_przesylke_bl, zaraz po zaplanowaniu).
// =====================================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { fetchAllPages } from '../lib/fetchPaged'
import { blFromClientOrder, blOczekujeZaDlugo, blOrderId, clientFromClientOrder, isoDate, isPendingForShipment, parseOznaczWydaneWynik, pendingSection, rodzajDostawy, type PendingSection, type RodzajDostawy } from '../lib/shipments'
import { isOptimaClosed } from '../lib/optimaRo'
import { fetchPicks, groupPicks, pickProgress } from '../lib/orderPicks'
import { countCompletedStages } from '../utils'
import type { Order, OrderShipment, OrderShipmentStatus, ToastVariant } from '../types'
import { isOrderCancelled } from '../lib/orderCancelled'

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
  order_date: string | null
  /** nr zamówienia BaseLinker (przed „/”) */
  bl: string
  /** klient (po „/”) */
  client: string
  /** skrót pozycji — model albo pozycje drzwi wewnętrznych („2 × SKRZYDŁO … ; 1 × OŚCIEŻNICA …”) */
  items: string
  /** produkcja skończona: wszystkie etapy odhaczone (drzwi wewnętrzne: wszystko spakowane) */
  ready: boolean
  /** „etapy 3/7”, „spakowane 2/5” albo pusto (kategoria bez etapów) */
  progress: string
  /** 0–100 do paska postępu; null = bez etapów */
  percent: number | null
  section: PendingSection
  /** metoda dostawy z BaseLinkera (crm.zamowienia_sklep przez rpc metody_dostawy_bl) */
  dostawa: RodzajDostawy
  metoda: string | null
}

export type ShipmentWithOrders = OrderShipment & {
  orders: Array<Pick<PendingOrder, 'id' | 'order_number' | 'client_order_number' | 'category' | 'model' | 'quantity'> & { client: string }>
}

const CHUNK = 150

type OrderRow = Order & { id: number }
type ShipOrder = { id: number; order_number: string | null; client_order_number: string | null; category: string; model: string | null; quantity: number | null }

type ItemRow = {
  id: number
  order_id: number
  quantity: number
  optima_name: string | null
  optima_element_id: number | null
  optima_code: string | null
  notes: string | null
  component_id: number | null
  warehouse_components: { name: string } | Array<{ name: string }> | null
}

export function useShipments(pushToast: (msg: string, variant: ToastVariant) => void) {
  const [pending, setPending] = useState<PendingOrder[]>([])
  const [shipments, setShipments] = useState<ShipmentWithOrders[]>([])
  const [loading, setLoading] = useState(true)
  const odswiezBl = useRef<ReturnType<typeof setTimeout> | null>(null)

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

      // całe wiersze: etapy produkcji (countCompletedStages) i stan RO z Optimy
      const ord = await fetchAllPages<OrderRow>((from, to) =>
        supabase
          .from('orders')
          .select('*')
          .ilike('company', '%po drzwi%')
          .or(`release_date.is.null,release_date.gte.${today}`)
          .order('id')
          .range(from, to),
      )
      if (ord.error) throw new Error(ord.error.message)
      // 27.11: zlecenia zamknięte / zrealizowane w Optimie nie wiszą na liście
      const pend = ord.data.filter((o) => isPendingForShipment(o as never, today, attached) && !isOptimaClosed(o))

      // drzwi wewnętrzne: pozycje (opis) i spakowanie (gotowość)
      const wewIds = pend.filter((o) => o.category === 'DrzwiWewnetrzne' || !String(o.model ?? '').trim()).map((o) => o.id)
      const itemsBy = new Map<number, ItemRow[]>()
      for (let i = 0; i < wewIds.length; i += CHUNK) {
        const part = wewIds.slice(i, i + CHUNK)
        const it = await fetchAllPages<ItemRow>((from, to) =>
          supabase
            .from('order_internal_door_items')
            .select('id, order_id, quantity, optima_name, optima_element_id, optima_code, notes, component_id, warehouse_components(name)')
            .in('order_id', part)
            .order('id')
            .range(from, to),
        )
        if (it.error) throw new Error(it.error.message)
        for (const x of it.data) itemsBy.set(x.order_id, [...(itemsBy.get(x.order_id) ?? []), x])
      }
      // 27.11: metoda dostawy z BaseLinkera — na liście tylko „Kurier”, reszta schowana pod przełącznikiem
      const blIds = [...new Set(pend.map((o) => blOrderId(blFromClientOrder(o.client_order_number))).filter((x): x is number => x != null))]
      const metody = new Map<string, string>()
      for (let i = 0; i < blIds.length; i += CHUNK) {
        const r = await supabase.rpc('metody_dostawy_bl', { p_bl: blIds.slice(i, i + CHUNK) })
        if (r.error) throw new Error(r.error.message)
        for (const x of (r.data ?? []) as Array<{ bl_id: number; dostawa_metoda: string | null }>) metody.set(String(x.bl_id), x.dostawa_metoda ?? '')
      }
      const picks = groupPicks(wewIds.length ? await fetchPicks(wewIds) : [])

      setPending(
        pend
          .map((o): PendingOrder => {
            const items = itemsBy.get(o.id) ?? []
            let ready = false
            let progress = ''
            let percent: number | null = null
            if (o.category === 'DrzwiWewnetrzne') {
              const p = pickProgress(items, picks.get(o.id))
              ready = p.complete
              progress = p.total ? `spakowane ${p.done}/${p.total}` : ''
              percent = p.total ? Math.round((p.done / p.total) * 100) : null
            } else {
              const st = countCompletedStages(o)
              if (st.total > 0) {
                ready = st.completed >= st.total
                progress = `etapy ${st.completed}/${st.total}`
                percent = st.percent
              }
            }
            const opis = String(o.model ?? '').trim()
              ? [o.system, o.model].filter(Boolean).join(' ')
              : items.map((x) => {
                  const wc = Array.isArray(x.warehouse_components) ? x.warehouse_components[0] : x.warehouse_components
                  return `${Number(x.quantity)} × ${wc?.name || x.optima_name || `#${x.component_id ?? x.id}`}`
                }).join('; ')
            const order_date = (o.order_date as string | null | undefined) ?? null
            return {
              id: o.id,
              order_number: o.order_number ?? null,
              client_order_number: o.client_order_number ?? null,
              company: o.company ?? null,
              category: o.category,
              model: o.model ?? null,
              system: o.system ?? null,
              quantity: (o.quantity as number | null | undefined) ?? null,
              release_date: (o.release_date as string | null | undefined) ?? null,
              order_date,
              bl: blFromClientOrder(o.client_order_number),
              client: clientFromClientOrder(o.client_order_number),
              items: opis,
              ready,
              progress,
              percent,
              section: pendingSection({ order_date, ready }, today),
              dostawa: rodzajDostawy(metody.get(blFromClientOrder(o.client_order_number)), blOrderId(blFromClientOrder(o.client_order_number)) != null),
              metoda: metody.get(blFromClientOrder(o.client_order_number)) || null,
            }
          })
          // od najnowszych
          .sort((a, b) => String(b.order_date ?? '').localeCompare(String(a.order_date ?? '')) || b.id - a.id),
      )

      // wysyłki: nadane z ostatnich 7 dni; anulowane tylko z przesyłką SUUS do usunięcia w BL (14 dni), żeby kurier nie przyjechał
      const weekAgo = isoDate(new Date(Date.now() - 7 * 86_400_000))
      const twoWeeksAgo = new Date(Date.now() - 14 * 86_400_000).toISOString()
      const sh = await fetchAllPages<OrderShipment & { order_shipment_orders: Array<{ order_id: number; orders: ShipOrder | null }> }>((from, to) =>
        supabase
          .from('order_shipments')
          .select('*, order_shipment_orders(order_id, orders(id, order_number, client_order_number, category, model, quantity))')
          .or('status.neq.anulowana,and(bl_package_id.not.is.null,bl_status.neq.usunieta_w_bl)')
          .or(`status.neq.anulowana,updated_at.gte.${twoWeeksAgo}`)
          .or(`status.neq.nadana,ship_date.gte.${weekAgo}`)
          .order('ship_date', { ascending: true, nullsFirst: false })
          .order('id')
          .range(from, to),
      )
      if (sh.error) throw new Error(sh.error.message)
      const lista = sh.data.map(({ order_shipment_orders, ...s }) => ({
        ...s,
        orders: (order_shipment_orders ?? [])
          .map((x) => x.orders)
          .filter((o): o is NonNullable<typeof o> => o != null)
          .map((o) => ({
            id: o.id, order_number: o.order_number ?? null, client_order_number: o.client_order_number ?? null, category: o.category,
            model: o.model ?? null, quantity: (o.quantity as number | null | undefined) ?? null, client: clientFromClientOrder(o.client_order_number),
          })),
      }))
      setShipments(lista)
      // przesyłka zlecona do BaseLinkera — odśwież za chwilę, żeby pokazać numer albo błąd
      if (odswiezBl.current) clearTimeout(odswiezBl.current)
      // (tylko świeże „oczekuje” — po 3 min ekran pokazuje błąd z „Ponów”, a nie przeładowuje bez końca)
      if (lista.some((s) => s.bl_status === 'oczekuje' && !blOczekujeZaDlugo(s))) odswiezBl.current = setTimeout(() => void loadRef.current(), 6000)
    } catch (e) {
      console.error('[wysyłki]', e)
      pushToast(`Nie wczytano wysyłek: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  }, [load])

  useEffect(() => {
    void load()
    return () => {
      if (odswiezBl.current) clearTimeout(odswiezBl.current)
    }
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

  /** Zleca założenie przesyłki SUUS w BaseLinkerze (crm-bl-sync przez pg_net); wynik pojawia się po odświeżeniu. */
  const zlecPrzesylke = useCallback(async (id: number, cicho = false): Promise<boolean> => {
    const { error } = await supabase.rpc('zlec_przesylke_bl', { p_shipment_id: id })
    if (error) {
      pushToast(`Przesyłka w BaseLinkerze: ${error.message}`, 'error')
      return false
    }
    if (!cicho) pushToast('Zlecono przesyłkę w BaseLinkerze — numer pojawi się za chwilę', 'info')
    return true
  }, [pushToast])

  /** Nowa wysyłka (status zaplanowana) + przypięcie zleceń + przesyłka SUUS w BaseLinkerze. */
  const createShipment = useCallback(
    async (p: {
      orderIds: number[]
      bl: string
      shipDate: string
      deliveryDate: string
      vertical: number
      horizontal: number
      suggested: { vertical: number; horizontal: number }
      notes: string
    }): Promise<boolean> => {
      // runda 4 (tester magazynu): zlecenie anulowane w międzyczasie szło do wysyłki i zamawiało kuriera
      const { data: anul, error: blAnul } = await supabase.from('orders').select('order_number, extra_fields').in('id', p.orderIds)
      if (blAnul) {
        pushToast(`Nie zaplanowano: nie udało się sprawdzić w bazie, czy zlecenia nie są anulowane (${blAnul.message}) — spróbuj ponownie`, 'error')
        return false
      }
      const anulowane = ((anul ?? []) as Array<{ order_number: string; extra_fields: Record<string, unknown> | null }>)
        .filter((o) => isOrderCancelled(o))
      if (anulowane.length) {
        pushToast(`Nie zaplanowano: zlecenie ${anulowane.map((o) => o.order_number).join(', ')} jest anulowane — odśwież listę`, 'error')
        await load()
        return false
      }
      const { data, error } = await supabase
        .from('order_shipments')
        .insert({
          bl_order_id: blOrderId(p.bl),
          ship_date: p.shipDate || null,
          delivery_date: p.deliveryDate || null,
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
      // dopiero po przypięciu zleceń — przesyłka w BL zamawia kuriera, nie może zostać po wycofanej wysyłce
      const ok = await zlecPrzesylke(id, true)
      pushToast(
        `Zaplanowano wysyłkę${p.bl ? ` BL ${p.bl}` : ''} na ${p.shipDate || 'bez daty'}${ok ? ' — przesyłka SUUS zakłada się w BaseLinkerze' : ''}`,
        'success',
      )
      await load()
      return true
    },
    [pushToast, load, zlecPrzesylke],
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
      // anulowanie zostawia bl_status: anulowana wysyłka z przesyłką SUUS zostaje na liście z „Usunięta w BL” (kurier!)
      const { data: zm, error } = await supabase.from('order_shipments').update({ status: 'anulowana', notes }).eq('id', s.id).neq('status', 'nadana').select('id')
      if (error) {
        pushToast(`Nie anulowano: ${error.message}`, 'error')
        return false
      }
      // recenzent (2. seria): ktoś inny zdążył kliknąć „Nadane” — nie odpinamy zleceń (wróciłyby do „Do wysyłki” = druga wysyłka)
      if (!zm?.length) {
        pushToast('Nie anulowano — wysyłka jest już nadana (ktoś zmienił ją w międzyczasie). Odświeżam listę.', 'error')
        await load()
        return false
      }
      const un = await supabase.from('order_shipment_orders').delete().eq('shipment_id', s.id)
      if (un.error) pushToast(`Wysyłka anulowana, ale zlecenia zostały przypięte: ${un.error.message}`, 'error')
      else pushToast(s.bl_package_id ? 'Wysyłka anulowana — ANULUJ TEŻ PRZESYŁKĘ W BASELINKERZE / SUUS' : 'Wysyłka anulowana — zlecenia wróciły do „Do wysyłki”', s.bl_package_id ? 'info' : 'success')
      await load()
      return true
    },
    [pushToast, load],
  )

  /** Podpowiedź daty wydania: dzień ostatniej zmiany etapów (audit_log); brak = null. */
  const podpowiedzDaty = useCallback(async (ids: number[]): Promise<Map<number, string | null>> => {
    const { data, error } = await supabase.rpc('podpowiedz_daty_wydania', { p_order_ids: ids })
    const m = new Map<number, string | null>()
    if (error) return m
    for (const r of (data ?? []) as Array<{ order_id: number; data: string | null }>) m.set(Number(r.order_id), r.data)
    return m
  }, [])

  /** „Oznacz jako wydane” starych zleceń: data wydania + (D30) rozchód dla zamówionych od spisu 6.11,
   *  starsze tylko zamknięcie rezerwacji (rpc oznacz_wydane_wysylki; próg liczy baza). */
  const oznaczWydane = useCallback(async (lista: Array<{ id: number; data: string }>): Promise<boolean> => {
    let ok = 0
    let zRozchodem = 0
    const bledy: string[] = []
    for (const x of lista) {
      const { data, error } = await supabase.rpc('oznacz_wydane_wysylki', { p_order_id: x.id, p_date: x.data })
      if (error) bledy.push(error.message)
      else {
        ok++
        if (parseOznaczWydaneWynik(data)?.rozchod) zRozchodem++
      }
    }
    if (ok) {
      const dopisek = zRozchodem > 0
        ? ` (w tym ${zRozchodem} z rozchodem z magazynu)`
        : ' (zamknięto rezerwacje, bez rozchodu z magazynu)'
      pushToast(`Oznaczono jako wydane: ${ok} ${ok === 1 ? 'zlecenie' : 'zleceń'}${dopisek}`, 'success')
    }
    if (bledy.length) pushToast(`Nie oznaczono ${bledy.length}: ${bledy[0]}`, 'error')
    await load()
    return bledy.length === 0
  }, [pushToast, load])

  /** Anulowana wysyłka: przesyłka SUUS usunięta w BaseLinkerze — chowa ją z „Zaplanowanych”. */
  const potwierdzUsuniecieBl = useCallback(async (id: number): Promise<boolean> => {
    const { error } = await supabase.from('order_shipments').update({ bl_status: 'usunieta_w_bl' }).eq('id', id).eq('status', 'anulowana')
    if (error) {
      pushToast(`Nie zapisano: ${error.message}`, 'error')
      return false
    }
    pushToast('Zapisano: przesyłka usunięta w BaseLinkerze', 'success')
    await load()
    return true
  }, [pushToast, load])

  return { pending, shipments, loading, load, suggestPallets, createShipment, updateShipment, setStatus, cancelShipment, zlecPrzesylke, podpowiedzDaty, oznaczWydane, potwierdzUsuniecieBl }
}
