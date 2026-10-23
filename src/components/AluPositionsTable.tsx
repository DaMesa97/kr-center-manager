import { useMemo } from 'react'
import DataTable, { type DataTableColumn } from './DataTable'
import { ALU_CONSTRUCTION_LABELS, ALU_STAGE_DEFS } from '../constants'
import { aluStageDone, formatAluDims, formatAluGlass, formatAluNotes } from '../lib/alu'
import type { AluPosition } from '../types'

// Pozycje (konstrukcje) zlecenia aluminium — podgląd w szczegółach zlecenia.
// Etapy per sztuka: chip „2/3” = 2 z 3 sztuk ma zrobiony etap.

type Props = {
  positions: AluPosition[]
  compact?: boolean
}

export default function AluPositionsTable({ positions, compact = false }: Props) {
  const columns = useMemo<DataTableColumn<AluPosition>[]>(() => {
    const cols: DataTableColumn<AluPosition>[] = [
      { key: 'pos_no', label: 'POZ.', className: 'col-order-text', sortValue: (p) => p.pos_no, render: (p) => p.pos_no },
      {
        key: 'type',
        label: 'TYP',
        className: 'col-order-text',
        sortValue: (p) => p.construction_type,
        render: (p) => ALU_CONSTRUCTION_LABELS[p.construction_type] ?? p.construction_type,
      },
      {
        key: 'description',
        label: 'OPIS',
        className: 'col-order-text alu-col-description',
        sortValue: (p) => p.description,
        tdTitle: (p) => p.description || undefined,
        render: (p) => (
          <>
            {p.description || '—'}
            {p.system && <div className="dt-stack-sub">{p.system}</div>}
          </>
        ),
      },
      {
        key: 'profile_color',
        label: 'KOLOR PROFILI',
        className: 'col-order-text',
        sortValue: (p) => p.profile_color,
        render: (p) => (
          <>
            {p.profile_color || '—'}
            {p.hardware_color && p.hardware_color !== p.profile_color && <div className="dt-stack-sub">okucia: {p.hardware_color}</div>}
          </>
        ),
      },
      { key: 'dims', label: 'WYMIAR (S×W)', className: 'col-order-text', sortValue: (p) => p.width_mm ?? 0, render: (p) => formatAluDims(p.width_mm, p.height_mm) || '—' },
      { key: 'quantity', label: 'ILOŚĆ', className: 'col-order-text', align: 'center', sortValue: (p) => p.quantity, render: (p) => p.quantity },
      {
        key: 'glass',
        label: 'SZKŁO',
        className: 'col-order-text',
        sortValue: (p) => (p.glass ?? []).length,
        tdTitle: (p) => formatAluGlass(p.glass) || undefined,
        render: (p) => formatAluGlass(p.glass) || '—',
      },
    ]
    if (!compact) {
      cols.push(
        {
          key: 'fillings',
          label: 'WYPEŁNIENIA',
          className: 'col-order-text alu-col-description',
          sortValue: (p) => p.fillings,
          tdTitle: (p) => p.fillings || undefined,
          render: (p) => p.fillings || '—',
        },
        {
          key: 'notes',
          label: 'UWAGI PRODUKCYJNE',
          className: 'col-order-text alu-col-description',
          sortValue: (p) => formatAluNotes(p.notes),
          tdTitle: (p) => formatAluNotes(p.notes) || undefined,
          render: (p) => formatAluNotes(p.notes) || '—',
        },
        {
          key: 'weight',
          label: 'MASA / U',
          className: 'col-order-text',
          sortValue: (p) => p.weight_kg ?? 0,
          render: (p) => [p.weight_kg != null ? `${p.weight_kg} kg` : '', p.u_value != null ? `U=${p.u_value}` : ''].filter(Boolean).join(' · ') || '—',
        },
      )
    }
    cols.push({
      key: 'stages',
      label: 'ETAPY',
      className: 'col-order-text',
      stopRowClick: true,
      sortValue: (p) => ALU_STAGE_DEFS.reduce((s, d) => s + aluStageDone(p.production_stages, d.key, p.quantity), 0),
      render: (p) => (
        <span className="alu-stage-chips">
          {ALU_STAGE_DEFS.map((d) => {
            const done = aluStageDone(p.production_stages, d.key, p.quantity)
            const full = p.quantity > 0 && done >= p.quantity
            return (
              <span
                key={d.key}
                className={`alu-stage-chip ${full ? 'alu-stage-chip--done' : done > 0 ? 'alu-stage-chip--partial' : ''}`}
                title={`${d.title}: ${done}/${p.quantity} szt.`}
              >
                {d.header} {done}/{p.quantity}
              </span>
            )
          })}
        </span>
      ),
    })
    return cols
  }, [compact])

  return (
    <DataTable
      rows={positions}
      rowKey={(p) => p.id}
      columns={columns}
      wrapperClassName="orders-table-wrapper alu-positions-wrapper"
      emptyText="Brak pozycji."
      defaultSort={{ key: 'pos_no', dir: 'asc' }}
    />
  )
}
