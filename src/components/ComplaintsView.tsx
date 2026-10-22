import { useCallback, useEffect, useLayoutEffect, useMemo, type MutableRefObject, type ReactNode } from 'react'
import ProductionStageCell from './ProductionStageCell'
import DataTable, { type DataTableColumn } from './DataTable'
import type { Complaint, StageDef, StStageLayoutMode, WhatComplained } from '../types'
import {
  distingPlusMirrorTitle,
  getComplaintBlockedStages,
  isReleaseDateEmpty,
  isStTitanComplaint,
  orderCellTooltip,
  parseProductionStages,
  staDistingPlusMirrorStorageKey,
  staDistingPlusMirrorTitle,
  stStageCellKind,
} from '../utils'
import { appConfirm } from '../lib/appDialogs'
import { modelSystemCol } from './orderTableColumns'

type ComplaintsViewProps = {
  activeTab: string
  isManager: boolean
  filteredComplaints: Complaint[]
  orderStageColumnDefs: StageDef[]
  linkedComplaints: Complaint[]
  stOrdersStageLayout: { mode: StStageLayoutMode; defs: StageDef[] } | null
  tableWrapperRef: MutableRefObject<HTMLDivElement | null>
  onAddComplaint: () => void
  onComplaintRushToggle: (complaint: Complaint, checked: boolean) => void | Promise<void>
  onComplaintStageClick: (
    complaintId: number,
    stageKey: string,
    rowStages: Record<string, string>,
    category: Complaint['category'],
  ) => void | Promise<void>
  onCancelComplaint: (complaint: Complaint) => void
  onRestoreComplaint: (complaint: Complaint) => void | Promise<void>
  onCompleteComplaint: (complaint: Complaint, done: boolean) => void | Promise<void>
}

