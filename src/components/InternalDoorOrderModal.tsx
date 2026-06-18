import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../supabaseClient'
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
  const [items, setItems] = useState<ItemDraft[]>([])
  const [stocks, setStocks] = useState<Record<number, number>>({})
  const [saving, setSaving] = useState(false)

  const internalDoorComponents = useMemo(() => {
    return components.filter((c) => c.is_active && c.product_category !== 'raw')
  }, [components])

  useEffect(() => {
    if (!open) return
    if (mode === 'edit' && initialOrder) {
      setCompanyName(initialOrder.company ?? '')
      setNotes(initialOrder.notes ?? '')
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
      setItems([])
    }
  }, [open, mode, initialOrder, initialItems, components])

  const fetchStocksFor = useCallback(async (componentIds: number[]) => {
    if (componentIds.length === 0) return
    const { data, error } = await supabase
      .from('warehouse_stock')
      .select('component_id, quantity')
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

  const fetchNextInternalDoorOrderNumber = useCallback(async (): Promise<string> => {
    const { data, error } = await supabase
      .from('orders')
      .select('order_number')
      .eq('category', 'DrzwiWewnetrzne')
    if (error) {
      console.error(error)
      return '1'
    }
    const numbers = (data ?? [])
      .map((row) => Number((row as { order_number?: string | null }).order_number ?? 0))
      .filter((n) => Number.isFinite(n))
    const max = numbers.length > 0 ? Math.max(...numbers) : 0
    return String(max + 1)
  }, [])

  const savingRef = useRef(false)

  const handleSaveImpl = async () => {
    if (items.length === 0) {
      pushToast('Dodaj co najmniej jedną pozycję', 'error')
      return
    }
    if (items.some((it) => !it.component_id)) {
      pushToast('Każda pozycja musi mieć wybrany komponent', 'error')
      return
    }
    if (items.some((it) => !Number.isFinite(it.quantity) || it.quantity <= 0)) {
      pushToast('Każda pozycja musi mieć poprawną ilość > 0', 'error')
      return
    }
    if (items.some((it) => it.shorten_enabled && (!Number.isFinite(it.shorten_target_height) || (it.shorten_target_height ?? 0) <= 0))) {
      pushToast('Skrócenie wymaga poprawnego wymiaru docelowego', 'error')
      return
    }

    setSaving(true)
    let orderId: number
    const userIdForMovement = currentUserId || (await supabase.auth.getUser()).data.user?.id || null

    if (mode === 'create') {
      const nextOrderNumber = await fetchNextInternalDoorOrderNumber()
      const { data, error } = await supabase
        .from('orders')
        .insert({
          category: 'DrzwiWewnetrzne',
          order_number: nextOrderNumber,
          company: companyName.trim(),
          notes: notes.trim(),
          entered_by: currentUserId,
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
        pushToast(`Błąd zapisu zamówienia: ${error?.message ?? 'Nieznany błąd'}`, 'error')
        return
      }
      orderId = Number((data as { id: number }).id)
    } else {
      if (!initialOrder?.id) {
        setSaving(false)
        pushToast('Brak identyfikatora zamówienia', 'error')
        return
      }
      orderId = initialOrder.id

      const { error: returnErr } = await supabase.rpc('return_stock_for_order', { p_order_id: orderId })
      if (returnErr) {
        setSaving(false)
        pushToast(`Błąd zwrotu stocku: ${returnErr.message}`, 'error')
        return
      }

      const { error } = await supabase
        .from('orders')
        .update({
          company: companyName.trim(),
          notes: notes.trim(),
          quantity: items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0),
        })
        .eq('id', orderId)
      if (error) {
        setSaving(false)
        pushToast(`Błąd zapisu zamówienia: ${error.message}`, 'error')
        return
      }

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
      setSaving(false)
      pushToast(`Błąd zapisu pozycji: ${itemsErr.message}`, 'error')
      return
    }

    const validItems = items.filter((it): it is ItemDraft & { component_id: number } => it.component_id !== null)
    for (const item of validItems) {
      const { error: movementErr } = await supabase.from('warehouse_movements').insert({
        movement_type: 'WZ',
        warehouse_from_id: 3,
        warehouse_to_id: null,
        component_id: item.component_id,
        quantity: item.quantity,
        order_id: orderId,
        reference_doc: `WZ-INTDOOR-${orderId}`,
        notes: `Rezerwacja zamówienia Drzwi wewnętrzne #${orderId}`,
        created_by: userIdForMovement,
      })
      if (movementErr) {
        pushToast(`Błąd zapisu ruchu magazynowego: ${movementErr.message}`, 'error')
      }

      const nowIso = new Date().toISOString()
      const { data: stockRow, error: stockFetchErr } = await supabase
        .from('warehouse_stock')
        .select('id, quantity')
        .eq('warehouse_id', 3)
        .eq('component_id', item.component_id)
        .maybeSingle()

      if (stockFetchErr) {
        pushToast(`Błąd odczytu stanu magazynu: ${stockFetchErr.message}`, 'error')
        continue
      }

      if (stockRow) {
        const currentQty = Number((stockRow as { quantity: number }).quantity) || 0
        const nextQty = currentQty - item.quantity
        const { error: stockUpdateErr } = await supabase
          .from('warehouse_stock')
          .update({ quantity: nextQty, updated_at: nowIso })
          .eq('id', (stockRow as { id: number }).id)
        if (stockUpdateErr) {
          pushToast(`Błąd aktualizacji stanu magazynu: ${stockUpdateErr.message}`, 'error')
        }
      } else {
        const { error: stockInsertErr } = await supabase.from('warehouse_stock').insert({
          warehouse_id: 3,
          component_id: item.component_id,
          quantity: -item.quantity,
          updated_at: nowIso,
        })
        if (stockInsertErr) {
          pushToast(`Błąd dodawania stanu magazynu: ${stockInsertErr.message}`, 'error')
        }
      }
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

  const componentLabel = (c: WarehouseComponent) => {
    const parts: string[] = [c.name]
    if (c.product_category === 'door_wing') {
      if (c.door_model) parts.push(c.door_model)
      if (c.door_size) parts.push(c.door_size)
      if (c.door_direction) parts.push(c.door_direction)
      if (c.door_color) parts.push(c.door_color)
    } else if (c.product_category === 'door_frame') {
      parts.push(c.door_frame_type === 'adjustable' ? 'regulowana' : 'prosta')
      if (c.door_frame_type === 'adjustable' && c.door_frame_code) parts.push(c.door_frame_code)
      if (c.door_size) parts.push(c.door_size)
      if (c.door_direction) parts.push(c.door_direction)
      if (c.door_color) parts.push(c.door_color)
    } else if (c.product_category === 'door_handle') {
      if (c.door_model) parts.push(c.door_model)
      if (c.door_color) parts.push(c.door_color)
      if (c.door_handle_shield) parts.push(c.door_handle_shield)
    } else if (c.product_category === 'door_hinge_cover') {
      if (c.door_color) parts.push(c.door_color)
    }
    return parts.filter(Boolean).join(' / ')
  }

  if (!open) return null

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="order-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 900, maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div className="order-modal-header">
          <h2>{mode === 'create' ? 'Nowe zamówienie - Drzwi wewnętrzne' : 'Edytuj zamówienie'}</h2>
          <button className="btn btn-icon btn-ghost" onClick={onClose}>
            x
          </button>
        </div>
        <div className="order-form-grid">
          <label className="order-field-full">
            <span className="order-field-label-text">Firma</span>
            <input
              type="text"
              list="companies-list"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Nazwa firmy lub klienta"
            />
            <datalist id="companies-list">
              {companies.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>

          <label className="order-field-full">
            <span className="order-field-label-text">Uwagi</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </label>
        </div>

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
                      value={it.quantity}
                      onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) || 1 })}
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
        <div className="order-form-actions" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
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
