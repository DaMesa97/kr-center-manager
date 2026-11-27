// =====================================================================
// Telefon → Zlecenia → Wewn.: magazyn odznacza pozycje przygotowane do
// pakowania (to samo co w szczegółach zlecenia na komputerze, tabela
// order_item_picks). Duże pola do kliknięcia, grupy wg typu pozycji.
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { groupItemsByType, isKitPart } from '../../lib/optimaRo'
import { groupPicks, isPicked, pickChanged, pickKey, pickProgress, savePicks, sigsOf, type OrderPick } from '../../lib/orderPicks'
import type { InternalDoorItem } from '../../types'

type Props = {
  orderId: number
  /** kierownik / magazyn — pozostali tylko podgląd */
  canEdit: boolean
  initials: string
}

const SELECT = 'id, order_id, component_id, quantity, unit, item_type, optima_code, optima_name, optima_element_id, notes, warehouse_components(name, product_category)'

export default function MobileIntDoorPicking({ orderId, canEdit, initials }: Props) {
  const [items, setItems] = useState<InternalDoorItem[]>([])
  const [picks, setPicks] = useState<Map<string, OrderPick>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [it, pk] = await Promise.all([
      supabase.from('order_internal_door_items').select(SELECT).eq('order_id', orderId).order('id'),
      supabase.from('order_item_picks').select('order_id, line_key, picked_at, picked_by, picked_initials, line_sig').eq('order_id', orderId),
    ])
    if (it.error || pk.error) {
      setError((it.error ?? pk.error)?.message ?? 'błąd')
      setLoading(false)
      return
    }
    setItems(
      ((it.data ?? []) as Array<Record<string, unknown>>).map((r) => {
        const wc = r.warehouse_components as { name?: string | null; product_category?: string | null } | null
        return { ...(r as unknown as InternalDoorItem), component_name: wc?.name ?? null, component_category: wc?.product_category ?? null }
      }),
    )
    setPicks(groupPicks((pk.data ?? []) as OrderPick[]).get(orderId) ?? new Map())
    setError('')
    setLoading(false)
  }, [orderId])

  useEffect(() => {
    void load()
    // na żywo: ktoś inny odznacza to samo zlecenie (drugi telefon, biuro)
    const ch = supabase
      .channel(`mpick:${orderId}:${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_item_picks', filter: `order_id=eq.${orderId}` }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [orderId, load])

  const toggle = async (keys: string[], picked: boolean) => {
    if (keys.length === 0) return
    const before = picks
    const next = new Map(picks)
    const sigs = sigsOf(items)
    for (const k of keys) {
      if (picked) next.set(k, { order_id: orderId, line_key: k, picked_at: new Date().toISOString(), picked_by: null, picked_initials: initials || null, line_sig: sigs.get(k) ?? null })
      else next.delete(k)
    }
    setPicks(next)
    try {
      await savePicks(orderId, keys, picked, initials, sigs)
    } catch (e) {
      setPicks(before)
      setError(`Nie zapisano: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const groups = useMemo(() => groupItemsByType(items), [items])
  const pr = pickProgress(items, picks)

  if (loading) return <div className="mpick-info">Ładowanie pozycji…</div>
  if (items.length === 0) return <div className="mpick-info">{error || 'Zlecenie nie ma pozycji.'}</div>

  return (
    <div className="morders-section mpick">
      <div className="mpick-head">
        <span className="morders-section-title" style={{ margin: 0 }}>Przygotowanie do pakowania</span>
        <span className={`mpick-badge${pr.complete ? ' mpick-badge--done' : ''}`}>{pr.complete ? '✓ komplet' : `${pr.done}/${pr.total}`}</span>
      </div>
      {error && <div className="mpick-error">{error}</div>}
      {canEdit && (
        <div className="mpick-bulk">
          {!pr.complete && (
            <button type="button" className="mpick-bulk-btn" onClick={() => void toggle(items.filter((it) => !isPicked(picks, it)).map(pickKey), true)}>
              Zaznacz wszystkie
            </button>
          )}
          {pr.done > 0 && (
            <button type="button" className="mpick-bulk-btn mpick-bulk-btn--ghost" onClick={() => void toggle(items.filter((it) => picks.has(pickKey(it))).map(pickKey), false)}>
              Odznacz wszystkie
            </button>
          )}
        </div>
      )}
      {groups.map((g) => (
        <div key={g.key} className="mpick-group">
          <div className="mpick-group-title">
            {g.label} <span>{g.total}</span>
          </div>
          {g.items.map((it) => {
            const k = pickKey(it)
            const zmiana = pickChanged(picks, it)
            const p = isPicked(picks, it) ? picks.get(k) : undefined
            const kit = isKitPart(it)
            return (
              <label key={k} className={`mpick-row${p ? ' mpick-row--done' : ''}${canEdit ? '' : ' mpick-row--ro'}${kit ? ' mpick-row--kit-part' : ''}`}>
                <input type="checkbox" checked={Boolean(p)} disabled={!canEdit} onChange={(e) => void toggle([k], e.target.checked)} />
                <span className="mpick-row-main">
                  <span className="mpick-row-name">
                    {kit && '↳ '}
                    {it.optima_name || it.component_name || it.optima_code || 'Pozycja'}
                    {kit && <span className="optima-kit-badge">część kompletu</span>}
                  </span>
                  {it.notes && !kit && <span className="mpick-row-notes">{it.notes}</span>}
                  {zmiana && <span className="mpick-row-notes" style={{ color: '#b45309' }}>zmienione w Optimie po odhaczeniu — sprawdź i odhacz ponownie</span>}
                  {p && (
                    <span className="mpick-row-who">
                      ✓ {p.picked_initials ?? ''} {new Date(p.picked_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </span>
                <span className="mpick-row-qty">
                  {it.quantity} {String(it.unit || 'szt').replace(/\.$/, '')}
                </span>
              </label>
            )
          })}
        </div>
      ))}
    </div>
  )
}
