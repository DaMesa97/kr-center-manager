import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../supabaseClient'

export type DocumentDetailsModalProps = {
  open: boolean
  referenceDoc: string | null
  movementType: 'PZ' | 'MM' | null
  onClose: () => void
}

type DetailRow = {
  id: number
  quantity: number
  notes: string | null
  component_code: string | null
  component_name: string | null
  component_unit: string | null
  created_at: string
  created_by: string | null
  created_by_full_name: string | null
  warehouse_from_code: string | null
  warehouse_to_code: string | null
}

function pick<T>(x: T | T[] | null | undefined): T | undefined {
  if (x == null) return undefined
  return Array.isArray(x) ? x[0] : x
}

function formatDateTime(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('pl-PL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function DocumentDetailsModal({
  open,
  referenceDoc,
  movementType,
  onClose,
}: DocumentDetailsModalProps) {
  const [rows, setRows] = useState<DetailRow[]>([])
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !referenceDoc || !movementType) {
      setRows([])
      setFetchError(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setFetchError(null)
    setRows([])

    const run = async () => {
      const selectWithProfiles = `
          *,
          warehouse_from:warehouses!warehouse_from_id(code),
          warehouse_to:warehouses!warehouse_to_id(code),
          warehouse_components(code, name, unit),
          profiles!created_by(full_name, initials)
        `
      const selectWithoutProfiles = `
          *,
          warehouse_from:warehouses!warehouse_from_id(code),
          warehouse_to:warehouses!warehouse_to_id(code),
          warehouse_components(code, name, unit)
        `

      const buildBaseQuery = (select: string) => {
        let q = supabase
          .from('warehouse_movements')
          .select(select)
          .eq('movement_type', movementType)
          .order('id', { ascending: true })
        if (referenceDoc === '(bez dokumentu)') {
          q = q.is('reference_doc', null)
        } else {
          q = q.eq('reference_doc', referenceDoc)
        }
        return q
      }

      let { data, error } = await buildBaseQuery(selectWithProfiles)
      let usedProfilesEmbed = true
      if (error) {
        const second = await buildBaseQuery(selectWithoutProfiles)
        data = second.data
        error = second.error
        usedProfilesEmbed = false
      }

      if (cancelled) return
      setLoading(false)
      if (error) {
        setFetchError(error.message)
        setRows([])
        return
      }

      const mapRows = (raw: Record<string, unknown>[], includeProfiles: boolean): DetailRow[] =>
        raw.map((r) => {
          const wf = pick(r.warehouse_from as { code?: string } | { code?: string }[] | null)
          const wt = pick(r.warehouse_to as { code?: string } | { code?: string }[] | null)
          const wc = pick(
            r.warehouse_components as
              | { code?: string; name?: string; unit?: string }
              | { code?: string; name?: string; unit?: string }[]
              | null,
          )
          const prof = includeProfiles
            ? pick(
                r.profiles as
                  | { full_name?: string | null; initials?: string | null }
                  | { full_name?: string | null; initials?: string | null }[]
                  | null,
              )
            : undefined
          const createdBy = (r.created_by as string | null) ?? null
          const fromJoin = prof?.full_name?.trim() ? prof.full_name : null
          return {
            id: r.id as number,
            quantity: Number(r.quantity),
            notes: (r.notes as string | null) ?? null,
            component_code: wc?.code ?? null,
            component_name: wc?.name ?? null,
            component_unit: wc?.unit ?? null,
            created_at: String(r.created_at ?? ''),
            created_by: createdBy,
            created_by_full_name: fromJoin,
            warehouse_from_code: wf?.code ?? null,
            warehouse_to_code: wt?.code ?? null,
          }
        })

      const rawRows = (data ?? []) as unknown as Record<string, unknown>[]
      let mapped = mapRows(rawRows, usedProfilesEmbed)

      const firstRow = mapped[0]
      const createdByUserId = firstRow?.created_by ?? null
      if (createdByUserId && !firstRow.created_by_full_name) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('full_name, initials')
          .eq('id', createdByUserId)
          .maybeSingle()
        if (!cancelled && profileData?.full_name?.trim()) {
          const name = profileData.full_name.trim()
          mapped = mapped.map((row) =>
            row.created_by === createdByUserId ? { ...row, created_by_full_name: name } : row,
          )
        }
      }

      setRows(mapped)
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [open, referenceDoc, movementType])

  const meta = useMemo(() => {
    if (rows.length === 0) {
      return {
        createdAt: null as string | null,
        createdByName: '—',
        warehouseLine: '—',
      }
    }
    const earliest = rows.reduce((min, r) => (r.created_at < min ? r.created_at : min), rows[0].created_at)
    const first = rows[0]
    const createdByName = first.created_by_full_name ?? first.created_by ?? '—'
    let warehouseLine = '—'
    if (movementType === 'PZ') {
      warehouseLine = first.warehouse_to_code ?? '—'
    } else if (movementType === 'MM') {
      const from = first.warehouse_from_code ?? '—'
      const to = first.warehouse_to_code ?? '—'
      warehouseLine = `${from} → ${to}`
    }
    return {
      createdAt: earliest,
      createdByName,
      warehouseLine,
    }
  }, [rows, movementType])

  if (!open) return null

  const title = movementType === 'PZ' ? 'Podgląd PZ' : movementType === 'MM' ? 'Podgląd MM' : 'Podgląd dokumentu'

  return createPortal(
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="order-modal order-modal--sta recipe-editor-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="order-modal-header">
          <h2>{title}</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose}>
            X
          </button>
        </div>

        <div className="recipe-editor-modal-body">
          <div className="order-form-grid order-form-grid--sta recipe-editor-modal-form-top">
            <div className="order-field-full" style={{ gridColumn: '1 / -1', fontSize: '0.9rem', lineHeight: 1.6 }}>
              <div>
                <strong>Nr dokumentu:</strong> {referenceDoc ?? '—'}
              </div>
              <div>
                <strong>Typ:</strong> {movementType ?? '—'}
              </div>
              <div>
                <strong>Data utworzenia:</strong>{' '}
                {loading ? '…' : meta.createdAt ? formatDateTime(meta.createdAt) : '—'}
              </div>
              <div>
                <strong>Magazyn:</strong> {loading ? '…' : meta.warehouseLine}
              </div>
              <div>
                <strong>Utworzył:</strong> {loading ? '…' : meta.createdByName}
              </div>
            </div>
          </div>

          {fetchError && (
            <p className="order-field-full" style={{ color: 'coral', margin: '0.5rem 1rem' }}>
              {fetchError}
            </p>
          )}

          <div className="recipe-editor-positions-section">
            <h3 className="order-field-full" style={{ margin: '0.75rem 0 0', gridColumn: '1 / -1' }}>
              Pozycje
            </h3>
            <div className="recipe-editor-positions-scroll">
              <div className="table-wrapper recipe-editor-positions-wrap">
                <table
                  className="orders-table recipe-editor-positions-table"
                  style={{ width: '100%', tableLayout: 'fixed' }}
                >
                  <thead>
                    <tr>
                      <th>KOD</th>
                      <th>NAZWA</th>
                      <th>JEDNOSTKA</th>
                      <th>ILOŚĆ</th>
                      <th>UWAGI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: '1rem' }}>
                          Ładowanie…
                        </td>
                      </tr>
                    ) : rows.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: '1rem' }}>
                          Brak pozycji
                        </td>
                      </tr>
                    ) : (
                      rows.map((r) => (
                        <tr key={r.id}>
                          <td>{r.component_code ?? '—'}</td>
                          <td>{r.component_name ?? '—'}</td>
                          <td>{r.component_unit ?? '—'}</td>
                          <td>{r.quantity}</td>
                          <td>{r.notes?.trim() ? r.notes : '—'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div className="order-form-actions">
          <button type="button" className="btn btn-sm btn-primary" onClick={onClose}>
            Zamknij
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
