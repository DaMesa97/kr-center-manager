import { useMemo, useState, type ReactNode } from 'react'
import type { Warehouse, WarehouseComponent, WarehouseMovementRow } from '../../types'
import Spinner from '../Spinner'
import DataTable, { type DataTableColumn } from '../DataTable'

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

// Wiersz tabeli ruchów: pojedynczy ruch albo zgrupowany dokument (renderRow)
type MovementTableRow =
  | { kind: 'single'; key: string | number; row: WarehouseMovementRow; compLabel: string }
  | { kind: 'doc'; g: MovementDocGroup }

type MovementsViewProps = {
  movements: WarehouseMovementRow[]
  loading: boolean
  /** lista = ostatnie N ruchów, są starsze */
  truncated?: boolean
  onLoadMore?: () => void
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
  INW: 'INW — Korekta inwentaryzacyjna (spis z natury)',
  ZN: 'ZN — Zniszczenie / drugi gatunek',
}

function formatQuantityDisplay(m: WarehouseMovementRow): string {
  const abs = Math.abs(Number(m.quantity))
  switch (m.movement_type) {
    case 'PZ':
    case 'ZWR':
      return `+${abs}`
    case 'WZ':
    case 'ZN':
      return `-${abs}`
    case 'MM':
      return String(abs)
    case 'INW':
      // kierunek korekty po magazynie: do = nadwyżka, z = niedobór
      return m.warehouse_to_id != null ? `+${abs}` : `-${abs}`
    default:
      return String(m.quantity)
  }
}

const renderTypeBadge = (type: WarehouseMovementRow['movement_type']) => (
  <span
    className={`movement-type-badge movement-type-badge--${String(type).toLowerCase()}`}
    title={MOVEMENT_TYPE_DESCRIPTIONS[type] ?? type}
  >
    {type}
  </span>
)

// Etykieta komponentu w widoku zgrupowanym (jest kod lub nazwa)
const componentLabelGrouped = (row: WarehouseMovementRow): string =>
  row.component_code || row.component_name
    ? `${row.component_code ?? '—'} — ${row.component_name ?? ''} (${row.component_unit ?? ''})`
    : '—'

// Etykieta komponentu w widoku płaskim (jest kod, nazwa lub jednostka)
const componentLabelFlat = (row: WarehouseMovementRow): string =>
  [row.component_code, row.component_name, row.component_unit].filter(Boolean).length
    ? `${row.component_code ?? '—'} — ${row.component_name ?? ''} (${row.component_unit ?? ''})`
    : '—'

function MovementsView({ movements, loading, truncated, onLoadMore, warehouses, components }: MovementsViewProps) {
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

  // Wiersze tabeli: pojedyncze ruchy (zwykły wiersz z kolumn) albo zgrupowane
  // dokumenty (własny wiersz przez renderRow — MAGAZYN Z/DO scalone w jedną komórkę).
  const tableRows = useMemo((): MovementTableRow[] => {
    if (!groupDocs) {
      return sortedFiltered.map((row) => ({ kind: 'single', key: row.id, row, compLabel: componentLabelFlat(row) }))
    }
    return docGroups.map((g): MovementTableRow =>
      g.rows.length === 1
        ? { kind: 'single', key: g.key, row: g.rows[0], compLabel: componentLabelGrouped(g.rows[0]) }
        : { kind: 'doc', g },
    )
  }, [groupDocs, sortedFiltered, docGroups])

  // Bez sortowania po nagłówkach — kolejność (od najnowszych) wyznacza grupowanie.
  // Kolumny renderują tylko pojedyncze ruchy; dokumenty idą przez renderRow.
  const single = (render: (r: Extract<MovementTableRow, { kind: 'single' }>) => ReactNode) =>
    (r: MovementTableRow) => (r.kind === 'single' ? render(r) : null)
  const columns: DataTableColumn<MovementTableRow>[] = [
    { key: 'date', label: 'DATA', render: single((r) => formatMovementDate(r.row.created_at)) },
    { key: 'type', label: 'TYP', render: single((r) => renderTypeBadge(r.row.movement_type)) },
    {
      key: 'component',
      label: 'KOMPONENT',
      render: single((r) => r.compLabel),
      tdTitle: (r) => (r.kind === 'single' ? r.compLabel : undefined),
    },
    { key: 'qty', label: 'ILOŚĆ', render: single((r) => formatQuantityDisplay(r.row)) },
    { key: 'from', label: 'MAGAZYN Z', render: single((r) => r.row.warehouse_from_code ?? '') },
    { key: 'to', label: 'MAGAZYN DO', render: single((r) => r.row.warehouse_to_code ?? '') },
    { key: 'order', label: 'ZAMÓWIENIE', render: single((r) => r.row.order_number ?? '') },
    { key: 'doc', label: 'DOKUMENT', render: single((r) => r.row.reference_doc ?? '') },
    { key: 'notes', label: 'UWAGI', render: single((r) => r.row.notes ?? '') },
  ]

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
            <option value="INW">INW (korekty spisu)</option>
            <option value="ZN">ZN (zniszczenia)</option>
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
        <DataTable
          rows={tableRows}
          columns={columns}
          rowKey={(r) => (r.kind === 'doc' ? r.g.key : r.key)}
          className="movements-view-table"
          emptyText="Brak ruchów do wyświetlenia."
          renderRow={(r) => {
            if (r.kind !== 'doc') return undefined
            const g = r.g
            const expanded = expandedDoc === g.key
            return (
              <tr
                className="movements-doc-row"
                style={{ cursor: 'pointer' }}
                onClick={() => setExpandedDoc(expanded ? null : g.key)}
                title="Kliknij, aby rozwinąć pozycje dokumentu"
              >
                <td>{formatMovementDate(g.newest_at)}</td>
                <td>{renderTypeBadge(g.movement_type)}</td>
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
            )
          }}
          renderAfterRow={(r) => {
            if (r.kind !== 'doc' || expandedDoc !== r.g.key) return null
            return r.g.rows.map((row) => {
              const compLabel = componentLabelGrouped(row)
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
            })
          }}
        />
      )}
      {!loading && truncated && (
        <div className="muted" style={{ padding: '8px 4px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>
            Pokazuję {movements.length} ostatnich ruchów — starsze nie są wczytane (filtry szukają tylko w tej porcji;
            pełna historia komponentu: ikona 🕘 w Stanach).
          </span>
          {onLoadMore && (
            <button type="button" className="btn btn-sm" onClick={onLoadMore}>
              Wczytaj starsze
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default MovementsView
