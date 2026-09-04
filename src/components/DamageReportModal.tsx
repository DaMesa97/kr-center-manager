import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../supabaseClient'
import SearchableSelect from './SearchableSelect'
import type { ToastVariant } from '../types'

type ComponentOption = { id: number; code: string; name: string; unit: string }
type WarehouseOption = { id: number; code: string; name: string }
/** komponent z rezerwacji zamówienia — wybór ustawia też magazyn */
type OrderComponentOption = {
  component_id: number
  warehouse_id: number
  code: string
  name: string
  unit: string
  warehouse_code: string
}

type Props = {
  open: boolean
  onClose: () => void
  pushToast: (msg: string, variant: ToastVariant) => void
  /** po udanym zgłoszeniu (np. odświeżenie stanów) */
  onReported?: () => void
  /** kontekst produkcyjny — uszkodzenie przy zamówieniu/etapie */
  orderId?: number | null
  orderNumber?: string | null
  stageKey?: string | null
  stageLabel?: string | null
  /** gdy etap nie jest z góry znany (wejście ze szczegółów zamówienia) —
   *  lista etapów kategorii do opcjonalnego wyboru */
  stageOptions?: Array<{ key: string; label: string }>

  /** preselekcja (np. wejście ze Stanów) */
  defaultComponentId?: number | null
  defaultWarehouseId?: number | null
}

/**
 * Zgłoszenie zniszczenia komponentu ("drugi gatunek").
 * Zdejmuje z półki podaną ilość ruchem ZN i zapisuje raport z powodem.
 * Samowystarczalny — sam dociąga listy komponentów i magazynów.
 */
