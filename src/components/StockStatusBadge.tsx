import { createPortal } from 'react-dom'
import { useRef, useEffect, useState } from 'react'
import type { GlassAllowance, Order } from '../types'
import { calcGlassIssueDim } from '../utils'

const PART_LABELS: Record<string, string> = {
  wing: 'Skrzydło',
  frame: 'Ościeżnica',
  hardware: 'Okucia bazowe',
  fittings: 'Okucia wykończeniowe',
  handle: 'Pochwyt',
  peephole: 'Wizjer',
  electric_strike: 'Elektrozaczep',
  glazing: 'Szklenie',
  decorative_panel: 'Panel dekoracyjny',
  other: 'Inne',
  top_light_glass: 'Szyba naświetla',
  side_panel_a_glass: 'Szyba dostawki A',
  side_panel_b_glass: 'Szyba dostawki B',
}

const partLabel = (p: string) => PART_LABELS[p] ?? p

interface StockIssue {
  type?: string
  part: string
  glazing?: string
  component_name?: string
  component_code?: string
  shortage?: number
  warehouse?: string
  raw_dim?: string
}

type Props = {
  status?: string | null
  issues?: Order['stock_issues']
  category?: string
  glassAllowances?: GlassAllowance[]
}

function StockStatusBadge({ status, issues, category, glassAllowances }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({
        top: rect.bottom + 4,
        left: rect.left,
      })
    }
  }, [open])

  if (!status || status === 'ok') return null
  const isNoRecipe = status === 'no_recipe'
  const isInsufficient = status === 'insufficient'
  const isPartialRecipe = status === 'partial_recipe'
  if (!isNoRecipe && !isInsufficient && !isPartialRecipe) return null

  return (
    <>
      <span
        ref={triggerRef}
        className="stock-badge-wrapper"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        <span
          className={`stock-badge ${isNoRecipe ? 'stock-badge--no-recipe' : 'stock-badge--insufficient'}`}
        >
          {isNoRecipe ? '?' : '⚠'}
        </span>
      </span>

      {open &&
        createPortal(
          <div
            className="stock-badge-tooltip"
            style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 10000 }}
            onClick={(e) => e.stopPropagation()}
          >
            {isNoRecipe && (
              <div className="stock-badge-tooltip-title">Brak pasujących receptur</div>
            )}
            {(isInsufficient || isPartialRecipe) && (
              <>
                {(() => {
                  const hasGlassIssue = (issues ?? []).some((i: StockIssue) => i.type === 'glass_not_received')
                  const hasShortage = (issues ?? []).some((i: StockIssue) => i.type === 'shortage' || !i.type)
                  const hasMissingRecipe = (issues ?? []).some((i: StockIssue) => i.type === 'missing_recipe')

                  let title = 'Niedobór magazynowy:'
                  if (hasMissingRecipe && (hasShortage || hasGlassIssue)) title = 'Niedobór i brak receptur:'
                  else if (hasMissingRecipe) title = 'Brak receptur:'
                  else if (hasGlassIssue && !hasShortage) title = 'Brak szkła:'
                  else if (hasGlassIssue && hasShortage) title = 'Niedobór i brak szkła:'

                  return <div className="stock-badge-tooltip-title">{title}</div>
                })()}
                <ul className="stock-badge-tooltip-list">
                  {(issues ?? []).map((i: StockIssue, idx) => {
                    if (i.type === 'missing_recipe') {
                      return (
                        <li key={idx}>
                          <strong>Brak receptury</strong>
                          <div className="stock-badge-tooltip-item-details">
                            część: {partLabel(i.part)}
                          </div>
                        </li>
                      )
                    }
                    if (i.type === 'glass_not_received') {
                      const dim =
                        category && glassAllowances
                          ? calcGlassIssueDim(i, category, glassAllowances)
                          : null
                      return (
                        <li key={idx}>
                          <strong>{partLabel(i.part)}</strong>
                          <div className="stock-badge-tooltip-item-details">
                            szyba nie została odebrana
                            {i.glazing && ` · ${i.glazing}`}
                            {dim && (
                              <>
                                <br />
                                wymiar: {dim.rawDim} · szyba: {dim.glassDim}
                              </>
                            )}
                          </div>
                        </li>
                      )
                    }
                    return (
                      <li key={idx}>
                        <strong>{i.component_name}</strong>
                        <div className="stock-badge-tooltip-item-details">
                          {i.component_code} · brakuje {i.shortage} szt
                          <br />
                          magazyn: {i.warehouse} · część: {partLabel(i.part)}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}

export default StockStatusBadge
