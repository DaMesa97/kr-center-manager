import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../supabaseClient'
import DeleteConfirmDialog from './DeleteConfirmDialog'
import OptimaCodeLinkDialog from './OptimaCodeLinkDialog'
import { isManagerRole } from '../lib/permissions'
import { inferConfirmTone } from '../lib/confirmTone'
import {
  OPTIMA_BAZA_LABEL,
  OPTIMA_READONLY_HINT,
  cancelledReason,
  formatOptimaDateTime,
  groupItemsByType,
  isKitPart,
  kitCodeOf,
  isOptimaOrder,
  lowerFirst,
  optimaBaza,
  optimaClosedLabel,
  optimaMeta,
  optimaStatusNote,
  recipientAddress,
  unmappedItems,
} from '../lib/optimaRo'
import { INTERNAL_WAREHOUSE_CODE_PATTERN, internalShortages, sumInternalStock, type Shortage } from '../lib/internalWarehouse'
import { isPicked, pickChanged, pickKey, pickProgress, sigsOf, type OrderPick } from '../lib/orderPicks'
import type { InternalDoorItem, Order, ToastVariant, WarehouseComponent } from '../types'
import { isOrderCancelled } from '../lib/orderCancelled'

type DetailsUser = {
  role: 'manager' | 'worker' | 'sprzedawca'
  department: 'all' | 'bastion' | 'stalowe' | 'magazyn'
  id: string
  initials: string
}

type Props = {
  open: boolean
  order: Order
  items: InternalDoorItem[]
  currentUser: DetailsUser
  /** komponenty magazynu — wyszukiwarka „Powiąż z komponentem" */
  components: WarehouseComponent[]
  /** zapis do optima_component_map (rola z polityki ocm_write) */
  canMapCodes: boolean
  /** pozycje przygotowane przez magazyn do pakowania (line_key → odznaczenie) */
  picks?: Map<string, OrderPick>
  /** odznacz / cofnij linie (kierownik, magazyn); brak = tylko podgląd */
  onTogglePick?: (lineKeys: string[], picked: boolean, sigs?: Map<string, string>) => void
  onClose: () => void
  onEdit: (order: Order) => void
  onAfterAction: () => void | Promise<void>
  pushToast: (message: string, variant: ToastVariant) => void
}

