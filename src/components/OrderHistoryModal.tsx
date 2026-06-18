import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../supabaseClient'
import type { AuditLogRow } from '../types'
import Spinner from './Spinner'

const FIELD_LABELS: Record<string, string> = {
  order_number: 'Numer zamówienia',
  category: 'Kategoria',
  company: 'Firma',
  client_order_number: 'Nr zamówienia klienta',
  system: 'System',
  model: 'Model',
  wing_color: 'Kolor skrzydła',
  frame_color: 'Kolor ościeżnicy',
  width: 'Szerokość',
  height: 'Wysokość',
  direction: 'Kierunek',
  glazing: 'Szklenie',
  decorative_panel: 'Panel dekoracyjny',
  hardware: 'Okucia',
  handle: 'Pochwyt',
  peephole: 'Wizjer',
  electric_strike: 'Elektrozaczep',
  threshold_color: 'Kolor progu',
  quantity: 'Ilość',
  notes: 'Uwagi',
  notes_internal: 'Uwagi wewnętrzne',
  order_date: 'Data zamówienia',
  release_date: 'Data wydania',
  glass_order_date: 'Data zamówienia szkła',
  glass_received_date: 'Data otrzymania szkła',
  sta_ref: 'Odnośnik STA',
  sta_sheet: 'Arkusz STA',
  st_sheet: 'Arkusz ST',
  disting_sheet: 'Arkusz Disting',
  linked_order_id: 'ID powiązanego zam.',
  stock_status: 'Status magazynu',
  stock_issues: 'Problemy magazynu',
  extra_fields: 'Pola dodatkowe',
  production_stages: 'Etapy produkcji',
  side_panel_a: 'Naświetle A',
  side_panel_b: 'Naświetle B',
  side_panel_a_glazing: 'Szklenie A',
  side_panel_b_glazing: 'Szklenie B',
  extension_a_dim: 'Dostawka A',
  extension_b_dim: 'Dostawka B',
  extension_top_dim: 'Nadstawka',
  extension_qtys: 'Ilości dostawek',
  bastion_item_number: 'Nr pozycji Bastion',
  bastion_item_name: 'Nazwa pozycji Bastion',
  bastion_width: 'Szerokość Bastion',
  bastion_height: 'Wysokość Bastion',
  bastion_depth: 'Głębokość Bastion',
  bastion_weight: 'Waga Bastion',
  bastion_label_count: 'Liczba etykiet Bastion',
  bastion_sticker: 'Naklejka Bastion',
  bastion_production_stage: 'Etap produkcji Bastion',
  bastion_comment: 'Komentarz Bastion',
  bastion_painter: 'Lakiernik Bastion',
  bastion_paint_color: 'Kolor lakieru Bastion',
  salesperson: 'Sprzedawca',
  seller_role: 'Rola sprzedającego',
  created_at: 'Data utworzenia',
  updated_at: 'Data modyfikacji',
  updated_by: 'Zmodyfikowany przez',
  id: 'ID',
}

const OPERATION_LABELS: Record<string, string> = {
  INSERT: 'Utworzono',
  UPDATE: 'Zmieniono',
  DELETE: 'Usunięto',
}

const labelFor = (field: string): string => FIELD_LABELS[field] ?? field

type Props = {
  open: boolean
  orderId: number | null
  orderNumber: string | null
  onClose: () => void
}

function formatDateTime(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function renderFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return '—'

  if (field === 'production_stages' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, string>
    const setStages = Object.entries(obj)
      .filter(([, v]) => v === 'T')
      .map(([k]) => k.toUpperCase())
    return setStages.length > 0 ? setStages.join(', ') : '(brak)'
  }

  if (field === 'stock_issues' && Array.isArray(value)) {
    return `${value.length} problem(ów)`
  }

  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2)
  }

  if (typeof value === 'string') return value

  return String(value)
}

export default function OrderHistoryModal({ open, orderId, orderNumber, onClose }: Props) {
  const [rows, setRows] = useState<AuditLogRow[]>([])
  const [loading, setLoading] = useState(false)
  const [orderCreatedAt, setOrderCreatedAt] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !orderId) {
      setRows([])
      setOrderCreatedAt(null)
      return
    }
    let cancelled = false

    const run = async () => {
      setLoading(true)
      const [{ data, error }, { data: orderData }] = await Promise.all([
        supabase
          .from('audit_log')
          .select('*')
          .eq('table_name', 'orders')
          .eq('record_id', String(orderId))
          .order('created_at', { ascending: false }),
        supabase.from('orders').select('created_at, order_date').eq('id', orderId).single(),
      ])

      if (!cancelled) {
        if (error) {
          setRows([])
        } else {
          setRows((data ?? []) as AuditLogRow[])
        }
        const createdAt =
          (orderData?.created_at as string | null | undefined) ??
          (orderData?.order_date as string | null | undefined) ??
          null
        setOrderCreatedAt(createdAt)
        setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [open, orderId])

  const timelineRows = useMemo(() => rows, [rows])
  const createdMeta = useMemo(() => {
    if (orderCreatedAt) return formatDateTime(orderCreatedAt)
    const insertRow = rows.find((r) => r.operation === 'INSERT')
    if (!insertRow) return null
    const payloadCreated = insertRow.new_data?.created_at
    if (typeof payloadCreated === 'string' && payloadCreated.trim()) {
      return formatDateTime(payloadCreated)
    }
    return formatDateTime(insertRow.created_at)
  }, [orderCreatedAt, rows])

  if (!open) return null

  return createPortal(
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div className="order-history-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="audit-details-header">
          <h2>Historia zmian zamówienia nr {orderNumber ?? '-'}</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose}>
            X
          </button>
        </div>
        <p className="audit-details-meta">Data utworzenia zamówienia: {createdMeta ?? '—'}</p>

        {loading ? (
          <Spinner center label="Ładowanie historii…" />
        ) : timelineRows.length === 0 ? (
          <p className="no-results">Brak wpisów historii dla tego zamówienia.</p>
        ) : (
          <div>
            {timelineRows.map((row) => {
              const changedFields = row.changed_fields ?? []
              const oldData = row.old_data ?? {}
              const newData = row.new_data ?? {}

              return (
                <div
                  key={row.id}
                  className={`order-history-entry order-history-entry--${row.operation.toLowerCase()}`}
                >
                  <div className="order-history-entry-header">
                    <span>{formatDateTime(row.created_at)}</span>
                    <span>{row.user_email || '(brak użytkownika)'}</span>
                    <span className={`audit-op-badge audit-op-badge--${row.operation.toLowerCase()}`}>
                      {OPERATION_LABELS[row.operation] ?? row.operation}
                    </span>
                  </div>

                  {row.operation === 'INSERT' && <div className="order-history-changes">Utworzono zamówienie</div>}
                  {row.operation === 'DELETE' && <div className="order-history-changes">Usunięto zamówienie</div>}

                  {row.operation === 'UPDATE' && (
                    <div className="order-history-changes">
                      <div>Zmienione pola:</div>
                      {changedFields.length === 0 ? (
                        <div className="order-history-change-item">Brak listy zmienionych pól</div>
                      ) : (
                        changedFields.map((field) => (
                          <div key={field} className="order-history-change-item">
                            <span className="order-history-change-field">{labelFor(field)}:</span>{' '}
                            <span className="order-history-change-old">{renderFieldValue(field, oldData[field])}</span>{' '}
                            → <span className="order-history-change-new">{renderFieldValue(field, newData[field])}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="order-form-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Zamknij
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
