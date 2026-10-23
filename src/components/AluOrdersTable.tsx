import { useMemo, type MutableRefObject } from 'react'
import DataTable, { type DataTableColumn } from './DataTable'
import { ALU_CONSTRUCTION_LABELS, ALU_REALIZACJA_LABELS } from '../constants'
import { aluOrderExtra, aluOrderProgress, summarizeAluTypes } from '../lib/alu'
import { isReleaseDateEmpty } from '../utils'
import type { AluPosition, Order, OrderDocument } from '../types'

// Zlecenia „Stolarka aluminiowa” — jedno zlecenie = jedna lista produkcyjna (OF),
// pozycje (konstrukcje) i PDF-y w szczegółach. Etapy liczone per sztuka (lib/alu).

type Props = {
  orders: Order[]
  positionsByOrder: Record<number, AluPosition[]>
  documentsByOrder: Record<number, OrderDocument[]>
  loading: boolean
  onShowDetails: (o: Order) => void
  tableWrapperRef: MutableRefObject<HTMLDivElement | null>
}

type Status = 'cancelled' | 'released' | 'in_progress'
const STATUS_LABEL: Record<Status, string> = { cancelled: 'Anulowane', released: 'Wydane', in_progress: 'W realizacji' }
const STATUS_BADGE: Record<Status, string> = {
  cancelled: 'order-status-badge--cancelled',
  released: 'order-status-badge--released',
  in_progress: 'order-status-badge--in-progress',
}

function orderStatus(o: Order): Status {
  const cancelled = (o.extra_fields as Record<string, unknown> | null)?.cancelled === true
  if (cancelled) return 'cancelled'
  return isReleaseDateEmpty(o.release_date) ? 'in_progress' : 'released'
}

/** Termin po polsku + ile dni zostało (ujemne = po terminie) */
function deadlineInfo(deadline: string): { label: string; daysLeft: number | null } {
  if (!deadline) return { label: '—', daysLeft: null }
  const d = new Date(`${deadline}T00:00:00`)
  if (Number.isNaN(d.getTime())) return { label: deadline, daysLeft: null }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const daysLeft = Math.round((d.getTime() - today.getTime()) / 86_400_000)
  return { label: d.toLocaleDateString('pl-PL'), daysLeft }
}

