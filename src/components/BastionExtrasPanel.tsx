import { useMemo, useState } from 'react'
import ProductionStageCell from './ProductionStageCell'
import BastionExtraModal from './BastionExtraModal'
import { appConfirm, appPrompt } from '../lib/appDialogs'
import {
  BASTION_EXTRA_STAGE_DEFS,
  bastionExtraAgeDays,
  type BastionExtra,
  type BastionExtraForm,
} from '../lib/bastionExtras'
import type { Company } from '../types'

type Props = {
  extras: BastionExtra[]
  loading: boolean
  busy: boolean
  companies: Company[]
  systems: string[]
  colors: string[]
  /** słownik „Reszta — pozycje" (Konfiguracja → Bastion) — podpowiedzi opisu */
  presets: string[]
  isManager: boolean
  canMark: boolean
  currentInitials: string
  onCreate: (form: BastionExtraForm) => Promise<number | null>
  onUpdate: (id: number, form: BastionExtraForm) => Promise<boolean>
  onSetStage: (id: number, stageKey: string, value: string) => Promise<boolean>
  onSetLabel: (id: number, label: string) => Promise<boolean>
  onSetReleased: (id: number, date: string | null) => Promise<boolean>
  onSetCancelled: (id: number, cancelled: boolean) => Promise<boolean>
}

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}
const today = () => new Date().toISOString().slice(0, 10)

/**
 * Bastion → Reszta: drobne zamówienia bez drzwi (progi, opaski, zabudowy) —
 * tabela jak arkusz „Reszta": 4 etapy inicjałami, naklejka, zrealizowane,
 * wiek pozycji (7 / 14 dni bez realizacji podświetlone jak w Excelu).
 */
