import { Fragment, useEffect, useState, type ReactNode } from 'react'
import type { GridSheet, GridTable } from '../../lib/doorStockGrid'

type Props<T> = {
  sheets: GridSheet<T>[]
  /** zawartość kratki STAN (liczba, pole do wpisania…) */
  renderCell: (item: T) => ReactNode
  /** dopisek pod tytułem zakładki, np. liczba pozycji */
  emptyText?: string
}

/**
 * Magazyn wewnętrzne ułożony jak dawny Excel „STAN WEWNĘTRZNE MAGAZYN”: zakładki
 * (PŁYTOWE, BRAVO, CREDIS…), bloki model + kolor, w bloku numer modelu i wiersze
 * szerokość × LEWA / PRAWA; ościeżnice jako profil × baza / belka.
 */
export default function DoorStockGrid<T>({ sheets, renderCell, emptyText = 'Brak pozycji' }: Props<T>) {
  const [active, setActive] = useState(sheets[0]?.name ?? '')
  useEffect(() => {
    if (sheets.length > 0 && !sheets.some((s) => s.name === active)) setActive(sheets[0].name)
  }, [sheets, active])
  const sheet = sheets.find((s) => s.name === active) ?? sheets[0]
  if (!sheet) return <p className="muted">{emptyText}</p>
  return (
    <div className="door-grid">
      <div className="subtab-bar door-grid-tabs" role="tablist" aria-label="Zakładki magazynu wewnętrzne">
        {sheets.map((s) => (
          <button
            key={s.name}
            type="button"
            role="tab"
            aria-selected={s.name === sheet.name}
            className={`btn btn-sm ${s.name === sheet.name ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActive(s.name)}
          >
            {s.name}
          </button>
        ))}
      </div>
      <div className="door-grid-blocks">
        {sheet.blocks.map((b) => (
          <section key={b.title} className="door-grid-block">
            <h4 className="door-grid-block-title">{b.title}</h4>
            {b.tables.map((t, i) => (
              <GridTableView key={`${t.label}-${i}`} table={t} renderCell={renderCell} />
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}

function GridTableView<T>({ table, renderCell }: { table: GridTable<T>; renderCell: (item: T) => ReactNode }) {
  if (table.kind === 'wing') {
    // jak w Excelu: SZEROKOŚĆ (scalona) | KIERUNEK | STAN — pionowo
    return (
      <table className="door-grid-table">
        <thead>
          {table.label && (
            <tr>
              <th colSpan={3} className="door-grid-sub">{table.label}</th>
            </tr>
          )}
          <tr>
            <th>SZEROKOŚĆ</th>
            <th>KIERUNEK</th>
            <th>STAN</th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, ri) => {
            const cells = table.columns.map((c, ci) => ({ c, item: r.cells[ci] })).filter((x) => x.item != null)
            return (
              <Fragment key={`${r.label}-${ri}`}>
                {cells.map((x, k) => (
                  <tr key={x.c}>
                    {k === 0 && <td rowSpan={cells.length} className="door-grid-width">{r.label}</td>}
                    <td className="door-grid-dir">{x.c}</td>
                    <td className="door-grid-qty">{renderCell(x.item as T)}</td>
                  </tr>
                ))}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    )
  }
  return (
    <div className="door-grid-matrix-wrap">
      <table className="door-grid-table door-grid-table--matrix">
        <thead>
          <tr>
            <th>{table.label}</th>
            {table.columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, ri) => (
            <tr key={`${r.label}-${ri}`}>
              <td className="door-grid-width">{r.label}</td>
              {r.cells.map((item, ci) => (
                <td key={ci} className="door-grid-qty">{item != null ? renderCell(item) : <span className="door-grid-none">·</span>}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
