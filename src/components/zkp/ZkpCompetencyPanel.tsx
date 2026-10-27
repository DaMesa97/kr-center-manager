import { useMemo, useState } from 'react'
import ZkpModal from './ZkpModal'
import { appPrompt } from '../../lib/appDialogs'
import { ZKP_OPERATIONS, ZKP_POSITION_LABELS, matrixPeople, type ZkpCompetency, type ZkpOperation, type ZkpPerson } from '../../lib/zkpCard'
import { printMatrix627Pdf } from '../../utils/zkpPdf'
import type { ZkpData } from './ZkpView'

// Matryca kompetencji (zał. 6.27): osoba × operacja. Uprawnienie nadaje i wycofuje
// (z powodem) Pełnomocnik ZKP / Zastępca — baza (zkp_grant/withdraw_competency)
// pilnuje tego samego. Każdy podpis etapu karty wyrobu jest sprawdzany w tej matrycy.

const today = () => new Date().toLocaleDateString('sv-SE')
const fmtDate = (ymd: string | null | undefined) => (ymd ? ymd.slice(0, 10).split('-').reverse().join('.') : '')
const fmt = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
}
export default function ZkpCompetencyPanel({ zkp, canEdit }: { zkp: ZkpData; canEdit: boolean }) {
  const [all, setAll] = useState(false)
  const [history, setHistory] = useState(false)
  const [grantFor, setGrantFor] = useState<{ person: ZkpPerson; operation: ZkpOperation } | null>(null)

  const rows = useMemo(() => matrixPeople(zkp.people, zkp.competencies, all), [zkp.people, zkp.competencies, all])
  const active = useMemo(() => {
    const m = new Map<string, ZkpCompetency>()
    for (const c of zkp.competencies) if (!c.withdrawn_at) m.set(`${c.profile_id}|${c.operation}`, c)
    return m
  }, [zkp.competencies])
  const withdrawn = useMemo(
    () => zkp.competencies.filter((c) => c.withdrawn_at).sort((a, b) => (b.withdrawn_at ?? '').localeCompare(a.withdrawn_at ?? '')),
    [zkp.competencies],
  )
  const personById = new Map(zkp.people.map((p) => [p.id, p]))

  const withdraw = async (c: ZkpCompetency, person: ZkpPerson) => {
    const reason = await appPrompt(
      `Wycofać uprawnienie ${person.initials} do „${ZKP_OPERATIONS.find((o) => o.key === c.operation)?.label ?? c.operation}"? Wpis zostaje w historii. Podaj powód:`,
      { title: 'Wycofanie uprawnienia (zał. 6.27)', confirmLabel: 'Wycofaj' },
    )
    if (reason == null) return
    await zkp.withdrawCompetency(c.id, reason)
  }

  return (
    <div>
      <div className="orders-filters zkp-toolbar">
        <label className="orders-filter-checkbox">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Pokaż wszystkich użytkowników
        </label>
        <label className="orders-filter-checkbox">
          <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} /> Historia wycofań ({withdrawn.length})
        </label>
        <button type="button" className="btn btn-sm btn-secondary" disabled={rows.length === 0} onClick={() => printMatrix627Pdf(rows, zkp.competencies)}>
          🖨 Wydruk 6.27
        </button>
        {!canEdit && <span className="zkp-hint">Matrycę prowadzi Pełnomocnik ZKP / Zastępca; stanowiska nadaje admin w Użytkownikach.</span>}
      </div>
      <p className="zkp-hint">
        Etap karty wyrobu podpisuje tylko osoba z uprawnieniem do danej operacji (IS-01 operator CNC i piły, IS-02–IS-06 monter wg
        uprawnień; pomocnik montera bez operacji krytycznych, chyba że ma uprawnienie). Kontrola odbiorcza i montaż — etapy D i protokół 6.28.
      </p>

      <div className="table-wrapper">
        <table className="zkp-history zkp-matrix">
          <thead>
            <tr>
              <th>Osoba</th>
              <th>Stanowisko (6.1)</th>
              {ZKP_OPERATIONS.map((o) => (
                <th key={o.key} title={o.label} style={{ textAlign: 'center' }}>{o.short}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={2 + ZKP_OPERATIONS.length}><span className="zkp-missing">Brak osób ze stanowiskiem ZKP — nadaj stanowiska w Użytkownikach.</span></td></tr>
            )}
            {rows.map((p) => (
              <tr key={p.id}>
                <td><b>{p.initials}</b> {p.full_name}</td>
                <td>{p.zkp_position ? ZKP_POSITION_LABELS[p.zkp_position] : <span className="zkp-missing">—</span>}</td>
                {ZKP_OPERATIONS.map((o) => {
                  const c = active.get(`${p.id}|${o.key}`)
                  return (
                    <td key={o.key} className="zkp-matrix-cell">
                      {c ? (
                        <button
                          type="button"
                          className="zkp-matrix-on"
                          title={`od ${fmtDate(c.granted_on)}${c.basis ? ` · ${c.basis}` : ''} · nadał ${c.granted_by_name}${canEdit ? ' — kliknij, aby wycofać' : ''}`}
                          disabled={!canEdit || zkp.saving}
                          onClick={() => void withdraw(c, p)}
                        >
                          ✓
                        </button>
                      ) : canEdit ? (
                        <button type="button" className="zkp-matrix-off" title="Nadaj uprawnienie" disabled={zkp.saving} onClick={() => setGrantFor({ person: p, operation: o.key })}>
                          +
                        </button>
                      ) : (
                        <span className="zkp-missing">–</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {history && withdrawn.length > 0 && (
        <table className="zkp-history" style={{ marginTop: 12 }}>
          <thead>
            <tr><th>Osoba</th><th>Operacja</th><th>Nadano</th><th>Wycofano</th><th>Powód</th></tr>
          </thead>
          <tbody>
            {withdrawn.map((c) => (
              <tr key={c.id}>
                <td>{personById.get(c.profile_id)?.initials ?? '?'}</td>
                <td>{ZKP_OPERATIONS.find((o) => o.key === c.operation)?.label ?? c.operation}</td>
                <td>{fmtDate(c.granted_on)} · {c.granted_by_name}{c.basis ? ` · ${c.basis}` : ''}</td>
                <td>{fmt(c.withdrawn_at)} · {c.withdrawn_by_name}</td>
                <td>{c.withdraw_reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {grantFor && <GrantModal zkp={zkp} person={grantFor.person} operation={grantFor.operation} onClose={() => setGrantFor(null)} />}
    </div>
  )
}

function GrantModal({ zkp, person, operation, onClose }: { zkp: ZkpData; person: ZkpPerson; operation: ZkpOperation; onClose: () => void }) {
  const [grantedOn, setGrantedOn] = useState(today())
  const [basis, setBasis] = useState('')
  const label = ZKP_OPERATIONS.find((o) => o.key === operation)?.label ?? operation
  const save = async () => {
    if (await zkp.grantCompetency(person.id, operation, grantedOn, basis)) onClose()
  }
  return (
    <ZkpModal
      title={`Uprawnienie (zał. 6.27): ${person.initials} ${person.full_name} — ${label}`}
      onClose={onClose}
      busy={zkp.saving}
      width={520}
      footer={
        <>
          <button type="button" className="btn btn-primary" disabled={zkp.saving || !grantedOn} onClick={() => void save()}>
            {zkp.saving ? 'Zapisuję…' : 'Nadaj uprawnienie'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={zkp.saving}>Anuluj</button>
        </>
      }
    >
      <div className="order-form-grid zkp-form-grid">
        <label>
          <span className="order-field-label-text">Od dnia *</span>
          <input type="date" value={grantedOn} onChange={(e) => setGrantedOn(e.target.value)} />
        </label>
        <label>
          <span className="order-field-label-text">Podstawa (szkolenie, instruktaż, dokument)</span>
          <input value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="np. instruktaż stanowiskowy IS-03, 27.10.2026" />
        </label>
      </div>
      <div className="zkp-hint">Nadanie podpisuje zalogowany Pełnomocnik / Zastępca (czas serwera). Wycofanie zostaje w historii z powodem.</div>
    </ZkpModal>
  )
}
