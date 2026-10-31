import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { emptyBastionExtraForm, type BastionExtra, type BastionExtraForm, bastionExtraToForm } from '../lib/bastionExtras'
import type { Company } from '../types'

type Props = {
  open: boolean
  /** edycja — null = nowa pozycja */
  extra: BastionExtra | null
  companies: Company[]
  /** słowniki Bastion: system, kolor_oscieznicy (z Konfiguracji) */
  systems: string[]
  colors: string[]
  busy: boolean
  onClose: () => void
  onSave: (form: BastionExtraForm) => Promise<boolean>
}

const DAYS = ['PONIEDZIAŁEK', 'WTOREK', 'ŚRODA', 'CZWARTEK', 'PIĄTEK']
const PRESETS = ['PRÓG BOLD 60', 'PRÓG BOLD 150 BEZ USZCZELKI', 'OPASKI 40mm', 'OPASKI 50mm', 'OPASKI ZAM. OŚC. REG.', 'ZAB. KĄTOWA 150']

/** Formularz pozycji „Reszty": bez modelu i wymiarów drzwi — opis, kolor, szer./strona, system, ilość, do zlecenia. */
export default function BastionExtraModal({ open, extra, companies, systems, colors, busy, onClose, onSave }: Props) {
  const [form, setForm] = useState<BastionExtraForm>(emptyBastionExtraForm())
  const [companyQuery, setCompanyQuery] = useState('')

  useEffect(() => {
    if (!open) return
    setForm(extra ? bastionExtraToForm(extra) : emptyBastionExtraForm())
    setCompanyQuery('')
  }, [open, extra])

  const set = <K extends keyof BastionExtraForm>(k: K, v: BastionExtraForm[K]) => setForm((p) => ({ ...p, [k]: v }))

  const companyMatches = useMemo(() => {
    const q = companyQuery.trim().toLowerCase()
    if (q.length < 2) return []
    return companies.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8)
  }, [companies, companyQuery])

  const pickCompany = (c: Company) => {
    setForm((p) => ({ ...p, company: c.name, production_day: (c.production_day || p.production_day || '').toUpperCase() }))
    setCompanyQuery('')
  }

  const canSave = form.description.trim() !== '' && form.quantity > 0 && !busy

  if (!open) return null
  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="order-modal bastion-extra-modal" onClick={(e) => e.stopPropagation()} style={{ width: '92vw', maxWidth: 860 }}>
        <div className="order-modal-header">
          <h2>{extra ? `Reszta ${extra.extra_no} — edycja` : 'Reszta — nowa pozycja'}</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose}>
            X
          </button>
        </div>
        <div className="order-form-grid order-form-grid--sta">
          <label style={{ gridColumn: '1 / -1', position: 'relative' }}>
            <span className="order-field-label-text">Firma</span>
            <input
              type="text"
              value={companyQuery || form.company}
              placeholder="zacznij pisać nazwę kontrahenta…"
              onChange={(e) => {
                setCompanyQuery(e.target.value)
                set('company', e.target.value)
              }}
              autoComplete="off"
            />
            {companyMatches.length > 0 && (
              <ul className="bastion-extra-suggest">
                {companyMatches.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => pickCompany(c)}>
                      {c.name}
                      <span className="muted"> · {c.city} · prod. {c.production_day || '—'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </label>
          <label>
            <span className="order-field-label-text">Dzień produkcji</span>
            <select value={form.production_day} onChange={(e) => set('production_day', e.target.value)}>
              <option value="">—</option>
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="order-field-label-text">Data zamówienia</span>
            <input type="date" value={form.order_date} onChange={(e) => set('order_date', e.target.value)} />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            <span className="order-field-label-text">Co zamówiono *</span>
            <input
              type="text"
              list="bastion-extra-presets"
              value={form.description}
              placeholder="np. PRÓG BOLD 150 BEZ USZCZELKI, OPASKI 40mm, ZAB. KĄTOWA 150"
              onChange={(e) => set('description', e.target.value)}
            />
            <datalist id="bastion-extra-presets">
              {PRESETS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>
          <label>
            <span className="order-field-label-text">Kolor</span>
            <input type="text" list="bastion-extra-colors" value={form.color} onChange={(e) => set('color', e.target.value)} />
            <datalist id="bastion-extra-colors">
              {colors.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label>
            <span className="order-field-label-text">Szer. / strona</span>
            <input type="text" value={form.width_side} placeholder="np. 90, LEWE" onChange={(e) => set('width_side', e.target.value)} />
          </label>
          <label>
            <span className="order-field-label-text">System</span>
            <input type="text" list="bastion-extra-systems" value={form.system} onChange={(e) => set('system', e.target.value)} />
            <datalist id="bastion-extra-systems">
              {systems.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label>
            <span className="order-field-label-text">Ilość *</span>
            <input type="number" min={1} step={1} value={form.quantity} onChange={(e) => set('quantity', Math.max(1, Number(e.target.value) || 1))} />
          </label>
          <label>
            <span className="order-field-label-text">Do zlecenia nr (KR Center)</span>
            <input type="text" value={form.order_ref} placeholder="np. 7154-7155, MR BOLD 528" onChange={(e) => set('order_ref', e.target.value)} />
          </label>
          <label>
            <span className="order-field-label-text">Nr zamówienia klienta</span>
            <input type="text" value={form.client_order_number} onChange={(e) => set('client_order_number', e.target.value)} />
          </label>
          <label>
            <span className="order-field-label-text">Pilne / termin</span>
            <input type="text" value={form.rush} placeholder="PILNE albo data" onChange={(e) => set('rush', e.target.value)} />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            <span className="order-field-label-text">Uwagi</span>
            <input type="text" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </label>
          {extra && (
            <label style={{ gridColumn: '1 / -1' }}>
              <span className="order-field-label-text">Zmiany — sprzedaż</span>
              <input type="text" value={form.sales_changes} onChange={(e) => set('sales_changes', e.target.value)} />
            </label>
          )}
        </div>
        <div className="bastion-extra-modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Anuluj
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSave}
            onClick={() => {
              void onSave(form).then((ok) => {
                if (ok) onClose()
              })
            }}
          >
            {extra ? 'Zapisz' : 'Dodaj pozycję'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
