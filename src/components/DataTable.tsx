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
}

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
  // resize kolumn: przeciąganie krawędzi nagłówka, szerokości pamiętane per tabela
  useEffect(() => (tableRef.current ? attachColumnResize(tableRef.current) : undefined), [])
  useLayoutEffect(() => {
    if (tableRef.current) applySavedColumnWidths(tableRef.current)
  })

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
        {columns.map((c) => {
          const style = { ...alignStyle(c.align), ...c.thStyle }
          const cls = [c.className, c.thClassName].filter(Boolean).join(' ') || undefined
          if (!c.sortValue) {
            return (
              <th key={c.key} className={cls} style={style} title={c.title}>
                {c.label}
              </th>
            )
          }
          const active = sort?.key === c.key
          const arrow = !active ? '⇅' : sort?.dir === 'asc' ? '▲' : '▼'
          return (
            <th
              key={c.key}
              className={`th-sortable ${active ? 'th-sortable--active' : ''} ${cls ?? ''}`}
              style={style}
              onClick={() => handleSort(c.key)}
              title={c.title ?? (typeof c.label === 'string' ? `Sortuj po: ${c.label}` : undefined)}
            >
              <span className="th-sortable-inner">
                {c.label}
                <span className={`th-sort-arrow ${active ? 'th-sort-arrow--on' : ''}`}>{arrow}</span>
              </span>
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
        <td colSpan={columns.length} className="data-table-empty">
          {loadingText}
        </td>
      </tr>
    )
  } else if (sortedRows.length === 0) {
    body = (
      <tr>
        <td colSpan={columns.length} className="data-table-empty">
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
        {columns.map((c) => {
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