export default function BastionExtrasPanel({
  extras,
  loading,
  busy,
  companies,
  systems,
  colors,
  presets,
  isManager,
  canMark,
  currentInitials,
  onCreate,
  onUpdate,
  onSetStage,
  onSetLabel,
  onSetReleased,
  onSetCancelled,
}: Props) {
  const [search, setSearch] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [showCancelled, setShowCancelled] = useState(false)
  const [modal, setModal] = useState<{ open: boolean; extra: BastionExtra | null }>({ open: false, extra: null })

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return extras.filter((e) => {
      if (!showCancelled && e.is_cancelled) return false
      if (!showDone && e.released_at && !e.is_cancelled) return false
      if (!q) return true
      return [String(e.extra_no), e.company, e.description, e.color, e.system, e.order_ref, e.client_order_number, e.notes]
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [extras, search, showDone, showCancelled])

  const openCount = useMemo(() => extras.filter((e) => !e.released_at && !e.is_cancelled).length, [extras])

  const handleStage = async (e: BastionExtra, key: string) => {
    const def = BASTION_EXTRA_STAGE_DEFS.find((d) => d.key === key)
    const cur = (e.stages[key]?.v ?? '').trim()
    if (cur) {
      const ok = await appConfirm(`Cofnąć etap „${def?.title ?? key}" pozycji ${e.extra_no} (${cur})?`, { title: 'Cofnij etap', confirmLabel: 'Cofnij' })
      if (!ok) return
      await onSetStage(e.id, key, '')
      return
    }
    let initials = currentInitials.trim().toUpperCase()
    if (!initials) {
      const typed = await appPrompt('Brak inicjałów w profilu. Podaj inicjały:', { title: 'Etap' })
      if (!typed?.trim()) return
      initials = typed.trim().toUpperCase()
    }
    await onSetStage(e.id, key, initials)
  }

  const handleRelease = async (e: BastionExtra) => {
    if (e.released_at) {
      const ok = await appConfirm(`Cofnąć realizację pozycji ${e.extra_no} (${fmtDate(e.released_at)})?`, { title: 'Cofnij realizację', confirmLabel: 'Cofnij' })
      if (!ok) return
      await onSetReleased(e.id, null)
      return
    }
    await onSetReleased(e.id, today())
  }

  const handleCancel = async (e: BastionExtra) => {
    if (e.is_cancelled) {
      await onSetCancelled(e.id, false)
      return
    }
    const ok = await appConfirm(`Anulować pozycję ${e.extra_no} (${e.description})?`, { title: 'Anuluj pozycję', confirmLabel: 'Anuluj pozycję', tone: 'danger' })
    if (!ok) return
    await onSetCancelled(e.id, true)
  }

  return (
    <section className="bastion-extras">
      <div className="bastion-batches-toolbar">
        <h3 className="bastion-batches-title">
          Reszta
          <span className="bastion-batches-count">otwarte: {openCount}</span>
          <span className="muted" style={{ fontWeight: 400, fontSize: '0.82rem' }}>progi, opaski, zabudowy — bez drzwi</span>
        </h3>
        <div className="bastion-batches-actions">
          <input type="search" className="search-input bastion-picker-search" placeholder="Szukaj: nr, firma, pozycja, kolor, zlecenie…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <label className="bastion-batches-toggle">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> zrealizowane
          </label>
          <label className="bastion-batches-toggle">
            <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> anulowane
          </label>
          {isManager && (
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => setModal({ open: true, extra: null })}>
              + Nowa pozycja
            </button>
          )}
        </div>
      </div>
      {loading && extras.length === 0 ? (
        <p className="muted">Wczytywanie…</p>
      ) : rows.length === 0 ? (
        <p className="muted bastion-batches-empty">{extras.length === 0 ? 'Brak pozycji. Dodaj pierwszą przyciskiem „Nowa pozycja".' : 'Nic nie pasuje do filtrów.'}</p>
      ) : (
        <div className="table-wrapper bastion-extras-wrapper">
          <table className="orders-table dt-table bastion-extras-table">
            <thead>
              <tr>
                <th>NR</th>
                <th>DATA</th>
                <th>FIRMA</th>
                <th>POZYCJA</th>
                <th>KOLOR</th>
                <th>SZER/STR</th>
                <th>SYSTEM</th>
                <th>ILOŚĆ</th>
                <th>DO ZLECENIA</th>
                <th>NR ZAM. KLIENTA</th>
                <th>PILNE</th>
                {BASTION_EXTRA_STAGE_DEFS.map((d) => (
                  <th key={d.key} className="production-stage-th col-stage" title={d.title}>
                    {d.header}
                  </th>
                ))}
                <th>UWAGI</th>
                <th>ZMIANY-SPRZEDAŻ</th>
                <th>NAKLEJKA</th>
                <th>ZREALIZ.</th>
                <th>WPISAŁ</th>
                {isManager && <th>AKCJE</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const age = bastionExtraAgeDays(e)
                const ageClass = e.is_cancelled ? ' bastion-extra-row--cancelled' : age != null && age >= 14 ? ' bastion-extra-row--late2' : age != null && age >= 7 ? ' bastion-extra-row--late1' : ''
                return (
                  <tr key={e.id} className={`bastion-extra-row${ageClass}${e.released_at ? ' bastion-extra-row--done' : ''}`}>
                    <td className="order-num-td">
                      <strong>{e.extra_no}</strong>
                      {e.is_cancelled && <div className="bastion-batch-closed">anulowana</div>}
                      {age != null && age >= 7 && !e.is_cancelled && <div className="bastion-batch-closed" title="Dni od zamówienia bez realizacji">{age} dni</div>}
                    </td>
                    <td>{fmtDate(e.order_date)}</td>
                    <td>
                      {e.company}
                      {e.production_day && <div className="muted" style={{ fontSize: '0.75rem' }}>{e.production_day}</div>}
                    </td>
                    <td className="bastion-extra-desc">{e.description}</td>
                    <td>{e.color}</td>
                    <td>{e.width_side}</td>
                    <td>{e.system}</td>
                    <td><strong>{e.quantity}</strong></td>
                    <td>{e.order_ref}</td>
                    <td>{e.client_order_number}</td>
                    <td>{e.rush ? <span className="released-badge order-badge" style={{ background: '#fee2e2', color: '#991b1b' }}>{e.rush}</span> : ''}</td>
                    {BASTION_EXTRA_STAGE_DEFS.map((d) => {
                      const st = e.stages[d.key]
                      return (
                        <td key={d.key} className="production-stage-td col-stage" title={st?.v ? `${d.title}: ${st.v} · ${fmtDate(st.at)}` : d.title}>
                          <ProductionStageCell value={st?.v ?? ''} disabled={busy || !canMark || e.is_cancelled} onPickEmpty={() => void handleStage(e, d.key)} onPickFilled={() => void handleStage(e, d.key)} />
                        </td>
                      )
                    })}
                    <td className="col-notes" style={{ whiteSpace: 'normal', maxWidth: 260 }}>{e.notes}</td>
                    <td className="col-notes" style={{ whiteSpace: 'normal', maxWidth: 200 }}>{e.sales_changes}</td>
                    <td>
                      <button
                        type="button"
                        className="release-checkbox-btn"
                        disabled={!isManager || busy || e.is_cancelled}
                        title={e.label ? 'Naklejka wydrukowana — kliknij, aby odznaczyć' : 'Oznacz naklejkę jako wydrukowaną'}
                        onClick={() => void onSetLabel(e.id, e.label ? '' : 'A')}
                      >
                        {e.label ? '✓' : ''}
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={e.released_at ? 'release-date-value' : 'release-checkbox-btn'}
                        disabled={!isManager || busy || e.is_cancelled}
                        title={e.released_at ? 'Kliknij, aby cofnąć realizację' : 'Oznacz zrealizowane (dziś)'}
                        onClick={() => void handleRelease(e)}
                      >
                        {e.released_at ? fmtDate(e.released_at) : ''}
                      </button>
                    </td>
                    <td>{e.entered_by}</td>
                    {isManager && (
                      <td className="bastion-extra-actions">
                        <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setModal({ open: true, extra: e })}>
                          Edytuj
                        </button>
                        <button type="button" className={`btn btn-sm ${e.is_cancelled ? 'btn-secondary' : 'btn-danger'}`} disabled={busy} onClick={() => void handleCancel(e)}>
                          {e.is_cancelled ? 'Przywróć' : 'Anuluj'}
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <BastionExtraModal
        open={modal.open}
        extra={modal.extra}
        companies={companies}
        systems={systems}
        colors={colors}
        presets={presets}
        busy={busy}
        onClose={() => setModal({ open: false, extra: null })}
        onSave={async (form) => {
          if (modal.extra) return onUpdate(modal.extra.id, form)
          const id = await onCreate(form)
          return id != null
        }}
      />
    </section>
  )
}
