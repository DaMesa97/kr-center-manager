import { useCallback, useEffect, useLayoutEffect, type MutableRefObject } from 'react'
import ProductionStageCell from './ProductionStageCell'
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

  return (
    <div className="complaints-view">
      <div className="table-wrapper orders-table-wrapper" ref={tableWrapperRef}>
        {isManager && (
          <button type="button" className="btn btn-success" onClick={onAddComplaint}>
            + Nowa reklamacja
          </button>
        )}
        {(activeTab === 'STA' || activeTab === 'Disting' || activeTab === 'Bastion') && (
          <table className="orders-table">
            <thead>
              <tr>
                <th className="sticky-col sticky-1 col-order-number" title="NR. REKLAMACJI">
                  NR. REKLAMACJI
                </th>
                <th className="sticky-col sticky-2 col-order-number" title="NR. ZLECENIA">
                  NR. ZLECENIA
                </th>
                <th className="sticky-col sticky-3 col-company" title="FIRMA">
                  FIRMA
                </th>
                <th className="col-order-text col-order-date" title="DATA">
                  DATA
                </th>
                <th className="col-order-text" title="PRODUKCJA">
                  PRODUKCJA
                </th>
                <th className="col-order-text" title="ILOŚĆ">
                  ILOŚĆ
                </th>
                <th className="rush-cell" title="PILNE">
                  PILNE
                </th>
                <th className="col-order-text" title="CO REKLAMOWANE">
                  CO REKLAMOWANE
                </th>
                <th className="col-order-text" title="SYSTEM">
                  SYSTEM
                </th>
                <th className="col-order-text col-order-model" title="MODEL">
                  MODEL
                </th>
                <th className="col-order-text col-wing-color" title="KOLOR SKRZYDŁA">
                  KOLOR SKRZYDŁA
                </th>
                <th className="col-order-text col-frame-color" title="KOLOR OŚCIEŻNICY">
                  KOLOR OŚCIEŻNICY
                </th>
                <th className="col-order-text" title="KOLOR PROGU">
                  KOLOR PROGU
                </th>
                <th className="col-order-text" title="SZEROKOŚĆ">
                  SZEROKOŚĆ
                </th>
                <th className="col-order-text" title="KIERUNEK">
                  KIERUNEK
                </th>
                <th className="col-order-text" title="OTWIERANIE">
                  OTWIERANIE
                </th>
                <th className="col-order-text" title="WYSOKOŚĆ">
                  WYSOKOŚĆ
                </th>
                <th className="col-order-text" title="SZKLENIE">
                  SZKLENIE
                </th>
                <th className="col-order-text" title="PANEL DEKORACYJNY">
                  PANEL DEKORACYJNY
                </th>
                <th className="col-order-text" title="OKUCIA">
                  OKUCIA
                </th>
                <th className="col-order-text" title="POCHWYT">
                  POCHWYT
                </th>
                <th className="col-order-text" title="ELEKTROZACZEP">
                  ELEKTROZACZEP
                </th>
                <th className="col-order-text" title="WIZJER">
                  WIZJER
                </th>
                <th className="col-order-text" title="NAŚWIETLE GÓRNE">
                  NAŚWIETLE GÓRNE
                </th>
                <th className="col-order-text" title="SZKLENIE NAŚWIETLE GÓRNE">
                  SZKLENIE NAŚWIETLE GÓRNE
                </th>
                <th className="col-order-text" title="DOSTAWKA BOCZNA">
                  DOSTAWKA BOCZNA
                </th>
                <th className="col-order-text" title="SZKLENIE DOSTAWKA BOCZNA">
                  SZKLENIE DOSTAWKA BOCZNA
                </th>
                <th className="col-order-text" title="POSZERZENIE">
                  POSZERZENIE
                </th>
                {orderStageColumnDefs.map((def) => (
                  <th
                    key={def.key}
                    className="production-stage-th col-stage"
                    title={def.title ?? def.header}
                  >
                    {def.header}
                  </th>
                ))}
                {activeTab === 'STA' && (
                  <th
                    className="production-stage-th sta-osc-pack-th col-osc-pack"
                    title="Ościeżnica (snapshot z koloru ościeżnicy reklamacji)"
                  >
                    OŚC.
                  </th>
                )}
                <th className="col-order-text release-date-th" title="WYDANIE">
                  WYDANIE
                </th>
                <th className="col-order-text" title="NR. W ARKUSZU STA">
                  NR. W ARKUSZU STA
                </th>
                <th className="col-order-text" title="NR. W ARKUSZU DISTING">
                  NR. W ARKUSZU DISTING
                </th>
                <th className="col-notes" title="UWAGI">
                  UWAGI
                </th>
                <th className="col-order-text" title="NUMER ZAMÓWIENIA KLIENTA">
                  NUMER ZAMÓWIENIA KLIENTA
                </th>
                <th className="col-order-text" title="BRAKI">
                  BRAKI
                </th>
                <th className="col-order-text" title="WPISAŁ">
                  WPISAŁ
                </th>
                <th className="col-order-text" title="WARTOŚĆ KONFIGURATOR">
                  WARTOŚĆ KONFIGURATOR
                </th>
                <th className="col-order-text" title="INFO">
                  INFO
                </th>
                <th className="col-order-text" title="AIRTABLE ID">
                  AIRTABLE ID
                </th>
                <th className="col-order-text" title="ETYKIETA">
                  ETYKIETA
                </th>
                <th className="col-order-text" title="POWÓD REKLAMACJI">
                  POWÓD REKLAMACJI
                </th>
                {isManager && (
                  <th className="col-order-actions" title="Akcje">
                    Akcje
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredComplaints.length === 0 ? (
                <tr>
                  <td
                    colSpan={
                      29 + orderStageColumnDefs.length + (activeTab === 'STA' ? 1 : 0) + 11 + (isManager ? 1 : 0)
                    }
                    style={{ textAlign: 'center', padding: '2rem', color: '#888' }}
                  >
                    Brak reklamacji
                  </td>
                </tr>
              ) : (
                filteredComplaints.map((c) => {
                  const rowStages = parseProductionStages(c.production_stages, c.category)
                  const blockedKeys = getComplaintBlockedStages(
                    c.category,
                    c.what_complained as WhatComplained | '',
                    c.linked_complaint_id,
                  )
                  const distPartner =
                    c.linked_complaint_id != null
                      ? linkedComplaints.find((lc) => lc.id === c.linked_complaint_id)
                      : undefined
                  const distStages = distPartner
                    ? parseProductionStages(distPartner.production_stages, 'Disting')
                    : ({} as Record<string, string>)
                  const rushRow = c.is_rush
                  const rowReleased = !isReleaseDateEmpty(c.release_date)
                  const efRow = c.extra_fields
                  const distCancelled =
                    typeof efRow === 'object' &&
                    efRow !== null &&
                    (efRow as Record<string, unknown>).disting_cancelled === true
                  const isComplaintCancelled =
                    typeof c.extra_fields === 'object' &&
                    c.extra_fields !== null &&
                    (c.extra_fields as Record<string, unknown>).cancelled === true
                  return (
                    <tr
                      key={c.id ?? c.complaint_number}
                      className={[
                        'orders-table-row',
                        rushRow ? 'orders-table-row--priority' : '',
                        distCancelled ? 'orders-table-row--partner-cancelled' : '',
                        distCancelled ? 'orders-table-row--cancelled' : '',
                        rowReleased ? 'orders-table-row--released' : '',
                        rowReleased ? 'orders-table-row--completed' : '',
                        isComplaintCancelled ? 'orders-table-row--cancelled-own' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <td
                        className="sticky-col sticky-1 col-order-number"
                        title={orderCellTooltip(c.complaint_number)}
                      >
                        {activeTab === 'STA' &&
                          c.category === 'STA' &&
                          (() => {
                            const ef = c.extra_fields
                            const partnerCancelled =
                              typeof ef === 'object' &&
                              ef !== null &&
                              (ef as Record<string, unknown>).disting_cancelled === true
                            if (!partnerCancelled) return null
                            return (
                              <div className="orders-table-row-cancelled-badge">ANULOWANO W DISTING</div>
                            )
                          })()}
                        <span className="order-num-value">{c.complaint_number}</span>
                      </td>
                      <td
                        className="sticky-col sticky-2 col-order-number"
                        title={orderCellTooltip(c.order_number)}
                      >
                        {rowReleased ? (
                          <span className="released-badge order-badge" title="Zrealizowane (wydanie)">
                            ZREALIZOWANE
                          </span>
                        ) : null}
                        <span className="order-num-value">{c.order_number}</span>
                      </td>
                      <td className="sticky-col sticky-3 col-company" title={orderCellTooltip(c.company)}>
                        {c.company}
                      </td>
                      <td className="col-order-text col-order-date" title={orderCellTooltip(c.order_date)}>
                        {c.order_date}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.production_day)}>
                        {c.production_day}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.quantity)}>
                        {c.quantity}
                      </td>
                      <td className="rush-cell" onClick={(e) => e.stopPropagation()}>
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
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.what_complained)}>
                        {c.what_complained}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.system)}>
                        {c.system}
                      </td>
                      <td className="col-order-text col-order-model" title={orderCellTooltip(c.model)}>
                        {c.model}
                      </td>
                      <td className="col-order-text col-wing-color" title={orderCellTooltip(c.wing_color)}>
                        {c.wing_color}
                      </td>
                      <td className="col-order-text col-frame-color" title={orderCellTooltip(c.frame_color)}>
                        {c.frame_color}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.threshold_color)}>
                        {c.threshold_color}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.width)}>
                        {c.width}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.direction)}>
                        {c.direction}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.opening)}>
                        {c.opening}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.height)}>
                        {c.height}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.glazing)}>
                        {c.glazing}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.decorative_panel)}>
                        {c.decorative_panel}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.hardware)}>
                        {c.hardware}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.handle)}>
                        {c.handle}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.electric_strike)}>
                        {c.electric_strike}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.peephole)}>
                        {c.peephole}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.top_light)}>
                        {c.top_light}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.top_light_glazing)}>
                        {c.top_light_glazing}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.side_panel)}>
                        {c.side_panel}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.side_panel_glazing)}>
                        {c.side_panel_glazing}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.extension)}>
                        {c.extension}
                      </td>
                      {orderStageColumnDefs.map((def) => {
                        const value = rowStages[def.key] ?? ''
                        const isBlocked = blockedKeys.includes(def.key)
                        const linkedPlus = c.linked_complaint_id != null
                        const staMirrorKey =
                          activeTab === 'STA' && c.category === 'STA' && linkedPlus
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
                          return (
                            <td
                              key={def.key}
                              className="production-stage-td col-stage"
                              title={filled ? mirrorVal : staDistingPlusMirrorTitle(def.key)}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span
                                className={[
                                  'production-stage-readonly',
                                  filled
                                    ? 'production-stage-readonly--linked-done'
                                    : 'production-stage-readonly--linked-empty',
                                ].join(' ')}
                                title={staDistingPlusMirrorTitle(def.key)}
                              >
                                {filled ? mirrorVal : '—'}
                              </span>
                            </td>
                          )
                        }

                        if (isBlocked) {
                          return (
                            <td
                              key={def.key}
                              className="production-stage-td col-stage"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span
                                className={[
                                  'production-stage-readonly',
                                  value.trim()
                                    ? 'production-stage-readonly--linked-done'
                                    : 'production-stage-readonly--linked-empty',
                                ].join(' ')}
                                title={
                                  c.category === 'Disting' && c.linked_complaint_id != null
                                    ? distingPlusMirrorTitle(def.key)
                                    : undefined
                                }
                              >
                                {value.trim() ? value.trim() : '—'}
                              </span>
                            </td>
                          )
                        }
                        return (
                          <td
                            key={def.key}
                            className="production-stage-td col-stage"
                            title={value.trim() ? value.trim() : undefined}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ProductionStageCell
                              value={value}
                              disabled={!isManager || c.id === undefined || isComplaintCancelled}
                              onPickEmpty={() => {
                                if (c.id === undefined) return
                                void onComplaintStageClick(c.id, def.key, rowStages, c.category)
                              }}
                              onPickFilled={() => {
                                if (c.id === undefined) return
                                void onComplaintStageClick(c.id, def.key, rowStages, c.category)
                              }}
                            />
                          </td>
                        )
                      })}
                      {activeTab === 'STA' && (
                        <td
                          className="production-stage-td sta-osc-pack-td col-osc-pack"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {c.linked_complaint_id != null
                            ? (() => {
                                const oscInitials = String(c.frame_color ?? '').trim()
                                const oscDone = Boolean(oscInitials)
                                return (
                                  <span
                                    className={
                                      oscDone
                                        ? 'sta-osc-badge sta-osc-badge--done'
                                        : 'sta-osc-badge sta-osc-badge--wait'
                                    }
                                    title={
                                      oscDone
                                        ? 'Ościeżnica spakowana do transportu'
                                        : 'Oczekiwanie na pakowanie ościeżnicy w Disting (E5)'
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
                              })()
                            : '\u00a0'}
                        </td>
                      )}
                      <td
                        className="release-date-td col-order-text"
                        title={
                          isReleaseDateEmpty(c.release_date)
                            ? undefined
                            : String(c.release_date ?? '').trim() || undefined
                        }
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isReleaseDateEmpty(c.release_date) ? (
                          <span className="release-date-placeholder">—</span>
                        ) : (
                          <span className="release-date-value release-date-value--readonly">
                            {String(c.release_date).trim()}
                          </span>
                        )}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.sta_sheet)}>
                        {String(c.sta_sheet ?? '').trim() || '—'}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.disting_sheet)}>
                        {String(c.disting_sheet ?? '').trim() || '—'}
                      </td>
                      <td className="col-notes" title={orderCellTooltip(c.notes)}>
                        {c.notes}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.client_order_number)}>
                        {c.client_order_number}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.defects)}>
                        {c.defects}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.created_by)}>
                        {c.created_by}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.configurator_value)}>
                        {c.configurator_value}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.info)}>
                        {c.info}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.airtable_id)}>
                        {c.airtable_id}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.label)}>
                        {c.label}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.reason)}>
                        {c.reason}
                      </td>
                      {isManager &&
                        c.id !== undefined &&
                        (() => {
                          const ef = c.extra_fields
                          const isCancelled =
                            typeof ef === 'object' &&
                            ef !== null &&
                            (ef as Record<string, unknown>).cancelled === true
                          return (
                            <td className="col-order-actions" onClick={(e) => e.stopPropagation()}>
                              {!isCancelled && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-danger"
                                  onClick={() => onCancelComplaint(c)}
                                >
                                  Anuluj
                                </button>
                              )}
                              {isCancelled && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-primary"
                                  onClick={() => void onRestoreComplaint(c)}
                                >
                                  Przywróć
                                </button>
                              )}
                            </td>
                          )
                        })()}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        )}
        {activeTab === 'ST' && stOrdersStageLayout && (
          <table className="orders-table orders-table--st-stages">
            <thead>
              <tr>
                <th className="sticky-col sticky-1 col-order-number" title="NR. REKLAMACJI">
                  NR. REKLAMACJI
                </th>
                <th className="sticky-col sticky-2 col-order-number" title="NR. ZLECENIA">
                  NR. ZLECENIA
                </th>
                <th className="sticky-col sticky-3 col-company" title="FIRMA">
                  FIRMA
                </th>
                <th className="col-order-text col-order-date" title="DATA">
                  DATA
                </th>
                <th className="col-order-text" title="PRODUKCJA">
                  PRODUKCJA
                </th>
                <th className="col-order-text" title="ILOŚĆ">
                  ILOŚĆ
                </th>
                <th className="rush-cell" title="PILNE">
                  PILNE
                </th>
                <th className="col-order-text" title="CO REKLAMOWANE">
                  CO REKLAMOWANE
                </th>
                <th className="col-order-text" title="SYSTEM">
                  SYSTEM
                </th>
                <th className="col-order-text" title="MODEL">
                  MODEL
                </th>
                <th className="col-order-text" title="KOLOR">
                  KOLOR
                </th>
                <th className="col-order-text" title="SZEROKOŚĆ">
                  SZEROKOŚĆ
                </th>
                <th className="col-order-text" title="KIERUNEK">
                  KIERUNEK
                </th>
                <th className="col-order-text" title="OTWIERANIE">
                  OTWIERANIE
                </th>
                <th className="col-order-text" title="WYSOKOŚĆ">
                  WYSOKOŚĆ
                </th>
                <th className="col-order-text" title="SZKLENIE">
                  SZKLENIE
                </th>
                <th className="col-order-text" title="OKUCIA">
                  OKUCIA
                </th>
                <th className="col-order-text" title="POCHWYT">
                  POCHWYT
                </th>
                <th className="col-order-text" title="WIZJER">
                  WIZJER
                </th>
                {stOrdersStageLayout.defs.map((def) => (
                  <th key={def.key} className="production-stage-th col-stage" title={def.title}>
                    {def.header}
                  </th>
                ))}
                {(stOrdersStageLayout.mode === 'titan' || stOrdersStageLayout.mode === 'mixed') && (
                  <th
                    className="production-stage-th sta-osc-pack-th col-osc-pack"
                    title="Skrzydło spakowane w STA (E5)"
                  >
                    SKR ✓
                  </th>
                )}
                <th className="col-order-text" title="WYDANIE">
                  WYDANIE
                </th>
                <th className="col-order-text" title="INFO">
                  INFO
                </th>
                <th className="col-order-text" title="UWAGI">
                  UWAGI
                </th>
                <th className="col-order-text" title="NUMER ZAMÓWIENIA KLIENTA">
                  NUMER ZAMÓWIENIA KLIENTA
                </th>
                <th className="col-order-text" title="WPISAŁ">
                  WPISAŁ
                </th>
                <th className="col-order-text" title="WARTOŚĆ KONFIGURATOR">
                  WARTOŚĆ KONFIGURATOR
                </th>
                <th className="col-order-text" title="AIRTABLE ID">
                  AIRTABLE ID
                </th>
                <th className="col-order-text" title="NR W ARKUSZU STA">
                  NR W ARKUSZU STA
                </th>
                <th className="col-order-text" title="POWÓD REKLAMACJI">
                  POWÓD REKLAMACJI
                </th>
                {isManager && <th className="col-order-actions">Akcje</th>}
              </tr>
            </thead>
            <tbody>
              {filteredComplaints.length === 0 ? (
                <tr>
                  <td
                    colSpan={
                      3 +
                      15 +
                      stOrdersStageLayout.defs.length +
                      (stOrdersStageLayout.mode === 'titan' || stOrdersStageLayout.mode === 'mixed'
                        ? 1
                        : 0) +
                      10 +
                      (isManager ? 1 : 0)
                    }
                    style={{ textAlign: 'center', padding: '2rem', color: '#888' }}
                  >
                    Brak reklamacji
                  </td>
                </tr>
              ) : (
                filteredComplaints.map((c) => {
                  const rowStages = parseProductionStages(c.production_stages, 'ST')
                  const stLayoutMode = stOrdersStageLayout.mode
                  const stDefs = stOrdersStageLayout.defs
                  const isTitanSt = isStTitanComplaint(c)
                  const rushRow = c.is_rush
                  const rowReleased = !isReleaseDateEmpty(c.release_date)
                  const efRow = c.extra_fields
                  const distCancelled =
                    typeof efRow === 'object' &&
                    efRow !== null &&
                    (efRow as Record<string, unknown>).disting_cancelled === true
                  const isComplaintCancelled =
                    typeof c.extra_fields === 'object' &&
                    c.extra_fields !== null &&
                    (c.extra_fields as Record<string, unknown>).cancelled === true
                  return (
                    <tr
                      key={c.id ?? c.complaint_number}
                      className={[
                        'orders-table-row',
                        rushRow ? 'orders-table-row--priority' : '',
                        distCancelled ? 'orders-table-row--partner-cancelled' : '',
                        distCancelled ? 'orders-table-row--cancelled' : '',
                        rowReleased ? 'orders-table-row--released' : '',
                        rowReleased ? 'orders-table-row--completed' : '',
                        isComplaintCancelled ? 'orders-table-row--cancelled-own' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <td
                        className="sticky-col sticky-1 col-order-number"
                        title={orderCellTooltip(c.complaint_number)}
                      >
                        <span className="order-num-value">{c.complaint_number}</span>
                      </td>
                      <td
                        className="sticky-col sticky-2 col-order-number"
                        title={orderCellTooltip(c.order_number)}
                      >
                        {rowReleased ? (
                          <span className="released-badge order-badge" title="Zrealizowane (wydanie)">
                            ZREALIZOWANE
                          </span>
                        ) : null}
                        <span className="order-num-value">{c.order_number}</span>
                      </td>
                      <td className="sticky-col sticky-3 col-company" title={orderCellTooltip(c.company)}>
                        {c.company}
                      </td>
                      <td className="col-order-text col-order-date" title={orderCellTooltip(c.order_date)}>
                        {c.order_date}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.production_day)}>
                        {c.production_day}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.quantity)}>
                        {c.quantity}
                      </td>
                      <td className="rush-cell" onClick={(e) => e.stopPropagation()}>
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
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.what_complained)}>
                        {c.what_complained}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.system)}>
                        {c.system}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.model)}>
                        {c.model}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.wing_color)}>
                        {c.wing_color}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.width)}>
                        {c.width}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.direction)}>
                        {c.direction}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.opening)}>
                        {c.opening}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.height)}>
                        {c.height}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.glazing)}>
                        {c.glazing}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.hardware)}>
                        {c.hardware}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.handle)}>
                        {c.handle}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.peephole)}>
                        {c.peephole}
                      </td>
                      {stDefs.map((def) => {
                        const cellKind = stStageCellKind(def, isTitanSt, stLayoutMode)
                        if (cellKind.kind === 'none') {
                          return (
                            <td
                              key={def.key}
                              className="production-stage-td col-stage"
                              onClick={(e) => e.stopPropagation()}
                            >
                              —
                            </td>
                          )
                        }
                        if (cellKind.kind === 'skr_badge') {
                          const skrInitials = String(rowStages.sta_e5 ?? '').trim()
                          const skrDone = Boolean(skrInitials)
                          return (
                            <td
                              key={def.key}
                              className="production-stage-td sta-osc-pack-td col-osc-pack"
                              title={
                                skrDone
                                  ? 'Skrzydło spakowane w STA (E5)'
                                  : 'Oczekiwanie na pakowanie skrzydła w STA (E5)'
                              }
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span
                                className={
                                  skrDone
                                    ? 'st-skr-pack-badge st-skr-pack-badge--done'
                                    : 'st-skr-pack-badge st-skr-pack-badge--wait'
                                }
                              >
                                {skrDone ? (
                                  <>
                                    SKR ✓ <span className="sta-osc-badge-initials">{skrInitials}</span>
                                  </>
                                ) : (
                                  'SKR —'
                                )}
                              </span>
                            </td>
                          )
                        }
                        if (cellKind.kind === 'e2_sta') {
                          const e2Val = String(rowStages.sta_e5 ?? '').trim()
                          const filled = Boolean(e2Val)
                          return (
                            <td
                              key={def.key}
                              className="production-stage-td col-stage"
                              title={filled ? e2Val : 'Status z arkusza STA (E5)'}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span
                                className={[
                                  'production-stage-readonly',
                                  filled
                                    ? 'production-stage-readonly--linked-done'
                                    : 'production-stage-readonly--linked-empty',
                                ].join(' ')}
                                title="E2 — skrzydło odebrane (STA E5)"
                              >
                                {filled ? e2Val : '—'}
                              </span>
                            </td>
                          )
                        }
                        const stageKey = cellKind.stageKey
                        const blockedKeys = getComplaintBlockedStages(
                          'ST',
                          c.what_complained as WhatComplained | '',
                          c.linked_complaint_id,
                        )
                        const isBlocked = blockedKeys.includes(stageKey)
                        return (
                          <td
                            key={def.key}
                            className="production-stage-td col-stage"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ProductionStageCell
                              value={rowStages[stageKey] ?? ''}
                              disabled={
                                !isManager || c.id === undefined || isBlocked || isComplaintCancelled
                              }
                              onPickEmpty={() => {
                                if (c.id === undefined) return
                                void onComplaintStageClick(c.id, stageKey, rowStages, 'ST')
                              }}
                              onPickFilled={() => {
                                if (c.id === undefined) return
                                void onComplaintStageClick(c.id, stageKey, rowStages, 'ST')
                              }}
                            />
                          </td>
                        )
                      })}
                      {stLayoutMode === 'titan' &&
                        (() => {
                          const skrInitials = String(rowStages.sta_e5 ?? '').trim()
                          const skrDone = Boolean(skrInitials)
                          return (
                            <td
                              className="production-stage-td sta-osc-pack-td col-osc-pack"
                              title={
                                skrDone
                                  ? 'Skrzydło spakowane w STA (E5)'
                                  : 'Oczekiwanie na pakowanie skrzydła w STA (E5)'
                              }
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span
                                className={
                                  skrDone
                                    ? 'st-skr-pack-badge st-skr-pack-badge--done'
                                    : 'st-skr-pack-badge st-skr-pack-badge--wait'
                                }
                              >
                                {skrDone ? (
                                  <>
                                    SKR ✓ <span className="sta-osc-badge-initials">{skrInitials}</span>
                                  </>
                                ) : (
                                  'SKR —'
                                )}
                              </span>
                            </td>
                          )
                        })()}
                      {stLayoutMode === 'mixed' &&
                        (() => {
                          const skrInitials = String(rowStages.sta_e5 ?? '').trim()
                          const skrDone = Boolean(skrInitials)
                          if (!isTitanSt) {
                            return (
                              <td
                                className="production-stage-td sta-osc-pack-td col-osc-pack"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {'\u00a0'}
                              </td>
                            )
                          }
                          return (
                            <td
                              className="production-stage-td sta-osc-pack-td col-osc-pack"
                              title={
                                skrDone
                                  ? 'Skrzydło spakowane w STA (E5)'
                                  : 'Oczekiwanie na pakowanie skrzydła w STA (E5)'
                              }
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span
                                className={
                                  skrDone
                                    ? 'st-skr-pack-badge st-skr-pack-badge--done'
                                    : 'st-skr-pack-badge st-skr-pack-badge--wait'
                                }
                              >
                                {skrDone ? (
                                  <>
                                    SKR ✓ <span className="sta-osc-badge-initials">{skrInitials}</span>
                                  </>
                                ) : (
                                  'SKR —'
                                )}
                              </span>
                            </td>
                          )
                        })()}
                      <td
                        className="release-date-td col-order-text"
                        title={
                          isReleaseDateEmpty(c.release_date)
                            ? undefined
                            : String(c.release_date ?? '').trim() || undefined
                        }
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isReleaseDateEmpty(c.release_date) ? (
                          <span className="release-date-placeholder">—</span>
                        ) : (
                          <span className="release-date-value release-date-value--readonly">
                            {String(c.release_date).trim()}
                          </span>
                        )}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.info)}>
                        {c.info}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.notes)}>
                        {c.notes}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.client_order_number)}>
                        {c.client_order_number}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.created_by)}>
                        {c.created_by}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.configurator_value)}>
                        {c.configurator_value}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.airtable_id)}>
                        {c.airtable_id}
                      </td>
                      <td className="col-order-text" onClick={(e) => e.stopPropagation()}>
                        {String(c.sta_sheet ?? '').trim() || '—'}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.reason)}>
                        {c.reason}
                      </td>
                      {isManager &&
                        c.id !== undefined &&
                        (() => {
                          const ef = c.extra_fields
                          const isCancelled =
                            typeof ef === 'object' &&
                            ef !== null &&
                            (ef as Record<string, unknown>).cancelled === true
                          return (
                            <td className="col-order-actions" onClick={(e) => e.stopPropagation()}>
                              {!isCancelled && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-danger"
                                  onClick={() => onCancelComplaint(c)}
                                >
                                  Anuluj
                                </button>
                              )}
                              {isCancelled && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-primary"
                                  onClick={() => void onRestoreComplaint(c)}
                                >
                                  Przywróć
                                </button>
                              )}
                            </td>
                          )
                        })()}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        )}
        {activeTab === 'Techniczne' && (
          <table className="orders-table">
            <thead>
              <tr>
                <th className="sticky-col sticky-1 col-order-number" title="NR. REKLAMACJI">
                  NR. REKLAMACJI
                </th>
                <th className="sticky-col sticky-2 col-order-number" title="NR. ZLECENIA">
                  NR. ZLECENIA
                </th>
                <th className="sticky-col sticky-3 col-company" title="FIRMA">
                  FIRMA
                </th>
                <th className="col-order-text col-order-date" title="DATA">
                  DATA
                </th>
                <th className="col-order-text" title="PRODUKCJA">
                  PRODUKCJA
                </th>
                <th className="col-order-text" title="ILOŚĆ">
                  ILOŚĆ
                </th>
                <th className="rush-cell" title="PILNE">
                  PILNE
                </th>
                <th className="col-order-text" title="CO REKLAMOWANE">
                  CO REKLAMOWANE
                </th>
                <th className="col-order-text" title="SYSTEM">
                  SYSTEM
                </th>
                <th className="col-order-text" title="MODEL">
                  MODEL
                </th>
                <th className="col-order-text" title="KOLOR">
                  KOLOR
                </th>
                <th className="col-order-text" title="PRÓG">
                  PRÓG
                </th>
                <th className="col-order-text" title="SZEROKOŚĆ">
                  SZEROKOŚĆ
                </th>
                <th className="col-order-text" title="KIERUNEK">
                  KIERUNEK
                </th>
                <th className="col-order-text" title="OTWIERANIE">
                  OTWIERANIE
                </th>
                <th className="col-order-text" title="WYSOKOŚĆ">
                  WYSOKOŚĆ
                </th>
                <th className="col-order-text" title="SZKLENIE">
                  SZKLENIE
                </th>
                <th className="col-order-text" title="OKUCIA">
                  OKUCIA
                </th>
                <th className="col-order-text" title="POCHWYT">
                  POCHWYT
                </th>
                <th className="col-order-text" title="WIZJER">
                  WIZJER
                </th>
                <th className="col-order-text" title="WYDANIE">
                  WYDANIE
                </th>
                <th className="col-order-text" title="INFO">
                  INFO
                </th>
                <th className="col-order-text" title="UWAGI">
                  UWAGI
                </th>
                <th className="col-order-text" title="NUMER ZAMÓWIENIA KLIENTA">
                  NUMER ZAMÓWIENIA KLIENTA
                </th>
                <th className="col-order-text" title="WPISAŁ">
                  WPISAŁ
                </th>
                <th className="col-order-text" title="POWÓD REKLAMACJI">
                  POWÓD REKLAMACJI
                </th>
                {isManager && <th className="col-order-actions">Akcje</th>}
              </tr>
            </thead>
            <tbody>
              {filteredComplaints.length === 0 ? (
                <tr>
                  <td
                    colSpan={3 + 23 + (isManager ? 1 : 0)}
                    style={{ textAlign: 'center', padding: '2rem', color: '#888' }}
                  >
                    Brak reklamacji
                  </td>
                </tr>
              ) : (
                filteredComplaints.map((c) => {
                  const rushRow = c.is_rush
                  const rowReleased = !isReleaseDateEmpty(c.release_date)
                  const efRow = c.extra_fields
                  const distCancelled =
                    typeof efRow === 'object' &&
                    efRow !== null &&
                    (efRow as Record<string, unknown>).disting_cancelled === true
                  const isComplaintCancelled =
                    typeof c.extra_fields === 'object' &&
                    c.extra_fields !== null &&
                    (c.extra_fields as Record<string, unknown>).cancelled === true
                  return (
                    <tr
                      key={c.id ?? c.complaint_number}
                      className={[
                        'orders-table-row',
                        rushRow ? 'orders-table-row--priority' : '',
                        distCancelled ? 'orders-table-row--partner-cancelled' : '',
                        distCancelled ? 'orders-table-row--cancelled' : '',
                        rowReleased ? 'orders-table-row--released' : '',
                        rowReleased ? 'orders-table-row--completed' : '',
                        isComplaintCancelled ? 'orders-table-row--cancelled-own' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <td
                        className="sticky-col sticky-1 col-order-number"
                        title={orderCellTooltip(c.complaint_number)}
                      >
                        <span className="order-num-value">{c.complaint_number}</span>
                      </td>
                      <td
                        className="sticky-col sticky-2 col-order-number"
                        title={orderCellTooltip(c.order_number)}
                      >
                        {rowReleased ? (
                          <span className="released-badge order-badge" title="Zrealizowane (wydanie)">
                            ZREALIZOWANE
                          </span>
                        ) : null}
                        <span className="order-num-value">{c.order_number}</span>
                      </td>
                      <td className="sticky-col sticky-3 col-company" title={orderCellTooltip(c.company)}>
                        {c.company}
                      </td>
                      <td className="col-order-text col-order-date" title={orderCellTooltip(c.order_date)}>
                        {c.order_date}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.production_day)}>
                        {c.production_day}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.quantity)}>
                        {c.quantity}
                      </td>
                      <td className="rush-cell" onClick={(e) => e.stopPropagation()}>
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
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.what_complained)}>
                        {c.what_complained}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.system)}>
                        {c.system}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.model)}>
                        {c.model}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.wing_color)}>
                        {c.wing_color}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.threshold_color)}>
                        {c.threshold_color}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.width)}>
                        {c.width}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.direction)}>
                        {c.direction}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.opening)}>
                        {c.opening}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.height)}>
                        {c.height}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.glazing)}>
                        {c.glazing}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.hardware)}>
                        {c.hardware}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.handle)}>
                        {c.handle}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.peephole)}>
                        {c.peephole}
                      </td>
                      <td
                        className="release-date-td col-order-text"
                        title={
                          isReleaseDateEmpty(c.release_date)
                            ? undefined
                            : String(c.release_date ?? '').trim() || undefined
                        }
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isReleaseDateEmpty(c.release_date) ? (
                          <span className="release-date-placeholder">—</span>
                        ) : (
                          <span className="release-date-value release-date-value--readonly">
                            {String(c.release_date).trim()}
                          </span>
                        )}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.info)}>
                        {c.info}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.notes)}>
                        {c.notes}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.client_order_number)}>
                        {c.client_order_number}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.created_by)}>
                        {c.created_by}
                      </td>
                      <td className="col-order-text" title={orderCellTooltip(c.reason)}>
                        {c.reason}
                      </td>
                      {isManager &&
                        c.id !== undefined &&
                        (() => {
                          const ef = c.extra_fields
                          const isCancelled =
                            typeof ef === 'object' &&
                            ef !== null &&
                            (ef as Record<string, unknown>).cancelled === true
                          return (
                            <td className="col-order-actions" onClick={(e) => e.stopPropagation()}>
                              {!isCancelled && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-danger"
                                  onClick={() => onCancelComplaint(c)}
                                >
                                  Anuluj
                                </button>
                              )}
                              {isCancelled && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-primary"
                                  onClick={() => void onRestoreComplaint(c)}
                                >
                                  Przywróć
                                </button>
                              )}
                            </td>
                          )
                        })()}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
