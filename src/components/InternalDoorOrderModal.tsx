import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useUnsavedGuard } from '../lib/useUnsavedGuard'
import { createPortal } from 'react-dom'
import { supabase } from '../supabaseClient'
import { componentLabel } from '../lib/componentLabel'
import { OPTIMA_READONLY_HINT, isKitPart, isOptimaOrder, isOrderCancelled, lowerFirst } from '../lib/optimaRo'
import { pickKey } from '../lib/orderPicks'
import { INTERNAL_WAREHOUSE_CODE_PATTERN } from '../lib/internalWarehouse'
import { appConfirm } from '../lib/appDialogs'
import { checkOrderQuantity } from '../utils'
import type { Order, WarehouseComponent, InternalDoorItem, ToastVariant } from '../types'

type Mode = 'create' | 'edit'

type ItemDraft = {
  id?: number
  component_id: number | null
  component?: WarehouseComponent | null
  quantity: number
  shorten_enabled: boolean
  shorten_target_height: number | null
  notes: string | null
}

type Props = {
  open: boolean
  mode: Mode
  initialOrder?: Order | null
  initialItems?: InternalDoorItem[]
  components: WarehouseComponent[]
  companies: string[]
  currentUserId: string
  onClose: () => void
  onSaved: () => void
  pushToast: (message: string, variant: ToastVariant) => void
}

