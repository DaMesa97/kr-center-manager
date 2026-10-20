// =====================================================================
// DataTable — JEDEN komponent tabeli dla całej apki.
// Daje za darmo: wrapper z górnym paskiem przewijania, sortowanie po
// kliknięciu nagłówka (kolumny z `sortValue`), resize kolumn przeciąganiem
// krawędzi nagłówka (lib/columnResize), pusty stan i style .orders-table.
//
// Użycie:
//   <DataTable
//     rows={items}
//     rowKey={(r) => r.id}
//     columns={[
//       { key: 'code', label: 'KOD', render: (r) => r.code, sortValue: (r) => r.code },
//       { key: 'qty', label: 'ILOŚĆ', render: (r) => r.qty, align: 'right' },
//     ]}
//     emptyText="Brak danych."
//   />
// =====================================================================
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type MouseEvent, type MutableRefObject, type ReactNode } from 'react'
import { TopScrollTableWrapper } from './TopScrollTableWrapper'
import { sortRows, toggleSort, type SortState } from '../lib/tableSort'
import { applySavedColumnWidths, attachColumnResize } from '../lib/columnResize'

export type DataTableColumn<T> = {
  /** Unikalny klucz kolumny (też klucz sortowania). */
  key: string
  /** Treść nagłówka. */
  label: ReactNode
  /** Tooltip nagłówka. */
  title?: string
  /** Zawartość komórki. */
  render: (row: T, index: number) => ReactNode
  /** Podanie = kolumna sortowalna (wartość do porównań, patrz lib/tableSort). */
  sortValue?: (row: T) => unknown
  align?: 'left' | 'center' | 'right'
  /** Klasa na <th> i każdym <td> kolumny. */
  className?: string
  thClassName?: string
  tdClassName?: string | ((row: T) => string | undefined)
  tdStyle?: CSSProperties | ((row: T) => CSSProperties | undefined)
  thStyle?: CSSProperties
  /** Atrybut title komórki (np. pełny tekst przy ucinaniu). */
  tdTitle?: (row: T) => string | undefined
  /** Klik w komórkę NIE odpala onRowClick (checkboxy, przyciski akcji, data wydania). */
  stopRowClick?: boolean
  /**
   * Klucz kolumny-matki: gdy tabela NIE mieści się na ekranie, ta kolumna chowa
   * się pod matką (w tej samej komórce, mniejszym tekstem). Gdy się mieści —
   * zwykła osobna kolumna. Nie łączyć z przyklejonymi kolumnami ani colgroup.
   */
  stackUnder?: string
}

type VisibleColumn<T> = { col: DataTableColumn<T>; subs: DataTableColumn<T>[] }

type Props<T> = {
  rows: T[]
  columns: DataTableColumn<T>[]
  rowKey: (row: T, index: number) => string | number
  /** Dodatkowe klasy tabeli (obok bazowej orders-table). */
  className?: string
  tableStyle?: CSSProperties
  /** Dodatkowe klasy wrappera (obok table-wrapper). */
  wrapperClassName?: string
  wrapperStyle?: CSSProperties
  /** Ref do wrappera (np. pomiar szerokości zamrożonej kolumny). */
  tableWrapperRef?: MutableRefObject<HTMLDivElement | null>
  /** false = bez wrappera/paska (np. tabela w modalu, która ma własny kontener). */
  wrapped?: boolean
  /** Opcjonalny <colgroup> (szerokości kolumn podpięte pod CSS col.*). */
  colgroup?: ReactNode
  emptyText?: ReactNode
  /** Treść zamiast wierszy, gdy loading = true. */
  loading?: boolean
  loadingText?: ReactNode
  rowClassName?: (row: T, index: number) => string | undefined
  rowStyle?: (row: T, index: number) => CSSProperties | undefined
  rowTitle?: (row: T, index: number) => string | undefined
  onRowClick?: (row: T, e: MouseEvent<HTMLTableRowElement>) => void
  /** Pozostałe atrybuty <tr> (np. draggable + onDragStart/onDragOver do zmiany kolejności). */
  rowProps?: (row: T, index: number) => HTMLAttributes<HTMLTableRowElement> | undefined
  /** Dodatkowe wiersze pod danym wierszem (rozwinięcia, szczegóły). */
  renderAfterRow?: (row: T, index: number) => ReactNode
  /**
   * Furtka na wiersze innego typu (nagłówek grupy, podsumowanie dokumentu ze
   * scalonymi komórkami): zwróć własny <tr>, a undefined = zwykły wiersz z kolumn.
   */
  renderRow?: (row: T, index: number) => ReactNode | undefined
  /** Dodatkowe wiersze nagłówka NAD wierszem kolumn (np. grupy z colSpan). */
  headerTop?: ReactNode
  /** Zawartość <tfoot> (np. sumy). */
  footer?: ReactNode
  /** Sortowanie startowe (niekontrolowane). */
  defaultSort?: SortState
  /** Sortowanie kontrolowane z zewnątrz (np. gdy widok sam musi znać kolejność). */
  sort?: SortState
  onSortChange?: (s: SortState) => void
}