function InternalDoorOrderDetailsModal({
  open,
  order,
  items,
  currentUser,
  components,
  canMapCodes,
  picks,
  onTogglePick,
  onClose,
  onEdit,
  onAfterAction,
  pushToast,
}: Props) {
  const [confirmState, setConfirmState] = useState<{
    message: string
    title: string
    confirmLabel: string
    run: () => Promise<void>
  } | null>(null)
  const [linkItem, setLinkItem] = useState<InternalDoorItem | null>(null)

  const fromOptima = isOptimaOrder(order)
  const meta = optimaMeta(order)
  const baza = optimaBaza(order)
  const missing = unmappedItems(items)

  const isCancelled = isOrderCancelled(order)
  const isReleased = Boolean(order.release_date && String(order.release_date).trim())
  // RO zrealizowane / zamknięte w Optimie: bez wydania z magazynu (historia sprzed magazynu w programie)
  const closedInOptima = optimaClosedLabel(order)
  const isInProgress = !isCancelled && !isReleased && !closedInOptima
  const isManager = isManagerRole(currentUser.role)
  const canRelease =
    isManager ||
    String(currentUser.role) === 'magazynier' ||
    (currentUser.role === 'worker' && currentUser.department === 'magazyn')

  const cancelledInfo = useMemo(() => cancelledReason(order), [order])

  const statusLabel = isCancelled ? (fromOptima ? 'Anulowane w Optimie' : 'Anulowane') : closedInOptima ?? (isReleased ? 'Wydane' : 'W realizacji')
  const statusClass = isCancelled
    ? 'order-status-badge--cancelled'
    : isReleased || closedInOptima
      ? 'order-status-badge--released'
      : 'order-status-badge--in-progress'

  const componentById = useMemo(() => new Map(components.map((c) => [c.id, c])), [components])
  const groups = useMemo(() => groupItemsByType(items), [items])
  // pozycje z RO rozbite na komplet (mają części) — komponent ustawia baza z optima_kit_parts, nie mapa kodów
  const kitParents = useMemo(() => new Set(items.filter(isKitPart).map((it) => it.optima_element_id)), [items])

  // Stan magazynu wewnętrznego dla komponentów zlecenia + to, co już zeszło (WZ − ZWR)
  const [stockInfo, setStockInfo] = useState<{ stock: Map<number, number>; issued: Array<{ component_id: number; movement_type: string; quantity: number }> } | null>(null)
  // kartoteki w tle (is_stocked = false) to towar na zamówienie — bez stanu i bez braków
  const stockedItems = useMemo(() => items.filter((it) => it.component_is_stocked !== false), [items])
  const componentIds = useMemo(
    () => [...new Set(stockedItems.map((it) => it.component_id).filter((id): id is number => id != null))],
    [stockedItems],
  )
  const loadStock = useCallback(async () => {
    if (!fromOptima || !order.id || componentIds.length === 0 || closedInOptima) {
      setStockInfo(null)
      return
    }
    const [st, mv] = await Promise.all([
      // stan = Magazyn 1 + Magazyn 2 (magazyny WEW*)
      supabase.from('warehouse_stock').select('component_id, quantity, warehouses!inner(code)').ilike('warehouses.code', INTERNAL_WAREHOUSE_CODE_PATTERN).in('component_id', componentIds),
      supabase.from('warehouse_movements').select('component_id, movement_type, quantity').eq('order_id', order.id).in('movement_type', ['WZ', 'ZWR']),
    ])
    if (st.error || mv.error) {
      console.error('[drzwi wewnętrzne] stan magazynu dla zlecenia', st.error ?? mv.error)
      setStockInfo(null)
      return
    }
    setStockInfo({
      stock: sumInternalStock(st.data ?? []),
      issued: (mv.data ?? []) as Array<{ component_id: number; movement_type: string; quantity: number }>,
    })
  }, [fromOptima, order.id, componentIds, closedInOptima])
  useEffect(() => {
    if (open) void loadStock()
  }, [open, loadStock])
  const shortages = useMemo<Map<number, Shortage>>(
    () => (stockInfo ? internalShortages(stockedItems, stockInfo.stock, stockInfo.issued) : new Map()),
    [stockedItems, stockInfo],
  )
  const shortList = [...shortages.values()].filter((s) => s.missing > 0)
  const codeOf = (componentId: number) =>
    items.find((it) => it.component_id === componentId)?.optima_code || componentById.get(componentId)?.code || `#${componentId}`

  const formatItemMeta = (item: InternalDoorItem) => {
    const itemData = item as InternalDoorItem & {
      component_product_category?: string | null
      component_door_model?: string | null
      component_door_size?: string | null
      component_door_direction?: string | null
      component_door_color?: string | null
      component_door_frame_type?: string | null
      component_door_frame_code?: string | null
      component_door_handle_shield?: string | null
    }
    const category = String(item.component_category ?? itemData.component_product_category ?? '')
    const model = String(itemData.component_door_model ?? '').trim()
    const size = String(itemData.component_door_size ?? '').trim()
    const direction = String(itemData.component_door_direction ?? '').trim()
    const color = String(itemData.component_door_color ?? '').trim()
    const frameType = String(itemData.component_door_frame_type ?? '').trim()
    const frameCode = String(itemData.component_door_frame_code ?? '').trim()
    const shield = String(itemData.component_door_handle_shield ?? '').trim()

    if (category === 'door_wing') {
      return ['Skrzydło', model || '—', size || '—', direction || '—', color || '—'].join(' · ')
    }
    if (category === 'door_frame') {
      if (frameType === 'adjustable') {
        return ['Ościeżnica regulowana', frameCode || '—', color || '—', size || '—', direction || '—'].join(' · ')
      }
      return ['Ościeżnica prosta', color || '—', size || '—', direction || '—'].join(' · ')
    }
    if (category === 'door_handle') {
      return ['Klamka', model || '—', color || '—', shield || '—'].join(' · ')
    }
    if (category === 'door_hinge_cover') {
      return ['Osłonka', color || '—'].join(' · ')
    }
    return String(item.component_name ?? '').trim()
  }

  /** Wydanie z magazynu wewnętrznego — RPC rozlicza różnicę netto, więc można wołać wielokrotnie. */
  const issueStock = async (): Promise<boolean> => {
    const { error } = await supabase.rpc('issue_internal_door_stock', { p_order_id: order.id! })
    if (error) {
      console.error('[drzwi wewnętrzne] issue_internal_door_stock', order.id, error)
      pushToast(`Wydanie z magazynu nie powiodło się: ${error.message}`, 'error')
      return false
    }
    return true
  }

  const skippedWarning =
    missing.length > 0
      ? `\n\nUwaga: ${missing.length} z ${items.length} poz. nie ma komponentu magazynu i zostanie pominiętych przy wydaniu z magazynu (${missing
          .map((it) => it.optima_code || it.optima_name || '?')
          .join(', ')}). Powiąż kody, żeby zeszły ze stanu.`
      : ''

  const shortageWarning =
    fromOptima && shortList.length > 0
      ? `\n\nBrak na stanie magazynu wewnętrznego (${shortList.length} poz.): ${shortList
          .slice(0, 3)
          .map((s) => `${codeOf(s.componentId)} — potrzeba ${s.toIssue}, stan ${s.stock}`)
          .join('; ')}${shortList.length > 3 ? ` i ${shortList.length - 3} innych (kolumna STAN)` : ''}. Wydanie zejdzie poniżej zera — zrób przyjęcie albo inwentaryzację.`
      : ''

  const requestRelease = () => {
    setConfirmState({
      title: 'Wydaj zamówienie',
      confirmLabel: 'Wydaj',
      message: fromOptima
        ? `Wydać zlecenie ${order.order_number} dla ${order.company}? Pozycje z komponentem zejdą z magazynu wewnętrznego.${shortageWarning}${skippedWarning}`
        : `Czy na pewno wydać zamówienie #${order.order_number} dla firmy ${order.company}?`,
      run: async () => {
        // runda 4: zlecenie mogło zostać anulowane, gdy okno było otwarte — świeży odczyt przed zdjęciem z magazynu
        const { data: swieze, error: blSwieze } = await supabase.from('orders').select('extra_fields').eq('id', order.id!).maybeSingle()
        if (blSwieze) {
          pushToast(`Nie wydano: nie udało się sprawdzić w bazie, czy zlecenie nie jest anulowane (${blSwieze.message}) — spróbuj ponownie`, 'error')
          return
        }
        if (isOrderCancelled(swieze)) {
          pushToast('Zlecenie zostało anulowane — nie wydano (odśwież listę)', 'error')
          return
        }
        // Ręczne zlecenia schodzą z magazynu przy zapisie; z Optimy — dopiero tu
        if (fromOptima && !(await issueStock())) return
        const today = new Date().toLocaleDateString('sv-SE')
        const { error } = await supabase.from('orders').update({ release_date: today }).eq('id', order.id!)
        if (error) {
          pushToast(`Błąd wydania zamówienia: ${error.message}`, 'error')
          return
        }
        pushToast(missing.length > 0 && fromOptima ? `Zamówienie wydane — pominięto pozycji bez komponentu: ${missing.length}` : 'Zamówienie wydane', missing.length > 0 && fromOptima ? 'info' : 'success')
        await onAfterAction()
        onClose()
      },
    })
  }

  const requestReissue = () => {
    setConfirmState({
      title: 'Dolicz wydanie z magazynu',
      confirmLabel: 'Dolicz',
      message: `Rozliczyć magazyn dla ${order.order_number} jeszcze raz? Zejdą pozycje powiązane po wydaniu (i korekty ilości z Optimy).${shortageWarning}${skippedWarning}`,
      run: async () => {
        if (!(await issueStock())) return
        pushToast('Magazyn rozliczony', 'success')
        await loadStock()
        await onAfterAction()
      },
    })
  }

  const requestReturn = () => {
    setConfirmState({
      title: 'Zwróć towar na magazyn',
      confirmLabel: 'Zwróć',
      message: `RO ${order.order_number} anulowano w Optimie. Zwrócić na magazyn wszystko, co wydano do tego zlecenia?`,
      run: async () => {
        const { error } = await supabase.rpc('return_stock_for_order', { p_order_id: order.id! })
        if (error) {
          pushToast(`Błąd zwrotu stocku: ${error.message}`, 'error')
          return
        }
        pushToast('Towar zwrócony na magazyn', 'success')
        await onAfterAction()
      },
    })
  }

  const requestCancel = () => {
    setConfirmState({
      title: 'Anuluj zamówienie',
      confirmLabel: 'Anuluj zamówienie',
      message: `Czy na pewno anulować zamówienie #${order.order_number}? Stock zostanie zwrócony do magazynu.`,
      run: async () => {
        const { error: retErr } = await supabase.rpc('return_stock_for_order', { p_order_id: order.id! })
        if (retErr) {
          pushToast(`Błąd zwrotu stocku: ${retErr.message}`, 'error')
          return
        }
        const cancelledAt = new Date().toISOString()
        const cancelledBy = currentUser.initials
        // Merge po stronie bazy (RPC) — nie nadpisujemy całego extra_fields
        const { error: updErr } = await supabase.rpc('merge_order_extra_fields', {
          p_order_id: order.id!,
          p_patch: { cancelled: true, cancelled_at: cancelledAt, cancelled_by: cancelledBy },
        })
        if (updErr) {
          pushToast(`Błąd anulowania zamówienia: ${updErr.message}`, 'error')
          return
        }
        pushToast('Zamówienie anulowane, stock zwrócony', 'success')
        await onAfterAction()
        onClose()
      },
    })
  }

  const renderPick = (item: InternalDoorItem) => {
    const k = pickKey(item)
    // zmienione w Optimie po odhaczeniu (ilość / kod) = nieodhaczone, z podpowiedzią w dymku
    const zmiana = pickChanged(picks, item)
    const p = isPicked(picks, item) ? picks?.get(k) : undefined
    const editable = Boolean(onTogglePick) && isInProgress
    const who = p ? `Przygotował${p.picked_initials ? ` ${p.picked_initials}` : 'o'} ${new Date(p.picked_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''
    return (
      <input
        type="checkbox"
        className="int-door-pick-check"
        checked={Boolean(p)}
        disabled={!editable}
        onChange={(e) => onTogglePick?.([k], e.target.checked, sigsOf([item]))}
        title={zmiana ? 'Zmienione w Optimie po odhaczeniu — sprawdź i odhacz ponownie' : p ? who : editable ? 'Odznacz, gdy pozycja jest przygotowana do pakowania' : 'Nieprzygotowane'}
        aria-label={`Przygotowane: ${item.optima_name || item.component_name || 'pozycja'}`}
      />
    )
  }

  if (!open) return null

  const wentylacja = String((order as unknown as Record<string, unknown>).wentylacja ?? '').trim()
  const address = recipientAddress(meta?.recipient)

  return createPortal(
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="order-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: fromOptima ? 1080 : 860 }}>
          <div className="order-modal-header">
            <h2>
              {fromOptima ? 'Zlecenie' : 'Zamówienie #'}
              {fromOptima ? ` ${order.order_number}` : order.order_number} — {order.company || '—'}
            </h2>
            <button className="btn btn-icon btn-ghost" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="order-modal-body internal-door-details-body">
          <div className="internal-door-details-section internal-door-details-badges">
            <span className={`order-status-badge ${statusClass}`} title={isCancelled ? cancelledInfo || undefined : undefined}>
              {statusLabel}
            </span>
            {fromOptima && (
              <span className={`optima-badge optima-badge--${baza === 'MR' ? 'mr' : 'kr'}`}>
                Z Optimy ({baza ? OPTIMA_BAZA_LABEL[baza] : meta?.baza || '?'})
              </span>
            )}
            {fromOptima && meta?.updated && (
              <span className="muted" title="Ostatnia zmiana rezerwacji odbiorcy w Optimie (source_metadata.updated)">
                RO zmienione w Optimie: {formatOptimaDateTime(meta.updated)}
              </span>
            )}
          </div>

          {isCancelled && (
            <div className="internal-door-details-meta-info">{cancelledInfo || 'Anulowane'}</div>
          )}
          {optimaStatusNote(order) && (
            <div className="optima-status-note" title="Status przychodzi z Optimy przy imporcie co godzinę. Ręczne zamknięcie w programie import zostawia.">
              {optimaStatusNote(order)}
            </div>
          )}
          {isReleased && <div className="internal-door-details-meta-info">Wydano {order.release_date}</div>}

          {fromOptima && (
            <div className="internal-door-details-section optima-readonly" title={OPTIMA_READONLY_HINT}>
              <div className="optima-readonly-hint">🔒 Dane z Optimy — {lowerFirst(OPTIMA_READONLY_HINT)}.</div>
              <dl className="optima-readonly-grid">
                <dt>Nr RO</dt>
                <dd>{order.erp_ro_number || order.order_number}</dd>
                <dt>Nabywca</dt>
                <dd>
                  {order.company || '—'}
                  {meta?.payer_code && meta.payer_code !== order.company ? <span className="muted"> ({meta.payer_code})</span> : null}
                </dd>
                <dt>Nr zamówienia klienta</dt>
                <dd>{order.client_order_number || '—'}</dd>
                <dt>Data RO</dt>
                <dd>{order.order_date ? formatOptimaDateTime(order.order_date) : '—'}</dd>
                <dt>Odbiorca</dt>
                <dd>{address || '—'}</dd>
                <dt>Skrzydła</dt>
                <dd>{order.quantity ?? '—'}</dd>
                <dt>Wprowadził</dt>
                <dd>{order.entered_by || '—'}</dd>
                {String(order.notes ?? '').trim() && (
                  <>
                    <dt>Opis RO</dt>
                    <dd className="optima-readonly-notes">{order.notes}</dd>
                  </>
                )}
              </dl>
            </div>
          )}

          {wentylacja && (
            <div className="internal-door-details-section">
              <h4>Wentylacja</h4>
              <div>{wentylacja}</div>
            </div>
          )}

          {!fromOptima && String(order.notes ?? '').trim() && (
            <div className="internal-door-details-section">
              <h4>Uwagi</h4>
              <div>{order.notes}</div>
            </div>
          )}

          <div className="internal-door-details-section">
            <h4 className="int-door-items-head">
              Pozycje
              {(() => {
                const pr = pickProgress(items, picks)
                if (pr.total === 0) return null
                const editable = Boolean(onTogglePick) && isInProgress
                return (
                  <span className="int-door-pick-summary">
                    <span className={pr.complete ? 'int-door-pick-badge int-door-pick-badge--done' : 'int-door-pick-badge'} title="Pozycje przygotowane przez magazyn do pakowania">
                      {pr.complete ? '✓ przygotowane do pakowania' : `przygotowano ${pr.done}/${pr.total}`}
                    </span>
                    {editable && !pr.complete && (
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => onTogglePick!(items.filter((it) => !isPicked(picks, it)).map(pickKey), true, sigsOf(items))}>
                        Zaznacz wszystkie
                      </button>
                    )}
                    {editable && pr.done > 0 && (
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => onTogglePick!(items.filter((it) => picks?.has(pickKey(it))).map(pickKey), false)}>
                        Odznacz wszystkie
                      </button>
                    )}
                  </span>
                )
              })()}
              {fromOptima && missing.length > 0 && (
                <span className="optima-unmapped-badge" style={{ marginLeft: 8 }}>
                  ⚠ bez komponentu: {missing.length}
                </span>
              )}
            </h4>
            {items.length === 0 ? (
              <p className="no-results">Brak pozycji dla zamówienia.</p>
            ) : fromOptima ? (
              <div className="orders-table-wrapper">
                <table className="orders-table optima-items-table">
                  <thead>
                    <tr>
                      <th className="int-door-pick-col" title="Przygotowane do pakowania (magazyn odznacza pozycje)">✓</th>
                      <th>KOD OPTIMY</th>
                      <th>NAZWA</th>
                      <th style={{ textAlign: 'right' }}>ILOŚĆ</th>
                      <th style={{ textAlign: 'right' }} title="Stan w magazynie wewnętrznym; „brak” = mniej, niż trzeba jeszcze wydać do tego zlecenia">
                        STAN
                      </th>
                      <th>OPIS</th>
                      <th>KOMPONENT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.flatMap((g) => [
                      <tr key={`g-${g.key}`} className="optima-items-group-row">
                        <td colSpan={7}>
                          {g.label}
                          <span className="optima-items-group-total">{g.total}</span>
                        </td>
                      </tr>,
                      ...g.items.map((item) => {
                        const comp = item.component_id != null ? componentById.get(item.component_id) : undefined
                        const unmapped = item.component_id == null
                        const compName = comp?.name ?? item.component_name ?? ''
                        const sameName = !!compName && compName.trim() === String(item.optima_name ?? '').trim()
                        const sh = item.component_id != null ? shortages.get(item.component_id) : undefined
                        const st = item.component_id != null ? (stockInfo?.stock.get(item.component_id) ?? 0) : 0
                        const kit = isKitPart(item)
                        const zKompletu = kit || kitParents.has(item.optima_element_id)
                        return (
                          <tr key={pickKey(item)} className={[unmapped ? 'optima-item--unmapped' : '', isPicked(picks, item) ? 'int-door-item--picked' : '', kit ? 'optima-item--kit-part' : ''].filter(Boolean).join(' ') || undefined}>
                            <td className="int-door-pick-col">{renderPick(item)}</td>
                            <td title={item.optima_group ? `Grupa w Optimie: ${item.optima_group}` : undefined}>
                              {kit && <span className="optima-kit-arrow" aria-hidden>↳</span>}
                              <span className="optima-code">{item.optima_code || '—'}</span>
                            </td>
                            <td className="optima-items-wrap">
                              {item.optima_name || '—'}
                              {kit && (
                                <span className="optima-kit-badge" title={`Dopisane z rozbicia kompletu z Optimy: ${kitCodeOf(item) ?? ''}. Wydanie zdejmuje tę część osobno.`}>
                                  część kompletu
                                </span>
                              )}
                            </td>
                            <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                              {item.quantity} {item.unit || 'szt.'}
                            </td>
                            <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                              {item.component_is_stocked === false ? (
                                <span className="optima-ordered-badge" title="Kartoteka w tle — towar na zamówienie, nie trzymamy go na magazynie; wydanie nie zdejmuje stanu">
                                  na zamówienie
                                </span>
                              ) : unmapped || !stockInfo ? (
                                <span className="muted">—</span>
                              ) : sh && sh.missing > 0 ? (
                                <span className="optima-stock-short" title={`Do wydania ${sh.toIssue}, na stanie ${sh.stock}`}>
                                  {st} · brak {sh.missing}
                                </span>
                              ) : (
                                <span className={sh && sh.toIssue > 0 ? 'optima-stock-ok' : 'muted'}>{st}</span>
                              )}
                            </td>
                            <td className="optima-items-wrap optima-items-notes">{kit ? <span className="muted">—</span> : item.notes || '—'}</td>
                            <td>
                              {unmapped ? (
                                <div className="optima-item-link">
                                  <span className="optima-unmapped-badge">⚠ brak komponentu</span>
                                  {canMapCodes && item.optima_code && (
                                    <button type="button" className="btn btn-sm btn-primary" onClick={() => setLinkItem(item)}>
                                      Powiąż z komponentem
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <div className="optima-item-link">
                                  <span className={sameName ? 'optima-stock-ok' : 'optima-items-wrap'} title={[compName, formatItemMeta(item)].filter(Boolean).join(' — ')}>
                                    {sameName ? '✓ powiązany' : compName || `#${item.component_id}`}
                                  </span>
                                  {canMapCodes && item.optima_code && !zKompletu && (
                                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLinkItem(item)} title="Zmień powiązanie tego kodu (dla wszystkich pozycji z tym kodem)">
                                      zmień
                                    </button>
                                  )}
                                  {zKompletu && (
                                    <span className="muted" title="Komplet z Optimy — części ustawia baza (tabela optima_kit_parts), nie mapa kodów">komplet</span>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      }),
                    ])}
                  </tbody>
                </table>
                {isInProgress && shortList.length > 0 && (
                  <div className="optima-shortage-box">
                    Brak na stanie magazynu wewnętrznego: {shortList.length} poz. (brakuje łącznie {shortList.reduce((n, x) => n + x.missing, 0)}).
                    {' '}Wydanie zejdzie poniżej zera — najpierw przyjęcie albo inwentaryzacja.
                  </div>
                )}
                {missing.length > 0 && !canMapCodes && (
                  <p className="muted">Kody bez komponentu powiąże kierownik albo magazynier (Magazyn → Komponenty → Kody Optimy).</p>
                )}
              </div>
            ) : (
              items.map((item) => (
                <div key={item.id} className={`internal-door-details-item${isPicked(picks, item) ? ' int-door-item--picked' : ''}`}>
                  <div className="int-door-pick-col">{renderPick(item)}</div>
                  <div className="internal-door-details-item-main">
                    <div className="internal-door-details-item-name">{item.component_name ?? 'Komponent'}</div>
                    <div className="internal-door-details-item-meta">{formatItemMeta(item)}</div>
                    {item.shorten_enabled && item.shorten_target_height && (
                      <div className="internal-door-details-item-shorten">
                        Skrócenie do {item.shorten_target_height} mm
                      </div>
                    )}
                    {item.notes && (
                      <div className="internal-door-details-item-meta">Uwagi: {item.notes}</div>
                    )}
                  </div>
                  <div className="internal-door-details-item-qty">{item.quantity} szt.</div>
                </div>
              ))
            )}
          </div>

            {fromOptima && isInProgress && isManager && (
              <p className="muted">Anulowanie: usuń pozycje drzwi z RO w Optimie — import oznaczy zlecenie jako anulowane.</p>
            )}
          </div>

          <div className="order-form-actions">
            {/* isManagerRole zamiast sztywnego 'manager' — nowe role kierownicze
                (admin, kierownik_*) nie widziały tu żadnych przycisków */}
            {/* D40: edycja tylko zleceń z Optimy (pola produkcyjne) — ręcznych zleceń drzwi wewnętrznych nie ma */}
            {isInProgress && isManager && fromOptima && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                title="Z Optimy edytujesz tylko pola produkcyjne (wentylacja) — reszta przychodzi z Optimy"
                onClick={() => {
                  onEdit(order)
                  onClose()
                }}
              >
                Edytuj
              </button>
            )}
            {isInProgress && canRelease && (
              <button type="button" className="btn btn-primary" onClick={requestRelease}>
                ✓ Wydane
              </button>
            )}
            {fromOptima && isReleased && !isCancelled && !closedInOptima && canRelease && (
              <button type="button" className="btn btn-secondary" onClick={requestReissue} title="Zdejmuje ze stanu pozycje powiązane po wydaniu albo zmienione w Optimie (rozlicza różnicę)">
                Dolicz wydanie z magazynu
              </button>
            )}
            {fromOptima && isCancelled && isManager && (
              <button type="button" className="btn btn-secondary" onClick={requestReturn} title="Zwraca na magazyn wszystko, co wydano do tego RO (bezpieczne przy wielokrotnym kliknięciu)">
                Zwróć wydany towar
              </button>
            )}
            {isInProgress && isManager && !fromOptima && (
              <button type="button" className="btn btn-danger" onClick={requestCancel}>
                Anuluj zamówienie
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Zamknij
            </button>
          </div>
        </div>
      </div>

      {confirmState && (
        <DeleteConfirmDialog
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          cancelLabel="Wróć"
          tone={inferConfirmTone(confirmState.title, confirmState.confirmLabel)}
          onCancel={() => setConfirmState(null)}
          onConfirm={() => {
            const run = confirmState.run
            setConfirmState(null)
            void run()
          }}
        />
      )}

      {linkItem && linkItem.optima_code && (
        <OptimaCodeLinkDialog
          code={linkItem.optima_code}
          name={linkItem.optima_name}
          group={linkItem.optima_group}
          components={components}
          currentId={linkItem.component_id}
          pushToast={pushToast}
          onDone={onAfterAction}
          onClose={() => setLinkItem(null)}
        />
      )}
    </>,
    document.body,
  )
}

export default InternalDoorOrderDetailsModal