export default function AluOrdersTable({ orders, positionsByOrder, documentsByOrder, loading, onShowDetails, tableWrapperRef }: Props) {
  const columns = useMemo<DataTableColumn<Order>[]>(() => {
    const posOf = (o: Order) => (o.id != null ? positionsByOrder[o.id] ?? [] : [])
    const docsOf = (o: Order) => (o.id != null ? documentsByOrder[o.id] ?? [] : [])
    return [
      {
        key: 'order_number',
        label: 'NR ZLECENIA (OF)',
        className: 'col-order-number',
        sortValue: (o) => o.order_number,
        render: (o) => <strong>{o.order_number}</strong>,
      },
      {
        key: 'lp',
        label: 'LISTA PROD.',
        className: 'col-order-text',
        sortValue: (o) => aluOrderExtra(o).lp_number,
        render: (o) => aluOrderExtra(o).lp_number || '—',
      },
      {
        key: 'company',
        label: 'FIRMA',
        className: 'col-company',
        sortValue: (o) => o.company,
        render: (o) => o.company || '—',
      },
      {
        key: 'deadline',
        label: 'TERMIN',
        className: 'col-order-text',
        sortValue: (o) => aluOrderExtra(o).deadline || null,
        tdClassName: (o) => {
          const { daysLeft } = deadlineInfo(aluOrderExtra(o).deadline)
          if (orderStatus(o) !== 'in_progress' || daysLeft == null) return undefined
          return daysLeft < 0 ? 'alu-deadline--late' : daysLeft <= 5 ? 'alu-deadline--soon' : undefined
        },
        render: (o) => {
          const { label, daysLeft } = deadlineInfo(aluOrderExtra(o).deadline)
          const open = orderStatus(o) === 'in_progress'
          return (
            <>
              {label}
              {open && daysLeft != null && (
                <div className="dt-stack-sub">{daysLeft < 0 ? `${-daysLeft} dni po terminie` : daysLeft === 0 ? 'dziś' : `za ${daysLeft} dni`}</div>
              )}
            </>
          )
        },
      },
      {
        key: 'realizacja',
        label: 'REALIZACJA',
        className: 'col-order-text',
        sortValue: (o) => aluOrderExtra(o).realizacja,
        render: (o) => {
          const r = aluOrderExtra(o).realizacja
          return <span className={`alu-realizacja-chip alu-realizacja-chip--${r}`}>{ALU_REALIZACJA_LABELS[r] ?? r}</span>
        },
      },
      {
        key: 'positions',
        label: 'POZYCJE',
        className: 'col-order-text',
        sortValue: (o) => posOf(o).length,
        render: (o) => {
          const pos = posOf(o)
          const qty = pos.reduce((s, p) => s + (Number(p.quantity) || 0), 0)
          return (
            <>
              <span className="order-items-count">
                {pos.length} poz. <span className="order-items-total">({qty} szt)</span>
              </span>
              {pos.length > 0 && <div className="dt-stack-sub">{summarizeAluTypes(pos, ALU_CONSTRUCTION_LABELS)}</div>}
            </>
          )
        },
      },
      {
        key: 'systems',
        label: 'SYSTEM',
        className: 'col-order-text',
        sortValue: (o) => posOf(o)[0]?.system ?? '',
        render: (o) => [...new Set(posOf(o).map((p) => p.system).filter(Boolean))].join(', ') || '—',
      },
      {
        key: 'progress',
        label: 'POSTĘP',
        className: 'col-order-text',
        sortValue: (o) => aluOrderProgress(posOf(o)).percent,
        render: (o) => {
          const pr = aluOrderProgress(posOf(o))
          if (pr.total === 0) return '—'
          return (
            <div className="alu-progress" title={`${pr.done} z ${pr.total} sztuko-etapów`}>
              <div className="alu-progress-bar">
                <div className="alu-progress-fill" style={{ width: `${pr.percent}%` }} />
              </div>
              <span className="alu-progress-label">{pr.percent}%</span>
            </div>
          )
        },
      },
      {
        key: 'docs',
        label: 'PDF',
        className: 'col-order-text',
        sortValue: (o) => docsOf(o).length,
        tdTitle: (o) => docsOf(o).map((d) => `${d.kind}: ${d.number ?? d.file_name}`).join('\n') || 'Brak plików',
        render: (o) => {
          const kinds = new Set(docsOf(o).map((d) => d.kind))
          return (
            <span className="alu-docs">
              <span className={`alu-doc-chip ${kinds.has('LP') ? 'alu-doc-chip--on' : ''}`}>LP</span>
              <span className={`alu-doc-chip ${kinds.has('LC') ? 'alu-doc-chip--on' : ''}`}>LC</span>
            </span>
          )
        },
      },
      {
        key: 'release_date',
        label: 'WYDANIE',
        className: 'col-order-text',
        sortValue: (o) => o.release_date,
        render: (o) => (isReleaseDateEmpty(o.release_date) ? '—' : String(o.release_date)),
      },
      {
        key: 'status',
        label: 'STATUS',
        className: 'col-order-text',
        sortValue: (o) => STATUS_LABEL[orderStatus(o)],
        render: (o) => {
          const st = orderStatus(o)
          return <span className={`order-status-badge ${STATUS_BADGE[st]}`}>{STATUS_LABEL[st]}</span>
        },
      },
    ]
  }, [positionsByOrder, documentsByOrder])

  return (
    <DataTable
      rows={orders}
      rowKey={(o) => o.id ?? o.order_number}
      columns={columns}
      className="alu-orders-table"
      wrapperClassName="orders-table-wrapper"
      tableWrapperRef={tableWrapperRef}
      loading={loading && orders.length === 0}
      emptyText="Brak zleceń stolarki aluminiowej — wgraj listę produkcyjną (PDF z AluronCAD)."
      rowClassName={(o) => `orders-table-row orders-table-row--clickable ${orderStatus(o) === 'cancelled' ? 'orders-table-row--cancelled-own' : ''}`}
      onRowClick={(o) => onShowDetails(o)}
    />
  )
}