export default function DamageReportModal({
  open,
  onClose,
  pushToast,
  onReported,
  orderId = null,
  orderNumber = null,
  stageKey = null,
  stageLabel = null,
  stageOptions,
  defaultComponentId = null,
  defaultWarehouseId = null,
}: Props) {
  const [selectedStage, setSelectedStage] = useState<string>('')
  const [components, setComponents] = useState<ComponentOption[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([])
  const [orderComponents, setOrderComponents] = useState<OrderComponentOption[]>([])
  const [componentId, setComponentId] = useState<number | null>(defaultComponentId)
  const [warehouseId, setWarehouseId] = useState<number | null>(defaultWarehouseId)
  const [quantity, setQuantity] = useState('1')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setComponentId(defaultComponentId)
    setWarehouseId(defaultWarehouseId)
    setQuantity('1')
    setReason('')
    setSelectedStage('')
    setOrderComponents([])
    void (async () => {
      const { data: whData } = await supabase
        .from('warehouses')
        .select('id, code, name')
        .eq('is_active', true)
        .order('code')
      setWarehouses((whData ?? []) as WarehouseOption[])

      // Kontekst zamówienia: TYLKO komponenty z jego rezerwacji (to, co
      // faktycznie idzie na te drzwi) — wybór ustawia też magazyn.
      if (orderId != null) {
        const { data: resData } = await supabase
          .from('stock_reservations')
          .select('component_id, warehouse_id, warehouse_components(code, name, unit), warehouses(code)')
          .eq('order_id', orderId)
          .neq('status', 'cancelled')
        const seen = new Set<string>()
        const opts: OrderComponentOption[] = []
        for (const r of (resData ?? []) as Array<Record<string, unknown>>) {
          const key = `${r.component_id}|${r.warehouse_id}`
          if (seen.has(key)) continue
          seen.add(key)
          const wc = r.warehouse_components as { code?: string; name?: string; unit?: string } | { code?: string; name?: string; unit?: string }[] | null
          const wh = r.warehouses as { code?: string } | { code?: string }[] | null
          const c = Array.isArray(wc) ? wc[0] : wc
          const w = Array.isArray(wh) ? wh[0] : wh
          opts.push({
            component_id: r.component_id as number,
            warehouse_id: r.warehouse_id as number,
            code: c?.code ?? '',
            name: c?.name ?? `#${r.component_id}`,
            unit: c?.unit ?? '',
            warehouse_code: w?.code ?? '',
          })
        }
        opts.sort((a, b) => a.name.localeCompare(b.name, 'pl'))
        setOrderComponents(opts)
        if (opts.length > 0) return // pełna lista niepotrzebna
      }

      // Bez kontekstu zamówienia (albo zamówienie bez rezerwacji): pełna
      // lista komponentów paczkami (limit 1000 PostgREST)
      const all: ComponentOption[] = []
      let from = 0
      const PAGE = 1000
      while (true) {
        const { data, error } = await supabase
          .from('warehouse_components')
          .select('id, code, name, unit')
          .eq('is_active', true)
          .order('name')
          .range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        all.push(...(data as ComponentOption[]))
        if (data.length < PAGE) break
        from += PAGE
      }
      setComponents(all)
    })()
  }, [open, defaultComponentId, defaultWarehouseId, orderId])

  const orderMode = orderComponents.length > 0

  const componentOptions = useMemo(() => {
    if (orderMode) return orderComponents.map((c) => `${c.name} (${c.code}) · mag. ${c.warehouse_code}`)
    return components.map((c) => `${c.code} — ${c.name} (${c.unit})`)
  }, [orderMode, orderComponents, components])

  const optionToOrderComp = useMemo(() => {
    const m = new Map<string, OrderComponentOption>()
    orderComponents.forEach((c) => m.set(`${c.name} (${c.code}) · mag. ${c.warehouse_code}`, c))
    return m
  }, [orderComponents])

  const optionToId = useMemo(() => {
    const m = new Map<string, number>()
    components.forEach((c) => m.set(`${c.code} — ${c.name} (${c.unit})`, c.id))
    return m
  }, [components])
  const idToOption = useMemo(() => {
    const m = new Map<number, string>()
    if (orderMode) {
      orderComponents.forEach((c) => m.set(c.component_id, `${c.name} (${c.code}) · mag. ${c.warehouse_code}`))
      return m
    }
    components.forEach((c) => m.set(c.id, `${c.code} — ${c.name} (${c.unit})`))
    return m
  }, [orderMode, orderComponents, components])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  if (!open) return null

  const qtyNum = Number(quantity.replace(',', '.'))
  const canSave =
    componentId != null && warehouseId != null && qtyNum > 0 && reason.trim().length >= 3 && !saving

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    const { error } = await supabase.rpc('report_damage', {
      p_component_id: componentId,
      p_warehouse_id: warehouseId,
      p_quantity: qtyNum,
      p_reason: reason.trim(),
      p_order_id: orderId,
      p_stage_key: stageKey ?? (selectedStage || null),
    })
    setSaving(false)
    if (error) {
      pushToast(`Błąd zgłoszenia: ${error.message}`, 'error')
      return
    }
    pushToast('Zniszczenie zgłoszone — zdjęto z magazynu', 'success')
    onReported?.()
    onClose()
  }

  return createPortal(
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={() => {
        if (!saving) onClose()
      }}
    >
      <div className="order-modal order-modal--config-option" onClick={(e) => e.stopPropagation()}>
        <div className="order-modal-header">
          <h2>⚠️ Zgłoś zniszczenie</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={saving}>
            X
          </button>
        </div>

        {(orderNumber || stageLabel) && (
          <p style={{ margin: '4px 16px 0', fontSize: 13, color: 'var(--color-text-muted, #64748b)' }}>
            {orderNumber ? <>Zamówienie <strong>{orderNumber}</strong></> : null}
            {stageLabel ? <> · etap <strong>{stageLabel}</strong></> : null}
            {' — '}zdejmiemy z magazynu sztuki wzięte na dokończenie roboty.
          </p>
        )}

        <div className="order-form-grid order-form-grid--sta">
          <label className="order-field-full order-field-full--keep">
            <span className="order-field-label-text">
              {orderMode ? 'Komponent * (z receptury tego zamówienia)' : 'Komponent *'}
            </span>
            <SearchableSelect
              value={componentId != null ? (idToOption.get(componentId) ?? '') : ''}
              onChange={(val) => {
                if (orderMode) {
                  const oc = optionToOrderComp.get(val)
                  setComponentId(oc?.component_id ?? null)
                  setWarehouseId(oc?.warehouse_id ?? null)
                } else {
                  setComponentId(optionToId.get(val) ?? null)
                }
              }}
              options={componentOptions}
              placeholder="— wybierz zniszczony komponent —"
              disabled={saving}
            />
          </label>
          {!orderMode && (
            <label className="order-field-full">
              <span className="order-field-label-text">Magazyn *</span>
              <select
                value={warehouseId != null ? String(warehouseId) : ''}
                onChange={(e) => setWarehouseId(e.target.value === '' ? null : Number(e.target.value))}
                disabled={saving}
              >
                <option value="">— wybierz —</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={String(w.id)}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!stageKey && stageOptions && stageOptions.length > 0 && (
            <label className="order-field-full">
              <span className="order-field-label-text">Etap (opcjonalnie — gdzie doszło do uszkodzenia)</span>
              <select
                value={selectedStage}
                onChange={(e) => setSelectedStage(e.target.value)}
                disabled={saving}
              >
                <option value="">— bez etapu —</option>
                {stageOptions.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="order-field-full">
            <span className="order-field-label-text">Ilość *</span>
            <input
              type="number"
              min={0}
              step="0.001"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              disabled={saving}
            />
          </label>
          <label className="order-field-full order-field-full--keep">
            <span className="order-field-label-text">Powód * (co się stało)</span>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="np. skrzydło porysowane przy frezowaniu — drugi gatunek"
              disabled={saving}
              style={{ resize: 'vertical' }}
            />
          </label>
        </div>

        <div className="order-form-actions">
          <button type="button" className="btn btn-danger" onClick={() => void handleSave()} disabled={!canSave}>
            {saving ? 'Zgłaszanie…' : 'Zgłoś i zdejmij z magazynu'}
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={onClose} disabled={saving}>
            Anuluj
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
