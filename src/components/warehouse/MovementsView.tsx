import { Fragment, useMemo, useState } from 'react'
import type { Warehouse, WarehouseComponent, WarehouseMovementRow } from '../../types'
import Spinner from '../Spinner'

// Zgrupowany dokument magazynowy: wszystkie pozycje z tym samym reference_doc
// (np. zbiorcze WZ 'WZ-STA-2388-e4') zwijamy do jednego wiersza z pozycjami.
type MovementDocGroup = {
  key: string
  movement_type: WarehouseMovementRow['movement_type']
  reference_doc: string
  newest_at: string
  order_number: string
  warehouse_codes: string
  rows: WarehouseMovementRow[]
}

type MovementsViewProps = {
  movements: WarehouseMovementRow[]
  loading: boolean
  warehouses: Warehouse[]
  components: WarehouseComponent[]
}

function formatMovementDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`
}

const MOVEMENT_TYPE_DESCRIPTIONS: Record<string, string> = {
  PZ: 'PZ — Przyjęcie zewnętrzne (dostawa do magazynu)',
  WZ: 'WZ — Wydanie zewnętrzne (pobranie na zamówienie)',
  MM: 'MM — Przesunięcie międzymagazynowe',
  ZWR: 'ZWR — Zwrot (np. z anulowanego zamówienia)',
}

function formatQuantityDisplay(m: WarehouseMovementRow): string {
  const abs = Math.abs(Number(m.quantity))
  switch (m.movement_type) {
    case 'PZ':
    case 'ZWR':
      return `+${abs}`
    case 'WZ':
      return `-${abs}`
    case 'MM':
      return String(abs)
    default:
      return String(m.quantity)
  }
}

function MovementsView({ movements, loading, warehouses, components }: MovementsViewProps) {
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [warehouseIdFilter, setWarehouseIdFilter] = useState<number | ''>('')
  const [componentIdFilter, setComponentIdFilter] = useState<number | ''>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [groupDocs, setGroupDocs] = useState(true)
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null)

  const warehousesSorted = useMemo(
    () => [...warehouses].sort((a, b) => a.code.localeCompare(b.code)),
    [warehouses],
  )

  const componentsSorted = useMemo(
    () => [...components].sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '')),
    [components],
  )

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null

    return movements.filter((row) => {
      if (typeFilter !== '' && row.movement_type !== typeFilter) return false
      if (warehouseIdFilter !== '') {
        const wid = warehouseIdFilter as number
        if (row.warehouse_from_id !== wid && row.warehouse_to_id !== wid) return false
      }
      if (componentIdFilter !== '' && row.component_id !== componentIdFilter) return false

      const rowMs = new Date(row.created_at).getTime()
      if (fromMs !== null && rowMs < fromMs) return false
      if (toMs !== null && rowMs > toMs) return false

      if (!q) return true
      const code = (row.component_code ?? '').toLowerCase()
      const name = (row.component_name ?? '').toLowerCase()
      const ord = (row.order_number ?? '').toLowerCase()
      const ref = (row.reference_doc ?? '').toLowerCase()
      return code.includes(q) || name.includes(q) || ord.includes(q) || ref.includes(q)
    })
  }, [movements, typeFilter, warehouseIdFilter, componentIdFilter, dateFrom, dateTo, search])

  const sortedFiltered = useMemo(
    () =>
      [...filteredRows].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [filteredRows],
  )

  // Grupowanie w dokumenty: wiersze dzielące (typ, reference_doc) → jeden
  // wiersz dokumentu; ruchy bez dokumentu zostają pojedynczo (grupa 1-elementowa).
  const docGroups = useMemo((): MovementDocGroup[] => {
    if (!groupDocs) return []
    const byKey = new Map<string, MovementDocGroup>()
    const order: string[] = []
    for (const row of sortedFiltered) {
      const ref = (row.reference_doc ?? '').trim()
      const key = ref ? `${row.movement_type}|${ref}` : `single|${row.id}`
      let g = byKey.get(key)
      if (!g) {
        g = {
          key,
          movement_type: row.movement_type,
          reference_doc: ref,
          newest_at: row.created_at,
          order_number: row.order_number ?? '',
          warehouse_codes: '',
          rows: [],
        }
        byKey.set(key, g)
        order.push(key)
      }
      g.rows.push(row)
      if (row.created_at > g.newest_at) g.newest_at = row.created_at
      if (!g.order_number && row.order_number) g.order_number = row.order_number
    }
    for (const g of byKey.values()) {
      const codes = new Set<string>()
      g.rows.forEach((r) => {
        if (r.warehouse_from_code) codes.add(r.warehouse_from_code)
        if (r.warehouse_to_code) codes.add(r.warehouse_to_code)
      })
      g.warehouse_codes = Array.from(codes).sort().join(', ')
    }
    return order.map((k) => byKey.get(k)!)
  }, [sortedFiltered, groupDocs])

  return (
    <div className="movements-view">
      <div className="movements-view-filters">
        <label className="movements-view-filter">
          <span className="movements-view-filter-label">Typ ruchu</span>
          <select
            className="day-filter"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">Wszystkie</option>
            <option value="PZ">PZ</option>
            <option value="WZ">WZ</option>
            <option value="MM">MM</option>
            <option value="ZWR">ZWR</option>
          </select>
        </label>
        <label className="movements-view-filter">
          <span className="movements-view-filter-label">Magazyn</span>
          <select
            className="day-filter"
            value={warehouseIdFilter === '' ? '' : String(warehouseIdFilter)}
            onChange={(e) => {
              const v = e.target.value
              setWarehouseIdFilter(v === '' ? '' : Number(v))
            }}
          >
            <option value="">Wszystkie</option>
            {warehousesSorted.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code}
              </option>
            ))}
          </select>
        </label>
        <label className="movements-view-filter">
          <span className="movements-view-filter-label">Komponent</span>
          <select
            className="day-filter"
            value={componentIdFilter === '' ? '' : String(componentIdFilter)}
            onChange={(e) => {
              const v = e.target.value
              setComponentIdFilter(v === '' ? '' : Number(v))
            }}
          >
            <option value="">Wszystkie</option>
            {componentsSorted.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="movements-view-filter">
          <span className="movements-view-filter-label">Od</span>
          <input
            type="date"
            className="search-input"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        <label className="movements-view-filter">
          <span className="movements-view-filter-label">Do</span>
          <input
            type="date"
            className="search-input"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>
        <label className="movements-view-filter movements-view-filter--grow">
          <span className="movements-view-filter-label">Szukaj</span>
          <input
            type="text"
            className="search-input"
            placeholder="Kod/nazwa komponentu, zamówienie, dokument…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label
          className="movements-view-filter"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-end' }}
          title="Pozycje jednego dokumentu (np. zbiorczego WZ na zamówienie×etap) zwinięte do jednego wiersza"
        >
          <input type="checkbox" checked={groupDocs} onChange={(e) => setGroupDocs(e.target.checked)} />
          <span>Grupuj dokumenty</span>
        </label>
      </div>

      {loading ? (
        <Spinner center label="Ładowanie…" />
      ) : (
        <div className="table-wrapper">
          <table className="orders-table movements-view-table">
            <thead>
              <tr>
                <th>DATA</th>
                <th>TYP</th>
                <th>KOMPONENT</th>
                <th>ILOŚĆ</th>
                <th>MAGAZYN Z</th>
                <th>MAGAZYN DO</th>
                <th>ZAMÓWIENIE</th>
                <th>DOKUMENT</th>
                <th>UWAGI</th>
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="movements-view-empty">
                    Brak ruchów do wyświetlenia.
                  </td>
                </tr>
              ) : groupDocs ? (
                docGroups.map((g) => {
                  const single = g.rows.length === 1 ? g.rows[0] : null
                  if (single) {
                    const compLabel = single.component_code || single.component_name
                      ? `${single.component_code ?? '—'} — ${single.component_name ?? ''} (${single.component_unit ?? ''})`
                      : '—'
                    return (
                      <tr key={g.key}>
                        <td>{formatMovementDate(single.created_at)}</td>
                        <td>
                          <span
                            className={`movement-type-badge movement-type-badge--${String(single.movement_type).toLowerCase()}`}
                            title={MOVEMENT_TYPE_DESCRIPTIONS[single.movement_type] ?? single.movement_type}
                          >
                            {single.movement_type}
                          </span>
                        </td>
                        <td title={compLabel}>{compLabel}</td>
                        <td>{formatQuantityDisplay(single)}</td>
                        <td>{single.warehouse_from_code ?? ''}</td>
                        <td>{single.warehouse_to_code ?? ''}</td>
                        <td>{single.order_number ?? ''}</td>
                        <td>{single.reference_doc ?? ''}</td>
                        <td>{single.notes ?? ''}</td>
                      </tr>
                    )
                  }
                  const expanded = expandedDoc === g.key
                  return (
                    <Fragment key={g.key}>
                      <tr
                        className="movements-doc-row"
                        style={{ cursor: 'pointer' }}
                        onClick={() => setExpandedDoc(expanded ? null : g.key)}
                        title="Kliknij, aby rozwinąć pozycje dokumentu"
                      >
                        <td>{formatMovementDate(g.newest_at)}</td>
                        <td>
                          <span
                            className={`movement-type-badge movement-type-badge--${String(g.movement_type).toLowerCase()}`}
                            title={MOVEMENT_TYPE_DESCRIPTIONS[g.movement_type] ?? g.movement_type}
                          >
                            {g.movement_type}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 600 }}>
                            {expanded ? '▾' : '▸'} {g.rows.length} pozycji
                          </span>
                        </td>
                        <td>—</td>
                        <td colSpan={2}>{g.warehouse_codes}</td>
                        <td>{g.order_number}</td>
                        <td>{g.reference_doc}</td>
                        <td></td>
                      </tr>
                      {expanded &&
                        g.rows.map((row) => {
                          const compLabel = row.component_code || row.component_name
                            ? `${row.component_code ?? '—'} — ${row.component_name ?? ''} (${row.component_unit ?? ''})`
                            : '—'
                          return (
                            <tr key={row.id} className="movements-doc-item-row" style={{ background: 'var(--color-bg-muted, #f8fafc)' }}>
                              <td style={{ paddingLeft: 24, fontSize: '0.82rem', color: '#64748b' }}>
                                {formatMovementDate(row.created_at)}
                              </td>
                              <td></td>
                              <td title={compLabel}>{compLabel}</td>
                              <td>{formatQuantityDisplay(row)}</td>
                              <td>{row.warehouse_from_code ?? ''}</td>
                              <td>{row.warehouse_to_code ?? ''}</td>
                              <td></td>
                              <td></td>
                              <td>{row.notes ?? ''}</td>
                            </tr>
                          )
                        })}
                    </Fragment>
                  )
                })
              ) : (
                sortedFiltered.map((row) => {
                  const compLabel = [row.component_code, row.component_name, row.component_unit]
                    .filter(Boolean)
                    .length
                    ? `${row.component_code ?? '—'} — ${row.component_name ?? ''} (${row.component_unit ?? ''})`
                    : '—'
                  return (
                    <tr key={row.id}>
                      <td>{formatMovementDate(row.created_at)}</td>
                      <td>
                        <span
                          className={`movement-type-badge movement-type-badge--${String(row.movement_type).toLowerCase()}`}
                          title={MOVEMENT_TYPE_DESCRIPTIONS[row.movement_type] ?? row.movement_type}
                        >
                          {row.movement_type}
                        </span>
                      </td>
                      <td title={compLabel}>{compLabel}</td>
                      <td>{formatQuantityDisplay(row)}</td>
                      <td>{row.warehouse_from_code ?? ''}</td>
                      <td>{row.warehouse_to_code ?? ''}</td>
                      <td>{row.order_number ?? ''}</td>
                      <td>{row.reference_doc ?? ''}</td>
                      <td>{row.notes ?? ''}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default MovementsView
