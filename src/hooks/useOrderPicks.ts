import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { fetchPicks, groupPicks, savePicks, type OrderPick, type PicksByOrder } from '../lib/orderPicks'
import type { ToastVariant } from '../types'

/**
 * Odznaczenia „przygotowane do pakowania” dla zleceń z wczytanymi pozycjami
 * (zakładka Drzwi wewnętrzne). Realtime na order_item_picks: biuro widzi na
 * żywo, co magazyn już przygotował. Zmiana od razu w UI, potem zapis.
 */
export function useOrderPicks(orderIds: number[], enabled: boolean, pushToast: (m: string, v: ToastVariant) => void) {
  const [picks, setPicks] = useState<PicksByOrder>(new Map())
  const key = useMemo(
    () => (enabled ? [...new Set(orderIds)].sort((a, b) => a - b).join(',') : ''),
    [orderIds, enabled],
  )

  const load = useCallback(async () => {
    if (!key) {
      setPicks(new Map())
      return
    }
    try {
      setPicks(groupPicks(await fetchPicks(key.split(',').map(Number))))
    } catch (e) {
      console.error('[przygotowanie] odczyt', e)
    }
  }, [key])
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!enabled) return
    let t: ReturnType<typeof setTimeout> | null = null
    const ch = supabase
      .channel(`order_item_picks:${Math.random().toString(36).slice(2, 10)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_item_picks' }, () => {
        if (t) clearTimeout(t)
        t = setTimeout(() => void loadRef.current(), 600)
      })
      .subscribe()
    return () => {
      if (t) clearTimeout(t)
      void supabase.removeChannel(ch)
    }
  }, [enabled])

  const toggle = useCallback(
    async (orderId: number, lineKeys: string[], picked: boolean, initials: string, sigs?: Map<string, string>) => {
      if (lineKeys.length === 0) return
      const now = new Date().toISOString()
      setPicks((prev) => {
        const next = new Map(prev)
        const m = new Map(next.get(orderId) ?? [])
        for (const k of lineKeys) {
          if (picked) {
            m.set(k, { ...(m.get(k) ?? { order_id: orderId, line_key: k, picked_at: now, picked_by: null }), picked_initials: initials || null, line_sig: sigs?.get(k) ?? null } as OrderPick)
          } else m.delete(k)
        }
        next.set(orderId, m)
        return next
      })
      try {
        await savePicks(orderId, lineKeys, picked, initials, sigs)
      } catch (e) {
        console.error('[przygotowanie] zapis', e)
        pushToast(`Nie zapisano przygotowania: ${e instanceof Error ? e.message : String(e)}`, 'error')
        void loadRef.current()
      }
    },
    [pushToast],
  )

  return { picks, toggle, reload: load }
}