export default function DataTable<T>({
  rows,
  columns,
  rowKey,
  className,
  tableStyle,
  wrapperClassName,
  wrapperStyle,
  tableWrapperRef,
  wrapped = true,
  colgroup,
  emptyText = 'Brak danych.',
  loading,
  loadingText = 'Ładowanie…',
  rowClassName,
  rowStyle,
  rowTitle,
  onRowClick,
  rowProps,
  renderAfterRow,
  renderRow,
  headerTop,
  footer,
  defaultSort = null,
  sort: sortProp,
  onSortChange,
}: Props<T>) {
  const tableRef = useRef<HTMLTableElement>(null)
  // resize kolumn: przeciąganie krawędzi nagłówka; szerokości per KLUCZ kolumny,
  // tabela rozpoznawana po kluczach WSZYSTKICH kolumn (stałe mimo piętrowania)
  const tableKey = useMemo(() => columns.map((c) => c.key).join('|'), [columns])
  const tableKeyRef = useRef(tableKey)
  tableKeyRef.current = tableKey
  useEffect(
    () => (tableRef.current ? attachColumnResize(tableRef.current, () => tableKeyRef.current) : undefined),
    [],
  )
  useLayoutEffect(() => {
    if (tableRef.current) applySavedColumnWidths(tableRef.current, tableKey)
  })

  // Piętrowanie „na miarę ekranu”: najpierw rysujemy szeroko i mierzymy; jak tabela
  // nie mieści się w kontenerze — kolumny ze stackUnder chowamy pod matki. Szerokość
  // wersji rozłożonej zapamiętana, żeby po poszerzeniu okna wrócić do osobnych kolumn.
  const hasStack = columns.some((c) => c.stackUnder)
  const [stacked, setStacked] = useState(false)
  const wideWidthRef = useRef(0)
  useLayoutEffect(() => {
    const table = tableRef.current
    const box = table?.parentElement
    if (!hasStack || !table || !box) return
    const check = () => {
      const avail = box.clientWidth
      if (!stacked) {
        wideWidthRef.current = table.scrollWidth
        if (table.scrollWidth > avail + 2) setStacked(true)
      } else if (wideWidthRef.current > 0 && wideWidthRef.current <= avail) {
        setStacked(false)
      }
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(box)
    return () => ro.disconnect()
  }, [hasStack, stacked, columns, rows])

  const visible = useMemo<VisibleColumn<T>[]>(() => {
    if (!stacked) return columns.map((col) => ({ col, subs: [] }))
    const keys = new Set(columns.map((c) => c.key))
    const subsBy = new Map<string, DataTableColumn<T>[]>()
    for (const c of columns) {
      if (c.stackUnder && keys.has(c.stackUnder)) subsBy.set(c.stackUnder, [...(subsBy.get(c.stackUnder) ?? []), c])
    }
    return columns
      .filter((c) => !(c.stackUnder && keys.has(c.stackUnder)))
      .map((col) => ({ col, subs: subsBy.get(col.key) ?? [] }))
  }, [columns, stacked])

  const [sortInner, setSortInner] = useState<SortState>(defaultSort)
  const controlled = sortProp !== undefined
  const sort = controlled ? sortProp : sortInner

  const handleSort = (key: string) => {
    const next = toggleSort(sort, key)
    if (!controlled) setSortInner(next)
    onSortChange?.(next)
  }

  const getters = useMemo(() => {
    const g: Record<string, (row: T) => unknown> = {}
    for (const c of columns) if (c.sortValue) g[c.key] = c.sortValue
    return g
  }, [columns])

  const sortedRows = useMemo(() => sortRows(rows, sort, getters), [rows, sort, getters])

  const alignStyle = (a?: DataTableColumn<T>['align']): CSSProperties | undefined =>
    a && a !== 'left' ? { textAlign: a } : undefined

  const header = (
    <thead>
      {headerTop}
      <tr>
        {visible.map(({ col: c, subs }) => {
          const style = { ...alignStyle(c.align), ...c.thStyle }
          // pod-etykiety spiętrowanych kolumn — każda sortuje po swojej kolumnie
          const subLabels = subs.length > 0 && (
            <span className="dt-stack-th-subs">
              {subs.map((sc) => {
                const on = sort?.key === sc.key
                return (
                  <span
                    key={sc.key}
                    className={`dt-stack-th-sub ${sc.sortValue ? 'dt-stack-th-sub--sortable' : ''} ${on ? 'dt-stack-th-sub--active' : ''}`}
                    title={sc.title ?? (typeof sc.label === 'string' ? sc.label : undefined)}
                    onClick={
                      sc.sortValue
                        ? (e) => {
                            e.stopPropagation()
                            handleSort(sc.key)
                          }
                        : undefined
                    }
                  >
                    {sc.label}
                    {sc.sortValue && on && (sort?.dir === 'asc' ? ' ▲' : ' ▼')}
                  </span>
                )
              })}
            </span>
          )
          const cls = [c.className, c.thClassName].filter(Boolean).join(' ') || undefined
          if (!c.sortValue) {
            return (
              <th key={c.key} data-col-key={c.key} className={cls} style={style} title={c.title}>
                {c.label}
                {subLabels}
              </th>
            )
          }
          const active = sort?.key === c.key
          const arrow = !active ? '⇅' : sort?.dir === 'asc' ? '▲' : '▼'
          return (
            <th
              key={c.key}
              data-col-key={c.key}
              className={`th-sortable ${active ? 'th-sortable--active' : ''} ${cls ?? ''}`}
              style={style}
              onClick={() => handleSort(c.key)}
              title={c.title ?? (typeof c.label === 'string' ? `Sortuj po: ${c.label}` : undefined)}
            >
              <span className="th-sortable-inner">
                {c.label}
                <span className={`th-sort-arrow ${active ? 'th-sort-arrow--on' : ''}`}>{arrow}</span>
              </span>
              {subLabels}
            </th>
          )
        })}
      </tr>
    </thead>
  )

  let body: ReactNode
  if (loading) {
    body = (
      <tr>
        <td colSpan={visible.length} className="data-table-empty">
          {loadingText}
        </td>
      </tr>
    )
  } else if (sortedRows.length === 0) {
    body = (
      <tr>
        <td colSpan={visible.length} className="data-table-empty">
          {emptyText}
        </td>
      </tr>
    )
  } else {
    const defaultRow = (row: T, i: number) => (
      <tr
        {...rowProps?.(row, i)}
        className={rowClassName?.(row, i)}
        style={{ ...rowStyle?.(row, i), ...(onRowClick ? { cursor: 'pointer' } : null) }}
        title={rowTitle?.(row, i)}
        onClick={onRowClick ? (e) => onRowClick(row, e) : undefined}
      >
        {visible.map(({ col: c, subs }) => {
          const tdCls = typeof c.tdClassName === 'function' ? c.tdClassName(row) : c.tdClassName
          const tdSt = typeof c.tdStyle === 'function' ? c.tdStyle(row) : c.tdStyle
          return (
            <td
              key={c.key}
              className={[c.className, tdCls].filter(Boolean).join(' ') || undefined}
              style={{ ...alignStyle(c.align), ...tdSt }}
              title={c.tdTitle?.(row)}
              onClick={c.stopRowClick ? (e) => e.stopPropagation() : undefined}
            >
              {c.render(row, i)}
              {subs.map((sc) => (
                <div
                  key={sc.key}
                  className="dt-stack-sub"
                  title={sc.tdTitle?.(row)}
                  onClick={sc.stopRowClick ? (e) => e.stopPropagation() : undefined}
                >
                  {sc.render(row, i)}
                </div>
              ))}
            </td>
          )
        })}
      </tr>
    )
    body = sortedRows.map((row, i) => (
      <Fragment key={rowKey(row, i)}>
        {renderRow?.(row, i) ?? defaultRow(row, i)}
        {renderAfterRow?.(row, i)}
      </Fragment>
    ))
  }

  const table = (
    <table ref={tableRef} className={`orders-table ${className ?? ''}`.trim()} style={tableStyle}>
      {colgroup}
      {header}
      <tbody>{body}</tbody>
      {footer && <tfoot>{footer}</tfoot>}
    </table>
  )

  if (!wrapped) return table
  return (
    <TopScrollTableWrapper
      className={`table-wrapper ${wrapperClassName ?? ''}`.trim()}
      style={wrapperStyle}
      tableWrapperRef={tableWrapperRef}
    >
      {table}
    </TopScrollTableWrapper>
  )
}