export default function ComplaintsView({
  activeTab,
  isManager,
  filteredComplaints,
  orderStageColumnDefs,
  linkedComplaints,
  stOrdersStageLayout,
  tableWrapperRef,
  onAddComplaint,
  onComplaintRushToggle,
  onComplaintStageClick,
  onCancelComplaint,
  onRestoreComplaint,
  onCompleteComplaint,
}: ComplaintsViewProps) {
  const syncComplaintsStickyWidths = useCallback(() => {
    const root = tableWrapperRef.current
    if (!root) return
    const th1 = root.querySelector<HTMLElement>('thead th.sticky-col.sticky-1')
    const th2 = root.querySelector<HTMLElement>('thead th.sticky-col.sticky-2')
    if (th1) {
      const w1 = th1.offsetWidth
      if (w1 > 0) {
        root.style.setProperty('--orders-sticky-col1-width', `${w1}px`)
      }
    }
    if (th2) {
      const w2 = th2.offsetWidth
      if (w2 > 0) {
        root.style.setProperty('--orders-sticky-col2-width', `${w2}px`)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLayoutEffect(() => {
    syncComplaintsStickyWidths()
  }, [syncComplaintsStickyWidths, activeTab, filteredComplaints, stOrdersStageLayout, isManager])

  useEffect(() => {
    const root = tableWrapperRef.current
    const th1 = root?.querySelector('thead th.sticky-col.sticky-1') ?? null
    const th2 = root?.querySelector('thead th.sticky-col.sticky-2') ?? null
    const ro = th1 || th2
      ? new ResizeObserver(() => {
          syncComplaintsStickyWidths()
        })
      : null
    if (ro) {
      if (th1) ro.observe(th1)
      if (th2) ro.observe(th2)
      window.addEventListener('resize', syncComplaintsStickyWidths)
    }
    return () => {
      if (ro) {
        ro.disconnect()
        window.removeEventListener('resize', syncComplaintsStickyWidths)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncComplaintsStickyWidths, activeTab, filteredComplaints, stOrdersStageLayout, isManager])

  // dane wiersza STA/Disting/Bastion liczone raz na wiersz (etapy, blokady, partner Disting+)
  const staRowInfo = useMemo(() => {
    const m = new Map<Complaint, { rowStages: Record<string, string>; blockedKeys: string[]; distStages: Record<string, string> }>()
    for (const c of filteredComplaints) {
      const distPartner =
        c.linked_complaint_id != null ? linkedComplaints.find((lc) => lc.id === c.linked_complaint_id) : undefined
      m.set(c, {
        rowStages: parseProductionStages(c.production_stages, c.category),
        blockedKeys: getComplaintBlockedStages(c.category, c.what_complained as WhatComplained | '', c.linked_complaint_id),
        distStages: distPartner
          ? parseProductionStages(distPartner.production_stages, 'Disting')
          : ({} as Record<string, string>),
      })
    }
    return m
  }, [filteredComplaints, linkedComplaints])

  const stRowStages = useMemo(() => {
    const m = new Map<Complaint, Record<string, string>>()
    for (const c of filteredComplaints) m.set(c, parseProductionStages(c.production_stages, 'ST'))
    return m
  }, [filteredComplaints])

  // kolumny wspólne dla trzech tabel
  const leadColumns = (opts: { cancelledBadge: boolean; modelClass: string }): DataTableColumn<Complaint>[] => [
    {
      key: 'complaint_number',
      label: 'NR. REKLAMACJI',
      title: 'NR. REKLAMACJI',
      className: 'sticky-col sticky-1 col-order-number',
      tdTitle: (c) => orderCellTooltip(c.complaint_number),
      sortValue: (c) => c.complaint_number,
      render: (c) => (
        <>
          {opts.cancelledBadge && activeTab === 'STA' && c.category === 'STA' && isDistingCancelled(c) && (
            <div className="orders-table-row-cancelled-badge">ANULOWANO W DISTING</div>
          )}
          <span className="order-num-value">{c.complaint_number}</span>
        </>
      ),
    },
    {
      key: 'order_number',
      label: 'NR. ZLECENIA',
      title: 'NR. ZLECENIA',
      className: 'sticky-col sticky-2 col-order-number',
      tdTitle: (c) => orderCellTooltip(c.order_number),
      sortValue: (c) => c.order_number,
      render: (c) => (
        <>
          {!isReleaseDateEmpty(c.release_date) ? (
            <span className="released-badge order-badge" title="Zrealizowane (wydanie)">
              ZREALIZOWANE
            </span>
          ) : null}
          <span className="order-num-value">{c.order_number}</span>
        </>
      ),
    },
    textCol('company', 'FIRMA', (c) => c.company, 'sticky-col sticky-3 col-company'),
    textCol('order_date', 'DATA', (c) => c.order_date, 'col-order-text col-order-date', false),
    textCol('production_day', 'PRODUKCJA', (c) => c.production_day, 'col-order-text', false),
    textCol('quantity', 'ILOŚĆ', (c) => c.quantity),
    {
      key: 'rush',
      label: 'PILNE',
      title: 'PILNE',
      className: 'rush-cell',
      render: (c) => (
        <input
          type="checkbox"
          className="rush-checkbox"
          checked={c.is_rush}
          disabled={!isManager}
          title="Pilne (snapshot reklamacji)"
          aria-label="Pilne"
          onChange={(e) => {
            void onComplaintRushToggle(c, e.target.checked)
          }}
        />
      ),
    },
    textCol('what_complained', 'CO REKLAMOWANE', (c) => c.what_complained),
    modelSystemCol<Complaint>({ className: opts.modelClass }),
  ]

  // REALIZACJA reklamacji — klikalna dla kierownika (wcześniej pole było
  // tylko-do-odczytu kopią stanu zamówienia i reklamacji nie dało się zamknąć)
  const releaseColumn = (thClassName: string): DataTableColumn<Complaint> => ({
    key: 'release_date',
    label: 'REALIZACJA',
    title: 'Realizacja reklamacji (klik = oznacz / cofnij)',
    thClassName,
    tdClassName: 'release-date-td col-order-text',
    stopRowClick: true,
    tdTitle: (c) => (isReleaseDateEmpty(c.release_date) ? undefined : String(c.release_date ?? '').trim() || undefined),
    render: (c) =>
      isReleaseDateEmpty(c.release_date) ? (
        isManager ? (
          <button
            type="button"
            className="release-checkbox-btn"
            role="checkbox"
            aria-checked={false}
            aria-label="Oznacz realizację reklamacji dzisiejszą datą"
            title="Oznacz realizację reklamacji"
            onClick={() => {
              void (async () => {
                const ok = await appConfirm(
                  `Oznaczyć reklamację ${c.complaint_number ?? ''} jako zrealizowaną (naprawa zakończona)?`,
                  { title: 'Realizacja reklamacji', confirmLabel: 'Tak, zrealizowana' },
                )
                if (ok) void onCompleteComplaint(c, true)
              })()
            }}
          />
        ) : (
          <span className="release-date-placeholder">—</span>
        )
      ) : isManager ? (
        <button
          type="button"
          className="release-date-value"
          title="Kliknij, aby cofnąć realizację"
          onClick={() => {
            void (async () => {
              const ok = await appConfirm(`Cofnąć realizację reklamacji ${c.complaint_number ?? ''}?`, {
                title: 'Realizacja reklamacji',
                confirmLabel: 'Tak, cofnij',
              })
              if (ok) void onCompleteComplaint(c, false)
            })()
          }}
        >
          {String(c.release_date).trim()}
        </button>
      ) : (
        <span className="release-date-value release-date-value--readonly">{String(c.release_date).trim()}</span>
      ),
  })

  const actionsColumns = (thTitle?: string): DataTableColumn<Complaint>[] =>
    isManager
      ? [
          {
            key: 'actions',
            label: 'Akcje',
            title: thTitle,
            className: 'col-order-actions',
            render: (c) =>
              c.id === undefined ? null : isComplaintCancelled(c) ? (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => void onRestoreComplaint(c)}>
                  Przywróć
                </button>
              ) : (
                <button type="button" className="btn btn-sm btn-danger" onClick={() => onCancelComplaint(c)}>
                  Anuluj
                </button>
              ),
          },
        ]
      : []

  const sheetText = (v: string | null | undefined) => String(v ?? '').trim() || '—'

  const staStageCell = (c: Complaint, def: StageDef): { title?: string; content: ReactNode } => {
    const info = staRowInfo.get(c)
    const rowStages = info?.rowStages ?? {}
    const distStages = info?.distStages ?? {}
    const value = rowStages[def.key] ?? ''
    const staMirrorKey =
      activeTab === 'STA' && c.category === 'STA' && c.linked_complaint_id != null
        ? staDistingPlusMirrorStorageKey(def.key)
        : null
    if (staMirrorKey) {
      const mirrorRaw =
        staMirrorKey === 'dist_e2_1'
          ? distStages.e2_1 ?? distStages.dist_e2_1 ?? distStages.dist_e2 ?? ''
          : staMirrorKey === 'dist_e1'
            ? distStages.e1 ?? distStages.dist_e1 ?? ''
            : distStages.e2_2 ?? distStages[staMirrorKey] ?? ''
      const mirrorVal = String(mirrorRaw).trim()
      const filled = Boolean(mirrorVal)
      return {
        title: filled ? mirrorVal : staDistingPlusMirrorTitle(def.key),
        content: (
          <span
            className={[
              'production-stage-readonly',
              filled ? 'production-stage-readonly--linked-done' : 'production-stage-readonly--linked-empty',
            ].join(' ')}
            title={staDistingPlusMirrorTitle(def.key)}
          >
            {filled ? mirrorVal : '—'}
          </span>
        ),
      }
    }
    if (info?.blockedKeys.includes(def.key)) {
      return {
        content: (
          <span
            className={[
              'production-stage-readonly',
              value.trim() ? 'production-stage-readonly--linked-done' : 'production-stage-readonly--linked-empty',
            ].join(' ')}
            title={
              c.category === 'Disting' && c.linked_complaint_id != null ? distingPlusMirrorTitle(def.key) : undefined
            }
          >
            {value.trim() ? value.trim() : '—'}
          </span>
        ),
      }
    }
    return {
      title: value.trim() ? value.trim() : undefined,
      content: (
        <ProductionStageCell
          value={value}
          disabled={!isManager || c.id === undefined || isComplaintCancelled(c)}
          onPickEmpty={() => {
            if (c.id === undefined) return
            void onComplaintStageClick(c.id, def.key, rowStages, c.category)
          }}
          onPickFilled={() => {
            if (c.id === undefined) return
            void onComplaintStageClick(c.id, def.key, rowStages, c.category)
          }}
        />
      ),
    }
  }

  const staColumns: DataTableColumn<Complaint>[] = withComplaintStacking([
    ...leadColumns({ cancelledBadge: true, modelClass: 'col-order-text col-order-model' }),
    textCol('wing_color', 'KOLOR SKRZYDŁA', (c) => c.wing_color, 'col-order-text col-wing-color'),
    textCol('frame_color', 'KOLOR OŚCIEŻNICY', (c) => c.frame_color, 'col-order-text col-frame-color'),
    textCol('threshold_color', 'KOLOR PROGU', (c) => c.threshold_color),
    textCol('width', 'SZEROKOŚĆ', (c) => c.width),
    textCol('direction', 'KIERUNEK', (c) => c.direction),
    textCol('opening', 'OTWIERANIE', (c) => c.opening),
    textCol('height', 'WYSOKOŚĆ', (c) => c.height),
    textCol('glazing', 'SZKLENIE', (c) => c.glazing),
    textCol('decorative_panel', 'PANEL DEKORACYJNY', (c) => c.decorative_panel),
    textCol('hardware', 'OKUCIA', (c) => c.hardware),
    textCol('handle', 'POCHWYT', (c) => c.handle),
    textCol('electric_strike', 'ELEKTROZACZEP', (c) => c.electric_strike),
    textCol('peephole', 'WIZJER', (c) => c.peephole),
    textCol('top_light', 'NAŚWIETLE GÓRNE', (c) => c.top_light),
    textCol('top_light_glazing', 'SZKLENIE NAŚWIETLE GÓRNE', (c) => c.top_light_glazing),
    textCol('side_panel', 'DOSTAWKA BOCZNA', (c) => c.side_panel),
    textCol('side_panel_glazing', 'SZKLENIE DOSTAWKA BOCZNA', (c) => c.side_panel_glazing),
    textCol('extension', 'POSZERZENIE', (c) => c.extension),
    ...orderStageColumnDefs.map(
      (def): DataTableColumn<Complaint> => ({
        key: `stage-${def.key}`,
        label: def.header,
        title: def.title ?? def.header,
        thClassName: 'production-stage-th col-stage',
        tdClassName: 'production-stage-td col-stage',
        tdTitle: (c) => staStageCell(c, def).title,
        render: (c) => staStageCell(c, def).content,
      }),
    ),
    ...(activeTab === 'STA'
      ? [
          {
            key: 'osc-pack',
            label: 'OŚC.',
            title: 'Pakowanie ościeżnicy (Disting E5) — reklamacje DISTING PLUS',
            thClassName: 'production-stage-th sta-osc-pack-th col-osc-pack',
            tdClassName: 'production-stage-td sta-osc-pack-td col-osc-pack',
            render: (c: Complaint) => {
              if (c.linked_complaint_id == null) return ' '
              // Etap E5 powiązanej reklamacji Disting (jak w zamówieniach) —
              // wcześniej badge pokazywał KOLOR ościeżnicy jako "inicjały"
              const oscInitials = String(staRowInfo.get(c)?.distStages.e5 ?? '').trim()
              const oscDone = Boolean(oscInitials)
              return (
                <span
                  className={oscDone ? 'sta-osc-badge sta-osc-badge--done' : 'sta-osc-badge sta-osc-badge--wait'}
                  title={
                    oscDone ? 'Ościeżnica spakowana do transportu' : 'Oczekiwanie na pakowanie ościeżnicy w Disting (E5)'
                  }
                >
                  {oscDone ? (
                    <>
                      OŚC ✓ <span className="sta-osc-badge-initials">{oscInitials}</span>
                    </>
                  ) : (
                    'OŚC —'
                  )}
                </span>
              )
            },
          },
        ]
      : []),
    releaseColumn('col-order-text release-date-th'),
    {
      key: 'sta_sheet',
      label: 'NR. W ARKUSZU STA',
      title: 'NR. W ARKUSZU STA',
      className: 'col-order-text',
      tdTitle: (c) => orderCellTooltip(c.sta_sheet),
      sortValue: (c) => c.sta_sheet,
      render: (c) => sheetText(c.sta_sheet),
    },
    {
      key: 'disting_sheet',
      label: 'NR. W ARKUSZU DISTING',
      title: 'NR. W ARKUSZU DISTING',
      className: 'col-order-text',
      tdTitle: (c) => orderCellTooltip(c.disting_sheet),
      sortValue: (c) => c.disting_sheet,
      render: (c) => sheetText(c.disting_sheet),
    },
    textCol('notes', 'UWAGI', (c) => c.notes, 'col-notes'),
    textCol('client_order_number', 'NUMER ZAMÓWIENIA KLIENTA', (c) => c.client_order_number),
    textCol('defects', 'BRAKI', (c) => c.defects),
    textCol('created_by', 'WPISAŁ', (c) => c.created_by),
    textCol('configurator_value', 'WARTOŚĆ KONFIGURATOR', (c) => c.configurator_value),
    textCol('info', 'INFO', (c) => c.info),
    textCol('airtable_id', 'AIRTABLE ID', (c) => c.airtable_id),
    textCol('label', 'ETYKIETA', (c) => c.label),
    textCol('reason', 'POWÓD REKLAMACJI', (c) => c.reason),
    ...actionsColumns('Akcje'),
  ])

  const skrBadge = (rowStages: Record<string, string>) => {
    const skrInitials = String(rowStages.sta_e5 ?? '').trim()
    const skrDone = Boolean(skrInitials)
    return {
      title: skrDone ? 'Skrzydło spakowane w STA (E5)' : 'Oczekiwanie na pakowanie skrzydła w STA (E5)',
      content: (
        <span className={skrDone ? 'st-skr-pack-badge st-skr-pack-badge--done' : 'st-skr-pack-badge st-skr-pack-badge--wait'}>
          {skrDone ? (
            <>
              SKR ✓ <span className="sta-osc-badge-initials">{skrInitials}</span>
            </>
          ) : (
            'SKR —'
          )}
        </span>
      ),
    }
  }

  const stStageCell = (
    c: Complaint,
    def: StageDef,
    mode: StStageLayoutMode,
  ): { className: string; title?: string; content: ReactNode } => {
    const rowStages = stRowStages.get(c) ?? {}
    const cellKind = stStageCellKind(def, isStTitanComplaint(c), mode)
    if (cellKind.kind === 'none') return { className: 'production-stage-td col-stage', content: '—' }
    if (cellKind.kind === 'skr_badge') {
      return { className: 'production-stage-td sta-osc-pack-td col-osc-pack', ...skrBadge(rowStages) }
    }
    if (cellKind.kind === 'e2_sta') {
      const e2Val = String(rowStages.sta_e5 ?? '').trim()
      const filled = Boolean(e2Val)
      return {
        className: 'production-stage-td col-stage',
        title: filled ? e2Val : 'Status z arkusza STA (E5)',
        content: (
          <span
            className={[
              'production-stage-readonly',
              filled ? 'production-stage-readonly--linked-done' : 'production-stage-readonly--linked-empty',
            ].join(' ')}
            title="E2 — skrzydło odebrane (STA E5)"
          >
            {filled ? e2Val : '—'}
          </span>
        ),
      }
    }
    const stageKey = cellKind.stageKey
    const isBlocked = getComplaintBlockedStages(
      'ST',
      c.what_complained as WhatComplained | '',
      c.linked_complaint_id,
    ).includes(stageKey)
    return {
      className: 'production-stage-td col-stage',
      content: (
        <ProductionStageCell
          value={rowStages[stageKey] ?? ''}
          disabled={!isManager || c.id === undefined || isBlocked || isComplaintCancelled(c)}
          onPickEmpty={() => {
            if (c.id === undefined) return
            void onComplaintStageClick(c.id, stageKey, rowStages, 'ST')
          }}
          onPickFilled={() => {
            if (c.id === undefined) return
            void onComplaintStageClick(c.id, stageKey, rowStages, 'ST')
          }}
        />
      ),
    }
  }

  const stColumns: DataTableColumn<Complaint>[] = stOrdersStageLayout
    ? withComplaintStacking([
        ...leadColumns({ cancelledBadge: false, modelClass: 'col-order-text' }),
        textCol('wing_color', 'KOLOR', (c) => c.wing_color),
        textCol('width', 'SZEROKOŚĆ', (c) => c.width),
        textCol('direction', 'KIERUNEK', (c) => c.direction),
        textCol('opening', 'OTWIERANIE', (c) => c.opening),
        textCol('height', 'WYSOKOŚĆ', (c) => c.height),
        textCol('glazing', 'SZKLENIE', (c) => c.glazing),
        textCol('hardware', 'OKUCIA', (c) => c.hardware),
        textCol('handle', 'POCHWYT', (c) => c.handle),
        textCol('peephole', 'WIZJER', (c) => c.peephole),
        ...stOrdersStageLayout.defs.map(
          (def): DataTableColumn<Complaint> => ({
            key: `stage-${def.key}`,
            label: def.header,
            title: def.title,
            thClassName: 'production-stage-th col-stage',
            tdClassName: (c) => stStageCell(c, def, stOrdersStageLayout.mode).className,
            tdTitle: (c) => stStageCell(c, def, stOrdersStageLayout.mode).title,
            render: (c) => stStageCell(c, def, stOrdersStageLayout.mode).content,
          }),
        ),
        ...(stOrdersStageLayout.mode === 'titan' || stOrdersStageLayout.mode === 'mixed'
          ? [
              {
                key: 'skr-pack',
                label: 'SKR ✓',
                title: 'Skrzydło spakowane w STA (E5)',
                thClassName: 'production-stage-th sta-osc-pack-th col-osc-pack',
                tdClassName: 'production-stage-td sta-osc-pack-td col-osc-pack',
                tdTitle: (c: Complaint) =>
                  stOrdersStageLayout.mode === 'mixed' && !isStTitanComplaint(c)
                    ? undefined
                    : skrBadge(stRowStages.get(c) ?? {}).title,
                render: (c: Complaint) =>
                  stOrdersStageLayout.mode === 'mixed' && !isStTitanComplaint(c)
                    ? ' '
                    : skrBadge(stRowStages.get(c) ?? {}).content,
              },
            ]
          : []),
        releaseColumn('col-order-text'),
        textCol('info', 'INFO', (c) => c.info),
        textCol('notes', 'UWAGI', (c) => c.notes),
        textCol('client_order_number', 'NUMER ZAMÓWIENIA KLIENTA', (c) => c.client_order_number),
        textCol('created_by', 'WPISAŁ', (c) => c.created_by),
        textCol('configurator_value', 'WARTOŚĆ KONFIGURATOR', (c) => c.configurator_value),
        textCol('airtable_id', 'AIRTABLE ID', (c) => c.airtable_id),
        {
          key: 'sta_sheet',
          label: 'NR W ARKUSZU STA',
          title: 'NR W ARKUSZU STA',
          className: 'col-order-text',
          sortValue: (c) => c.sta_sheet,
          render: (c) => sheetText(c.sta_sheet),
        },
        textCol('reason', 'POWÓD REKLAMACJI', (c) => c.reason),
        ...actionsColumns(),
      ])
    : []

  const techColumns: DataTableColumn<Complaint>[] = withComplaintStacking([
    ...leadColumns({ cancelledBadge: false, modelClass: 'col-order-text' }),
    textCol('wing_color', 'KOLOR', (c) => c.wing_color),
    textCol('threshold_color', 'PRÓG', (c) => c.threshold_color),
    textCol('width', 'SZEROKOŚĆ', (c) => c.width),
    textCol('direction', 'KIERUNEK', (c) => c.direction),
    textCol('opening', 'OTWIERANIE', (c) => c.opening),
    textCol('height', 'WYSOKOŚĆ', (c) => c.height),
    textCol('glazing', 'SZKLENIE', (c) => c.glazing),
    textCol('hardware', 'OKUCIA', (c) => c.hardware),
    textCol('handle', 'POCHWYT', (c) => c.handle),
    textCol('peephole', 'WIZJER', (c) => c.peephole),
    releaseColumn('col-order-text'),
    textCol('info', 'INFO', (c) => c.info),
    textCol('notes', 'UWAGI', (c) => c.notes),
    textCol('client_order_number', 'NUMER ZAMÓWIENIA KLIENTA', (c) => c.client_order_number),
    textCol('created_by', 'WPISAŁ', (c) => c.created_by),
    textCol('reason', 'POWÓD REKLAMACJI', (c) => c.reason),
    ...actionsColumns(),
  ])

  const tableProps = {
    rows: filteredComplaints,
    rowKey: (c: Complaint) => c.id ?? c.complaint_number,
    rowClassName: complaintRowClass,
    wrapperClassName: 'orders-table-wrapper',
    tableWrapperRef,
    emptyText: 'Brak reklamacji',
  }

  return (
    <div className="complaints-view">
      {isManager && (
        <button type="button" className="btn btn-success" onClick={onAddComplaint}>
          + Nowa reklamacja
        </button>
      )}
      {(activeTab === 'STA' || activeTab === 'Disting' || activeTab === 'Bastion') && (
        <DataTable {...tableProps} columns={staColumns} />
      )}
      {activeTab === 'ST' && stOrdersStageLayout && (
        <DataTable {...tableProps} columns={stColumns} className="orders-table--st-stages" />
      )}
      {activeTab === 'Techniczne' && <DataTable {...tableProps} columns={techColumns} />}
    </div>
  )
}

/**
 * Pary do spiętrowania, gdy tabela reklamacji nie mieści się na ekranie
 * (klucz kolumny → klucz kolumny-matki) — jak ORDER_STACK w tabelach zamówień.
 */
const COMPLAINT_STACK: Record<string, string> = {
  production_day: 'order_date',
  height: 'width',
  opening: 'direction',
  frame_color: 'wing_color',
  threshold_color: 'wing_color',
  created_by: 'client_order_number',
  airtable_id: 'client_order_number',
  info: 'notes',
  disting_sheet: 'sta_sheet',
  top_light_glazing: 'top_light',
  side_panel_glazing: 'side_panel',
  decorative_panel: 'glazing',
  intarsja: 'glazing',
}

const withComplaintStacking = (cols: DataTableColumn<Complaint>[]): DataTableColumn<Complaint>[] =>
  cols.map((c) => (COMPLAINT_STACK[c.key] && !c.stackUnder ? { ...c, stackUnder: COMPLAINT_STACK[c.key] } : c))

const extraFlag = (c: Complaint, flag: string): boolean =>
  typeof c.extra_fields === 'object' &&
  c.extra_fields !== null &&
  (c.extra_fields as Record<string, unknown>)[flag] === true

const isDistingCancelled = (c: Complaint) => extraFlag(c, 'disting_cancelled')
const isComplaintCancelled = (c: Complaint) => extraFlag(c, 'cancelled')

function complaintRowClass(c: Complaint): string {
  const distCancelled = isDistingCancelled(c)
  const rowReleased = !isReleaseDateEmpty(c.release_date)
  return [
    'orders-table-row',
    c.is_rush ? 'orders-table-row--priority' : '',
    distCancelled ? 'orders-table-row--partner-cancelled' : '',
    distCancelled ? 'orders-table-row--cancelled' : '',
    rowReleased ? 'orders-table-row--released' : '',
    rowReleased ? 'orders-table-row--completed' : '',
    isComplaintCancelled(c) ? 'orders-table-row--cancelled-own' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

// zwykła kolumna tekstowa: klasa na th/td, tooltip z wartości, sortowanie (domyślnie włączone)
function textCol(
  key: string,
  label: string,
  get: (c: Complaint) => string | number | null | undefined,
  className = 'col-order-text',
  sortable = true,
): DataTableColumn<Complaint> {
  return {
    key,
    label,
    title: label,
    className,
    tdTitle: (c) => orderCellTooltip(get(c)),
    sortValue: sortable ? get : undefined,
    render: (c) => get(c),
  }
}
