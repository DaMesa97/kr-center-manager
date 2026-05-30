import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { PRODUCT_CATEGORY_LABELS } from '../../constants'
import { supabase } from '../../supabaseClient'
import type { WarehouseComponent, WarehouseMovementRow, WarehouseStockRow } from '../../types'

type Props = {
  open: boolean
  component: WarehouseComponent
  stockRows: WarehouseStockRow[]
  movements: WarehouseMovementRow[]
  onClose: () => void
  onOpenOrder?: (movement: WarehouseMovementRow) => void
}

function shortActor(value: string | null | undefined): string {
  const v = String(value ?? '').trim()
  if (!v) return '—'
  if (v.includes('@')) return v
  if (v.length <= 8) return v
  return v.slice(0, 8)
}

function fmtDateTime(v: string): string {
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

function movementDirection(m: WarehouseMovementRow): string {
  if (m.movement_type === 'PZ' || m.movement_type === 'ZWR') return `→ ${m.warehouse_to_code ?? '—'}`
  if (m.movement_type === 'WZ') return `${m.warehouse_from_code ?? '—'} →`
  return `${m.warehouse_from_code ?? '—'} → ${m.warehouse_to_code ?? '—'}`
}

function movementQty(m: WarehouseMovementRow): string {
  const abs = Math.abs(Number(m.quantity) || 0)
  if (m.movement_type === 'PZ' || m.movement_type === 'ZWR') return `+${abs}`
  if (m.movement_type === 'WZ') return `-${abs}`
  return String(abs)
}

function truncateWithTitle(v: string | null | undefined, max = 60): { label: string; title?: string } {
  const raw = String(v ?? '').trim()
  if (!raw) return { label: '—' }
  if (raw.length <= max) return { label: raw }
  return { label: `${raw.slice(0, max)}…`, title: raw }
}

function ComponentHistoryModal({ open, component, stockRows, movements, onClose, onOpenOrder }: Props) {
  const [typeFilter, setTypeFilter] = useState<'all' | 'PZ' | 'WZ' | 'MM' | 'ZWR'>('all')
  const [visibleCount, setVisibleCount] = useState(50)
  const [actorMap, setActorMap] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    setTypeFilter('all')
    setVisibleCount(50)
  }, [open, component.id])

  useEffect(() => {
    if (!open) return
    const actorIds = Array.from(
      new Set(
        movements
          .map((m) => String(m.created_by ?? '').trim())
          .filter((id) => id.length > 20),
      ),
    )
    if (actorIds.length === 0) {
      setActorMap({})
      return
    }
    let alive = true
    void supabase
      .from('profiles')
      .select('id, initials, full_name')
      .in('id', actorIds)
      .then(({ data, error }) => {
        if (!alive || error) return
        const map: Record<string, string> = {}
        ;(data ?? []).forEach((row) => {
          const id = String((row as { id?: string }).id ?? '').trim()
          if (!id) return
          const initials = String((row as { initials?: string }).initials ?? '').trim()
          const fullName = String((row as { full_name?: string }).full_name ?? '').trim()
          map[id] = initials || fullName || id.slice(0, 8)
        })
        setActorMap(map)
      })
    return () => {
      alive = false
    }
  }, [open, movements])

  const stockTotal = useMemo(
    () => stockRows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0),
    [stockRows],
  )

  const counts = useMemo(
    () => ({
      all: movements.length,
      PZ: movements.filter((m) => m.movement_type === 'PZ').length,
      WZ: movements.filter((m) => m.movement_type === 'WZ').length,
      MM: movements.filter((m) => m.movement_type === 'MM').length,
      ZWR: movements.filter((m) => m.movement_type === 'ZWR').length,
    }),
    [movements],
  )

  const filteredMovements = useMemo(() => {
    const rows = typeFilter === 'all' ? movements : movements.filter((m) => m.movement_type === typeFilter)
    return [...rows].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [movements, typeFilter])

  const shownMovements = useMemo(
    () => filteredMovements.slice(0, visibleCount),
    [filteredMovements, visibleCount],
  )

  if (!open) return null

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="order-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1120 }}>
        <div className="order-modal-header">
          <h2>Historia: {component.name}</h2>
          <button className="btn btn-icon btn-ghost" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="internal-door-details-meta-info">
          kod {component.code || '—'} · {PRODUCT_CATEGORY_LABELS[component.product_category] ?? component.product_category}
        </div>

        <div className="internal-door-details-section">
          <h4>Stany magazynowe</h4>
          {stockRows.length === 0 ? (
            <div className="component-history-empty">Brak danych o stanach magazynowych</div>
          ) : (
            <>
              <div className="component-history-stock-grid">
                {stockRows.map((row) => {
                  const qty = Number(row.quantity) || 0
                  const min = component.min_stock_level ?? row.component_min_stock_level ?? null
                  const isLow = qty < 0 || (min != null && qty < min)
                  return (
                    <div key={row.id} className="component-history-stock-card">
                      <div className="component-history-stock-card-warehouse">{row.warehouse_code ?? '—'}</div>
                      <div
                        className={`component-history-stock-card-qty ${
                          isLow ? 'component-history-stock-card-qty--low' : 'component-history-stock-card-qty--ok'
                        }`}
                      >
                        {qty}
                      </div>
                      {min != null && qty < min ? <span className="subtab-badge subtab-badge--alert">POD MIN</span> : null}
                    </div>
                  )
                })}
              </div>
              <div className="internal-door-details-meta-info">Łącznie: {stockTotal}</div>
            </>
          )}
        </div>

        <div className="internal-door-details-section">
          <h4>Filtry</h4>
          <div className="alerts-filter-pills">
            {[
              { key: 'all', label: 'Wszystkie', count: counts.all },
              { key: 'PZ', label: 'PZ', count: counts.PZ },
              { key: 'WZ', label: 'WZ', count: counts.WZ },
              { key: 'MM', label: 'MM', count: counts.MM },
              { key: 'ZWR', label: 'ZWR', count: counts.ZWR },
            ].map((f) => (
              <button
                key={f.key}
                type="button"
                className={`alerts-filter-pill ${typeFilter === f.key ? 'alerts-filter-pill--active' : ''}`}
                onClick={() => setTypeFilter(f.key as typeof typeFilter)}
              >
                {f.label} ({f.count})
              </button>
            ))}
          </div>
        </div>

        <div className="internal-door-details-section">
          <h4>Ruchy</h4>
          {filteredMovements.length === 0 ? (
            <div className="component-history-empty">Brak ruchów dla tej pozycji</div>
          ) : (
            <>
              <div className="table-wrapper" style={{ maxHeight: 420, overflowY: 'auto' }}>
                <table className="component-history-table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Typ</th>
                      <th>Kierunek</th>
                      <th>Ilość</th>
                      <th>Dokument</th>
                      <th>Zamówienie</th>
                      <th>Notatka</th>
                      <th>Kto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownMovements.map((m) => {
                      const note = truncateWithTitle(m.notes, 60)
                      const actorRaw = String(m.created_by ?? '').trim()
                      const actor = actorMap[actorRaw] ?? shortActor(actorRaw)
                      return (
                        <tr key={m.id}>
                          <td>{fmtDateTime(m.created_at)}</td>
                          <td>
                            <span className={`movement-badge movement-badge--${String(m.movement_type).toLowerCase()}`}>
                              {m.movement_type}
                            </span>
                          </td>
                          <td>{movementDirection(m)}</td>
                          <td>{movementQty(m)}</td>
                          <td>{m.reference_doc || '—'}</td>
                          <td>
                            {m.order_number && onOpenOrder ? (
                              <button type="button" className="btn btn-sm btn-primary" onClick={() => onOpenOrder(m)}>
                                {m.order_number}
                              </button>
                            ) : (
                              m.order_number || '—'
                            )}
                          </td>
                          <td title={note.title}>{note.label}</td>
                          <td>{actor}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {visibleCount < filteredMovements.length ? (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  style={{ marginTop: 10 }}
                  onClick={() => setVisibleCount((v) => v + 50)}
                >
                  Pokaż więcej
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default ComponentHistoryModal