function InternalDoorOrderModal({
  open,
  mode,
  initialOrder,
  initialItems,
  components,
  companies,
  currentUserId,
  onClose,
  onSaved,
  pushToast,
}: Props) {
  const [companyName, setCompanyName] = useState('')
  const [notes, setNotes] = useState('')
  const [wentylacja, setWentylacja] = useState('')
  const [wentylacjaOptions, setWentylacjaOptions] = useState<string[]>([])
  const [items, setItems] = useState<ItemDraft[]>([])
  const [stocks, setStocks] = useState<Record<number, number>>({})
  const [saving, setSaving] = useState(false)
  const { requestClose } = useUnsavedGuard({ companyName, notes, wentylacja, items }, onClose, { enabled: !saving, escape: open, resetKey: open })
  // Zlecenie z Optimy: firmę, opis i pozycje nadpisuje import — tu tylko pola produkcyjne
  const fromOptima = mode === 'edit' && isOptimaOrder(initialOrder)

  const internalDoorComponents = useMemo(() => {
    return components.filter((c) => c.is_active && c.product_category !== 'raw')
  }, [components])

  useEffect(() => {
    if (!open) return
    // słownik wentylacji (Konfiguracja → Wewnętrzne → Wentylacja)
    void supabase
      .from('config_options')
      .select('value')
      .eq('category', 'Wewnetrzne')
      .eq('type', 'wentylacja')
      .order('sort_order')
      .then(({ data }) => setWentylacjaOptions((data ?? []).map((r) => String((r as { value: string }).value))))
    if (mode === 'edit' && initialOrder) {
      setCompanyName(initialOrder.company ?? '')
      setNotes(initialOrder.notes ?? '')
      setWentylacja(String((initialOrder as unknown as Record<string, unknown>).wentylacja ?? ''))
      const drafts: ItemDraft[] = (initialItems ?? []).map((it) => ({
        id: it.id,
        component_id: it.component_id,
        component: components.find((c) => c.id === it.component_id) ?? null,
        quantity: it.quantity,
        shorten_enabled: it.shorten_enabled,
        shorten_target_height: it.shorten_target_height,
        notes: it.notes,
      }))
      setItems(drafts)
    } else if (mode === 'create') {
      setCompanyName('')
      setNotes('')
      setWentylacja('')
      setItems([])
    }
  }, [open, mode, initialOrder, initialItems, components])

  const fetchStocksFor = useCallback(async (componentIds: number[]) => {
    if (componentIds.length === 0) return
    // Tylko magazyny drzwi wewnętrznych (WEW1 Magazyn 1 + WEW2 Magazyn 2) — z nich schodzą pozycje;
    // sumowanie wszystkich magazynów pokazywało "Stan: 5", gdy na wewnętrznych było 0
    const { data, error } = await supabase
      .from('warehouse_stock')
      .select('component_id, quantity, warehouses!inner(code)')
      .ilike('warehouses.code', INTERNAL_WAREHOUSE_CODE_PATTERN)
      .in('component_id', componentIds)
    if (error) {
      console.error(error)
      return
    }
    const map: Record<number, number> = {}
    ;(data ?? []).forEach((row) => {
      const componentId = Number((row as { component_id: number }).component_id)
      map[componentId] = (map[componentId] ?? 0) + Number((row as { quantity: number }).quantity)
    })
    setStocks(map)
  }, [])

  useEffect(() => {
    const ids = items
      .map((it) => it.component_id)
      .filter((id): id is number => id !== null)
    if (ids.length > 0) {
      void fetchStocksFor(ids)
    }
  }, [items, fetchStocksFor])

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      {
        component_id: null,
        quantity: 1,
        shorten_enabled: false,
        shorten_target_height: null,
        notes: null,
      },
    ])
  }

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  const updateItem = (idx: number, patch: Partial<ItemDraft>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  const onSelectComponent = (idx: number, componentId: number) => {
    const comp = components.find((c) => c.id === componentId) ?? null
    updateItem(idx, { component_id: componentId, component: comp })
  }

  const fetchNextInternalDoorOrderNumber = useCallback(async (): Promise<string | null> => {
    // RPC w SQL — bez limitu 1000 wierszy PostgREST (stary MAX+1 w JS
    // po przekroczeniu 1000 zamówień liczyłby z obciętego podzbioru,
    // a unikalny indeks numerów zamieniłby to w blokadę zapisu)
    const { data, error } = await supabase.rpc('get_next_order_number', {
      p_category: 'DrzwiWewnetrzne',
    })
    if (error || !data) {
      console.error(error)
      return null
    }
    return String(data)
  }, [])

  const savingRef = useRef(false)

  const handleSaveImpl = async () => {
    if (fromOptima) {
      // Pozycji i pól z Optimy nie zapisujemy (import i tak by je nadpisał);
      // magazyn rozlicza „✓ Wydane" w szczegółach zlecenia
      setSaving(true)
      const { error } = await supabase.from('orders').update({ wentylacja: wentylacja.trim() }).eq('id', initialOrder!.id!)
      setSaving(false)
      if (error) {
        pushToast(`Błąd zapisu zamówienia: ${error.message}`, 'error')
        return
      }
      onSaved()
      onClose()
      return
    }
    if (items.length === 0) {
      pushToast('Dodaj co najmniej jedną pozycję', 'error')
      return
    }
    if (items.some((it) => !it.component_id)) {
      pushToast('Każda pozycja musi mieć wybrany komponent', 'error')
      return
    }
    // testy 27.11 (runda 3): ilość tylko całkowita 1…1000 (0 nie zamienia się już cicho na 1),
    // powyżej 50 szt. pytamy
    const bigQty: string[] = []
    for (let i = 0; i < items.length; i++) {
      const q = checkOrderQuantity(items[i].quantity, `Pozycja ${i + 1}`)
      if (!q.ok) {
        pushToast(q.message, 'error')
        return
      }
      if (q.needsConfirm) bigQty.push(`pozycja ${i + 1}: ${q.value} szt.`)
    }
    if (bigQty.length > 0) {
      const sure = await appConfirm(`Na pewno takie ilości? ${bigQty.join(', ')}.`, {
        title: 'Duża ilość',
        confirmLabel: 'Tak, zapisz',
      })
      if (!sure) return
    }
    if (items.some((it) => it.shorten_enabled && (!Number.isFinite(it.shorten_target_height) || (it.shorten_target_height ?? 0) <= 0))) {
      pushToast('Skrócenie wymaga poprawnego wymiaru docelowego', 'error')
      return
    }

    setSaving(true)
    let orderId: number
    let createdNewOrder = false

    if (mode === 'create') {
      const nextOrderNumber = await fetchNextInternalDoorOrderNumber()
      if (!nextOrderNumber) {
        setSaving(false)
        pushToast('Nie udało się pobrać numeru zamówienia — spróbuj ponownie', 'error')
        return
      }
      // testy 27.11 (runda 3): WPISAŁ = inicjały / imię użytkownika (jak bot i Excel), nie UUID
      const { data: me } = await supabase
        .from('profiles')
        .select('initials, full_name')
        .eq('id', currentUserId)
        .maybeSingle()
      const enteredBy = String(
        (me as { initials?: string | null; full_name?: string | null } | null)?.initials ||
          (me as { full_name?: string | null } | null)?.full_name ||
          '',
      ).trim()
      const { data, error } = await supabase
        .from('orders')
        .insert({
          category: 'DrzwiWewnetrzne',
          order_number: nextOrderNumber,
          company: companyName.trim(),
          notes: notes.trim(),
          wentylacja: wentylacja.trim(),
          entered_by: enteredBy,
          quantity: items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0),
          sequence: '',
          system: '',
          model: '',
          wing_color: '',
          frame_color: '',
          threshold_color: '',
          width: '',
          direction: '',
          opening: '',
          height: '',
          glazing: '',
          decorative_panel: '',
          hardware: '',
          handle: '',
          electric_strike: '',
          peephole: '',
          top_light: '',
          top_light_glazing: '',
          side_panel: '',
          side_panel_glazing: '',
          extension: '',
          disting_sheet: '',
          client_order_number: '',
          defects: '',
          configurator_value: null,
          info: '',
          airtable_id: '',
          label: '',
        })
        .select('id')
        .single()

      if (error || !data) {
        setSaving(false)
        // Kolizja numeru (równoległy zapis z drugiego stanowiska) — jasny komunikat
        if ((error as { code?: string } | null)?.code === '23505') {
          pushToast('Numer zamówienia został właśnie zajęty — kliknij Zapisz ponownie', 'error')
        } else {
          pushToast(`Błąd zapisu zamówienia: ${error?.message ?? 'Nieznany błąd'}`, 'error')
        }
        return
      }
      orderId = Number((data as { id: number }).id)
      createdNewOrder = true
    } else {
      if (!initialOrder?.id) {
        setSaving(false)
        pushToast('Brak identyfikatora zamówienia', 'error')
        return
      }
      orderId = initialOrder.id

      // testy 27.11 (runda 3): anulowanego zlecenia nie zapisujemy — ponowne wydanie
      // pozycji (issue_internal_door_stock) zdjęłoby towar z magazynu. Świeży odczyt
      // łapie też anulowanie przez kogoś innego w trakcie edycji.
      const { data: fresh, error: freshErr } = await supabase
        .from('orders')
        .select('extra_fields')
        .eq('id', orderId)
        .maybeSingle()
      if (freshErr || !fresh) {
        setSaving(false)
        pushToast(`Nie udało się sprawdzić zlecenia przed zapisem: ${freshErr?.message ?? 'nie ma go w bazie'}`, 'error')
        return
      }
      if (isOrderCancelled(fresh as Pick<Order, 'extra_fields'>)) {
        setSaving(false)
        pushToast('Zlecenie anulowane — najpierw przywróć, potem edytuj. Zmiany nie zostały zapisane.', 'error')
        return
      }

      // Zwrot przed edycją NIEpotrzebny — issue_internal_door_stock rozlicza
      // na końcu RÓŻNICĘ netto (dośle brakujące / zwróci nadmiar ZWR-em)

      // testy 27.11 (runda 3): tylko pola zmienione względem stanu z chwili otwarcia —
      // nie nadpisujemy firmy/uwag/wentylacji, które ktoś zmienił w międzyczasie
      // (ilość to suma pozycji, liczona zawsze)
      const orderPatch: Record<string, unknown> = {
        quantity: items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0),
      }
      const initRec = initialOrder as unknown as Record<string, unknown>
      if (companyName.trim() !== String(initialOrder.company ?? '').trim()) orderPatch.company = companyName.trim()
      if (notes.trim() !== String(initialOrder.notes ?? '').trim()) orderPatch.notes = notes.trim()
      if (wentylacja.trim() !== String(initRec.wentylacja ?? '').trim()) orderPatch.wentylacja = wentylacja.trim()
      const { error } = await supabase.from('orders').update(orderPatch).eq('id', orderId)
      if (error) {
        setSaving(false)
        pushToast(`Błąd zapisu zamówienia: ${error.message}`, 'error')
        return
      }

      // Kasowanie pozycji przed wstawieniem nowych — przy błędzie NIE wstawiamy
      // (inaczej pozycje by się zdublowały)
      const { error: deleteErr } = await supabase.from('order_internal_door_items').delete().eq('order_id', orderId)
      if (deleteErr) {
        setSaving(false)
        pushToast(`Błąd czyszczenia pozycji: ${deleteErr.message}`, 'error')
        return
      }
    }

    const itemsPayload = items.map((it) => ({
      order_id: orderId,
      component_id: it.component_id,
      quantity: it.quantity,
      shorten_enabled: it.shorten_enabled,
      shorten_target_height: it.shorten_enabled ? it.shorten_target_height : null,
      notes: it.notes,
    }))

    const { error: itemsErr } = await supabase.from('order_internal_door_items').insert(itemsPayload)

    if (itemsErr) {
      // Nie zostawiaj sieroty: świeżo utworzone zamówienie bez pozycji usuwamy,
      // przy edycji rozliczamy stan do aktualnych (pustych) pozycji
      if (createdNewOrder) {
        await supabase.from('orders').delete().eq('id', orderId)
        pushToast(`Błąd zapisu pozycji: ${itemsErr.message}. Zamówienie nie zostało utworzone.`, 'error')
      } else {
        await supabase.rpc('issue_internal_door_stock', { p_order_id: orderId })
        pushToast(
          `Błąd zapisu pozycji: ${itemsErr.message}. Pozycje NIE zapisały się — stan zwrócony, uzupełnij pozycje ponownie.`,
          'error',
        )
      }
      setSaving(false)
      return
    }

    // Atomowe wydanie z magazynu wewnętrznego po stronie bazy — jedna
    // transakcja (upsert), zero wyścigów odczyt-zapis; po edycji rozlicza
    // tylko różnicę względem już wydanego
    const { error: issueErr } = await supabase.rpc('issue_internal_door_stock', { p_order_id: orderId })
    if (issueErr) {
      pushToast(`Ostrzeżenie: wydanie z magazynu nie powiodło się: ${issueErr.message}`, 'error')
    }

    setSaving(false)
    onSaved()
    onClose()
  }

  // Wrapper — blokuje równoległe wywołania (double-click „Zapisz")
  const handleSave = async () => {
    if (savingRef.current) return
    savingRef.current = true
    try {
      await handleSaveImpl()
    } finally {
      savingRef.current = false
    }
  }

  if (!open) return null

  return createPortal(
    <div className="modal-overlay" onClick={() => void requestClose()}>
      <div
        className="order-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 900, maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div className="order-modal-header">
          <h2>{mode === 'create' ? 'Nowe zamówienie - Drzwi wewnętrzne' : fromOptima ? `Edytuj zlecenie ${initialOrder?.order_number ?? ''}` : 'Edytuj zamówienie'}</h2>
          <button className="btn btn-icon btn-ghost" onClick={() => void requestClose()}>
            x
          </button>
        </div>
        {fromOptima && <div className="optima-readonly-hint">🔒 Firma, opis i pozycje przychodzą z Optimy — {lowerFirst(OPTIMA_READONLY_HINT)}.</div>}
        <div className="order-form-grid">
          <label className="order-field-full" title={fromOptima ? OPTIMA_READONLY_HINT : undefined}>
            <span className="order-field-label-text">Firma{fromOptima ? ' (z Optimy)' : ''}</span>
            <input
              type="text"
              list="companies-list"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Nazwa firmy lub klienta"
              readOnly={fromOptima}
              disabled={fromOptima}
            />
            <datalist id="companies-list">
              {companies.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>

          <label className="order-field-full">
            <span className="order-field-label-text">Wentylacja</span>
            <select value={wentylacja} onChange={(e) => setWentylacja(e.target.value)}>
              <option value="">— brak —</option>
              {wentylacjaOptions.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
              {wentylacja && !wentylacjaOptions.includes(wentylacja) && (
                <option value={wentylacja}>{wentylacja}</option>
              )}
            </select>
          </label>

          <label className="order-field-full" title={fromOptima ? OPTIMA_READONLY_HINT : undefined}>
            <span className="order-field-label-text">{fromOptima ? 'Opis RO (z Optimy)' : 'Uwagi'}</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} readOnly={fromOptima} disabled={fromOptima} />
          </label>
        </div>

        {fromOptima ? (
          <div className="internal-door-items-section" title={OPTIMA_READONLY_HINT}>
            <h3 style={{ marginTop: 20, marginBottom: 8 }}>Pozycje (z Optimy)</h3>
            <ul className="optima-items-readonly">
              {(initialItems ?? []).map((it) => (
                <li key={pickKey(it)} className={isKitPart(it) ? 'optima-item--kit-part' : undefined}>
                  {isKitPart(it) && <span className="optima-kit-arrow" aria-hidden>↳</span>}
                  <span className="optima-code">{it.optima_code || '—'}</span> {it.optima_name || it.component_name || '—'} —{' '}
                  {it.quantity} {it.unit || 'szt.'}
                  {isKitPart(it) && <span className="optima-kit-badge">część kompletu</span>}
                  {it.component_id == null && <span className="optima-unmapped-badge" style={{ marginLeft: 6 }}>⚠ brak komponentu</span>}
                </li>
              ))}
            </ul>
            <p className="muted">Pozycje dodajesz i usuwasz w Optimie. Komponent magazynu przypinasz w szczegółach zlecenia („Powiąż z komponentem”).</p>
          </div>
        ) : (
        <div className="internal-door-items-section">
          <h3 style={{ marginTop: 20, marginBottom: 8 }}>Pozycje</h3>

          {items.length === 0 && (
            <p style={{ color: '#6b7280', fontStyle: 'italic' }}>
              Brak pozycji. Kliknij "+ Dodaj pozycję" aby dodać.
            </p>
          )}

          <div className="internal-door-items-list">
            {items.map((it, idx) => {
              const stock = it.component_id ? stocks[it.component_id] ?? 0 : 0
              const insufficient = Boolean(it.component_id) && stock < it.quantity
              const isWing = it.component?.product_category === 'door_wing'

              return (
                <div key={idx} className="internal-door-item-row">
                  <div className="internal-door-item-main">
                    <select
                      value={it.component_id ?? ''}
                      onChange={(e) => onSelectComponent(idx, Number(e.target.value))}
                      style={{ flex: 1 }}
                    >
                      <option value="">- wybierz pozycję -</option>
                      {internalDoorComponents.map((c) => (
                        <option key={c.id} value={c.id}>
                          {componentLabel(c)}
                        </option>
                      ))}
                    </select>

                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={Number.isNaN(it.quantity) ? '' : it.quantity}
                      onChange={(e) =>
                        updateItem(idx, { quantity: e.target.value === '' ? Number.NaN : Number(e.target.value) })
                      }
                      style={{ width: 70 }}
                    />
                    <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>szt.</span>

                    <button type="button" onClick={() => removeItem(idx)} className="btn btn-icon btn-danger">
                      x
                    </button>
                  </div>

                  {it.component_id && (
                    <div className="internal-door-item-meta">
                      <span>
                        Stan: <strong>{stock}</strong>
                        {insufficient && (
                          <span className="internal-door-item-warning">
                            ! brak na magazynie ({it.quantity - stock} brakuje)
                          </span>
                        )}
                      </span>
                    </div>
                  )}

                  {isWing && (
                    <div className="internal-door-item-shorten">
                      <label>
                        <input
                          type="checkbox"
                          checked={it.shorten_enabled}
                          onChange={(e) =>
                            updateItem(idx, {
                              shorten_enabled: e.target.checked,
                              shorten_target_height: e.target.checked ? it.shorten_target_height : null,
                            })
                          }
                        />
                        <span style={{ marginLeft: 6 }}>Skróć drzwi</span>
                      </label>
                      {it.shorten_enabled && (
                        <label style={{ marginLeft: 12 }}>
                          Wysokość docelowa (mm):
                          <input
                            type="number"
                            min={500}
                            max={3000}
                            value={it.shorten_target_height ?? ''}
                            onChange={(e) =>
                              updateItem(idx, {
                                shorten_target_height: Number(e.target.value) || null,
                              })
                            }
                            style={{ width: 80, marginLeft: 6 }}
                          />
                        </label>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <button type="button" className="btn btn-sm btn-primary" onClick={addItem} style={{ marginTop: 8 }}>
            + Dodaj pozycję
          </button>
        </div>
        )}
        <div className="order-form-actions" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void requestClose()}
            disabled={saving}
          >
            Anuluj
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default InternalDoorOrderModal
