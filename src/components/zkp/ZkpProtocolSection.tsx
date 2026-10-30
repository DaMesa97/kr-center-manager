import { useEffect, useMemo, useState } from 'react'
import { appConfirm } from '../../lib/appDialogs'
import type { ZkpCardApi } from '../../hooks/useZkpCards'
import { peopleWithCompetency, type ZkpProductCard } from '../../lib/zkpCard'
import {
  ZKP_MEASUREMENTS,
  ZKP_PROTOCOL_CHECK_SECTIONS,
  nokKeys,
  protocolFormProblems,
  protocolToForm,
  type ZkpCheckResult,
  type ZkpProtocolForm,
  type ZkpTestProtocol,
} from '../../lib/zkpProtocol'
import { printProtocolPdf } from '../../utils/zkpPdf'
import type { ZkpCardTarget } from './ZkpCardModal'
import type { ZkpData } from './ZkpView'

// Część G karty: protokół badań wyrobu gotowego 6.17.5. Kontroler (uprawnienie
// „kontrola_odbiorcza" w matrycy 6.27) wpisuje wyniki B/D/E/F i pomiary C; baza
// liczy wyniki pomiarów względem tabeli K i karty. PJ / Zastępca zamyka: ZWOLNIONY
// (bez NOK — zamyka kartę) albo WSTRZYMANY (naprawa, nowy protokół /2).

type Props = {
  api: ZkpCardApi
  zkp: ZkpData
  target: ZkpCardTarget
  canFill: boolean
  canDecide: boolean
}

const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : ''

function ResultPick({ value, allowNa, disabled, onChange }: { value: ZkpCheckResult | ''; allowNa: boolean; disabled: boolean; onChange: (v: ZkpCheckResult) => void }) {
  return (
    <span className="zkp-decision-pick zkp-result-pick">
      {(['OK', 'NOK', ...(allowNa ? (['nd'] as const) : [])] as ZkpCheckResult[]).map((v) => (
        <label key={v} className={value === v ? `zkp-result--${v}` : undefined}>
          <input type="radio" disabled={disabled} checked={value === v} onChange={() => onChange(v)} /> {v === 'nd' ? 'n/d' : v}
        </label>
      ))}
    </span>
  )
}

export default function ZkpProtocolSection({ api, zkp, target, canFill, canDecide }: Props) {
  const card = api.data?.card ?? null
  const protocols = api.data?.protocols ?? []
  const open = protocols.find((p) => p.decision === null) ?? null
  const closed = protocols.filter((p) => p.decision !== null)
  const released = closed.find((p) => p.decision === 'zwolniony') ?? null
  const [form, setForm] = useState<ZkpProtocolForm>(() =>
    protocolToForm(open, { frameW: target.position?.width_mm, frameH: target.position?.height_mm }),
  )
  useEffect(() => {
    setForm(protocolToForm(open, { frameW: target.position?.width_mm, frameH: target.position?.height_mm }))
  }, [open, target.position?.width_mm, target.position?.height_mm])
  const inspectors = useMemo(() => peopleWithCompetency(zkp.people, zkp.competencies, 'kontrola_odbiorcza'), [zkp.people, zkp.competencies])
  const [close, setClose] = useState({ assessment: 'zgodny' as 'zgodny' | 'niezgodny', nc: '', notes: '' })

  if (!card) return null
  const cardClosed = !!card.decision
  const editable = canFill && !cardClosed
  const problems = protocolFormProblems(form, card)
  const range = api.ranges.find((r) => r.code === card.range_code) ?? null

  const setCheck = (key: string, v: ZkpCheckResult) => setForm((f) => ({ ...f, checks: { ...f.checks, [key]: v } }))
  const setM = (key: string, patch: Partial<{ n: string; t: string; r: ZkpCheckResult | ''; mi: number; mv: string }>) =>
    setForm((f) => {
      const cur = { ...(f.measurements[key] ?? {}) }
      if (patch.n !== undefined) cur.n = patch.n
      if (patch.t !== undefined) cur.t = patch.t
      if (patch.r !== undefined) cur.r = patch.r
      if (patch.mi !== undefined) {
        const m = [...(cur.m ?? [])]
        m[patch.mi] = patch.mv ?? ''
        cur.m = m
      }
      return { ...f, measurements: { ...f.measurements, [key]: cur } }
    })

  const print = (p: ZkpTestProtocol) =>
    printProtocolPdf({ protocol: p, card, range, constructionNo: target.constructionNo, orderNumber: target.orderNumber, company: target.company })

  const doClose = async (decision: 'zwolniony' | 'wstrzymany') => {
    if (!open) return
    const ok = await appConfirm(
      decision === 'zwolniony'
        ? `Zamknąć protokół ${open.protocol_no} decyzją ZWOLNIONY? Karta wyrobu zostanie zamknięta (cz. F), podpis i data z serwera.`
        : `Zamknąć protokół ${open.protocol_no} jako WSTRZYMANY? Po naprawie trzeba będzie wypełnić nowy, kompletny protokół (${open.protocol_no}/${open.attempt + 1}).`,
      { title: 'Protokół 6.17.5 — decyzja', confirmLabel: decision === 'zwolniony' ? 'Zwalniam' : 'Wstrzymuję' },
    )
    if (ok) await api.closeProtocol(open.id, close.assessment, decision, close.nc, close.notes)
  }

  const evalRows = open?.eval ?? []
  const noks = open ? nokKeys(open) : []

  return (
    <>
      {closed.length > 0 && (
        <table className="zkp-history" style={{ marginBottom: 10 }}>
          <thead>
            <tr><th>Protokół</th><th>Kontrola</th><th>Ocena</th><th>Decyzja</th><th>Zamknął</th><th /></tr>
          </thead>
          <tbody>
            {closed.map((p) => (
              <tr key={p.id} className={p.decision === 'wstrzymany' ? 'zkp-row--nok' : undefined}>
                <td><b>{p.protocol_no}</b></td>
                <td>{p.inspected_on} · {p.inspector_initials}</td>
                <td>{p.assessment === 'niezgodny' ? <span className="zkp-warn">NIEZGODNY{p.nonconformity_ref ? ` (6.20 nr ${p.nonconformity_ref})` : ''}</span> : 'zgodny'}</td>
                <td>{p.decision === 'zwolniony' ? <b>ZWOLNIONY</b> : <span className="zkp-warn">WSTRZYMANY</span>}{p.notes ? ` · ${p.notes}` : ''}</td>
                <td>{p.closed_by_name} · {fmt(p.closed_at)}</td>
                <td><button type="button" className="zkp-link" onClick={() => print(p)}>🖨 PDF</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {released || cardClosed ? (
        <div className="zkp-info">
          {released ? `Konstrukcja zwolniona protokołem ${released.protocol_no} (${fmt(released.closed_at)}, ${released.closed_by_name}).` : 'Karta zamknięta — bez dalszych protokołów.'}
        </div>
      ) : (
        <>
          <div className="zkp-card-head" style={{ marginBottom: 6 }}>
            <b>{open ? `Protokół ${open.protocol_no} — otwarty` : `Nowy protokół ${target.constructionNo}${closed.length ? `/${closed.length + 1}` : ''}`}</b>
            {open && (
              <span className={noks.length ? 'badge badge-danger' : 'badge badge-success'}>
                {noks.length ? `NOK: ${noks.length}` : 'bez NOK'}
              </span>
            )}
            {open && <button type="button" className="zkp-link" onClick={() => print(open)}>🖨 podgląd PDF</button>}
          </div>
          <p className="zkp-hint">
            Numer protokołu = numer konstrukcji. Kryteria z tabeli K dla zakresu {card.range_code ?? '—'}; baza liczy wyniki pomiarów po zapisie.
            Jedno NOK w B–F = WSTRZYMANY.
          </p>

          <h4 className="zkp-trace-h">A. Identyfikacja</h4>
          <div className="order-form-grid zkp-form-grid">
            <label>
              <span className="order-field-label-text">Kontrolę wykonał (inicjały, matryca 6.27) *</span>
              <input list="zkp-inspectors" disabled={!editable} value={form.inspector} onChange={(e) => setForm((f) => ({ ...f, inspector: e.target.value }))} maxLength={20} />
              <datalist id="zkp-inspectors">{inspectors.map((p) => <option key={p.id} value={p.initials}>{p.full_name}</option>)}</datalist>
              {inspectors.length === 0 && <small className="zkp-problems">Nikt nie ma uprawnienia „kontrola odbiorcza” w matrycy 6.27.</small>}
            </label>
            <label>
              <span className="order-field-label-text">Data produkcji</span>
              <input type="date" disabled={!editable} value={form.produced_on} onChange={(e) => setForm((f) => ({ ...f, produced_on: e.target.value }))} />
            </label>
            <label>
              <span className="order-field-label-text">Data kontroli</span>
              <input type="date" disabled={!editable} value={form.inspected_on} onChange={(e) => setForm((f) => ({ ...f, inspected_on: e.target.value }))} />
            </label>
            <label>
              <span className="order-field-label-text">Przyrządy użyte (nr z zał. 6.14)</span>
              <input disabled={!editable} value={form.instruments} onChange={(e) => setForm((f) => ({ ...f, instruments: e.target.value }))} placeholder="np. SR-01, PR-02" />
            </label>
          </div>

          {ZKP_PROTOCOL_CHECK_SECTIONS.filter((s) => s.key === 'B').map((s) => (
            <ChecksTable key={s.key} title={s.title} checks={s.checks} form={form} editable={editable} onChange={setCheck} />
          ))}

          <h4 className="zkp-trace-h">C. Pomiary</h4>
          <table className="zkp-history zkp-measure">
            <thead>
              <tr><th>Pomiar</th><th>Nominal</th><th>Zmierzono</th><th>Ocena</th></tr>
            </thead>
            <tbody>
              {ZKP_MEASUREMENTS.filter((d) => !d.when || d.when(card)).map((d) => {
                const v = form.measurements[d.key] ?? {}
                const ev = evalRows.find((e) => e.key === d.key)
                return (
                  <tr key={d.key} className={ev?.result === 'NOK' ? 'zkp-row--nok' : undefined}>
                    <td>
                      {d.label}
                      {ev && <div className="zkp-hint" style={{ margin: 0 }}>{ev.criterion}</div>}
                    </td>
                    <td>
                      {d.nominalInput ? (
                        <input inputMode="decimal" style={{ width: 70 }} disabled={!editable} value={v.n ?? ''} onChange={(e) => setM(d.key, { n: e.target.value })} />
                      ) : (
                        <span className="zkp-hint" style={{ margin: 0 }}>{ev?.nominal ?? nominalHint(d.key, card)}</span>
                      )}
                    </td>
                    <td>
                      {d.text ? (
                        <input style={{ width: '100%' }} disabled={!editable} value={v.t ?? ''} onChange={(e) => setM(d.key, { t: e.target.value })} />
                      ) : (
                        <span className="zkp-measure-inputs">
                          {d.inputs.map((lbl, i) => (
                            <label key={lbl}>
                              <small>{lbl}</small>
                              <input inputMode="decimal" style={{ width: lbl.length > 6 ? 90 : 60 }} disabled={!editable} value={v.m?.[i] ?? ''} onChange={(e) => setM(d.key, { mi: i, mv: e.target.value })} />
                            </label>
                          ))}
                          {d.unit && <small>{d.unit}</small>}
                        </span>
                      )}
                    </td>
                    <td>
                      {d.manual ? (
                        <ResultPick value={v.r ?? ''} allowNa={d.key === 'pins'} disabled={!editable} onChange={(r) => setM(d.key, { r })} />
                      ) : ev ? (
                        <b className={ev.result === 'NOK' ? 'zkp-warn' : undefined}>{ev.result === 'nd' ? 'n/d' : ev.result ?? '—'}</b>
                      ) : (
                        <span className="zkp-hint" style={{ margin: 0 }}>liczy baza</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {ZKP_PROTOCOL_CHECK_SECTIONS.filter((s) => s.key !== 'B').map((s) => (
            <ChecksTable key={s.key} title={s.title} checks={s.checks} form={form} editable={editable} onChange={setCheck} />
          ))}

          <label className="order-field-full" style={{ marginTop: 8 }}>
            <span className="order-field-label-text">Uwagi</span>
            <input disabled={!editable} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </label>

          {editable && (
            <div className="zkp-actions" style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-primary" disabled={api.saving || problems.length > 0} onClick={() => void api.saveProtocol(form)}>
                {api.saving ? 'Zapisuję…' : open ? 'Zapisz zmiany i przelicz' : 'Zapisz protokół i przelicz pomiary'}
              </button>
              {problems.length > 0 && <span className="zkp-problems">{problems.join(' ')}</span>}
            </div>
          )}

          {open && (
            <div className="zkp-stage-editor" style={{ marginTop: 12 }}>
              <b>G. Decyzja (Pełnomocnik ZKP / Zastępca)</b>
              {noks.length > 0 && <div className="zkp-warnbox">NOK: {noks.join('; ')} — protokół może być tylko WSTRZYMANY.</div>}
              <div className="zkp-decision-pick">
                <label><input type="radio" disabled={!canDecide} checked={close.assessment === 'zgodny'} onChange={() => setClose((c) => ({ ...c, assessment: 'zgodny' }))} /> ZGODNY</label>
                <label><input type="radio" disabled={!canDecide} checked={close.assessment === 'niezgodny'} onChange={() => setClose((c) => ({ ...c, assessment: 'niezgodny' }))} /> NIEZGODNY (rejestr 6.20)</label>
                {close.assessment === 'niezgodny' && (
                  <input placeholder="rejestr 6.20 nr" disabled={!canDecide} value={close.nc} onChange={(e) => setClose((c) => ({ ...c, nc: e.target.value }))} style={{ width: 140 }} />
                )}
                <input placeholder="uwagi do decyzji" disabled={!canDecide} value={close.notes} onChange={(e) => setClose((c) => ({ ...c, notes: e.target.value }))} style={{ flex: '1 1 200px' }} />
              </div>
              {canDecide ? (
                <div className="zkp-actions">
                  <button type="button" className="btn btn-primary" disabled={api.saving || noks.length > 0 || close.assessment !== 'zgodny'} onClick={() => void doClose('zwolniony')}>
                    ✔ ZWOLNIONY
                  </button>
                  <button type="button" className="btn btn-danger" disabled={api.saving || (close.assessment === 'niezgodny' && !close.nc.trim())} onClick={() => void doClose('wstrzymany')}>
                    WSTRZYMANY
                  </button>
                </div>
              ) : (
                <p className="zkp-hint">Decyzję podejmuje Pełnomocnik ZKP albo Zastępca.</p>
              )}
            </div>
          )}
        </>
      )}
    </>
  )
}

function nominalHint(key: string, c: ZkpProductCard): string {
  switch (key) {
    case 'leaf_active': return `${c.active_w ?? '?'} × ${c.active_h ?? '?'} (karta)`
    case 'leaf_passive': return `${c.passive_w ?? '?'} × ${c.passive_h ?? '?'} (karta)`
    case 'light': return `${c.light_w ?? '?'} × ${c.light_h ?? '?'} (karta)`
    case 'fill_thick': return `${c.fill_thickness_mm ?? '—'} (karta cz. E)`
    case 'fill_dims': return c.fill_ref || '—'
    case 'threshold': return c.threshold_ref || '—'
    case 'hinges': return `${c.hinges_count ?? '—'} (karta)`
    case 'pins': return `${c.pins_count ?? '—'} (karta)`
    case 'mass': return `${c.leaf_mass_kg ?? '—'} kg (karta)`
    default: return '–'
  }
}

function ChecksTable({ title, checks, form, editable, onChange }: {
  title: string
  checks: Array<{ key: string; label: string; allowNa: boolean; criterion?: string; source?: string }>
  form: ZkpProtocolForm
  editable: boolean
  onChange: (key: string, v: ZkpCheckResult) => void
}) {
  const withCriteria = checks.some((c) => c.criterion)
  return (
    <>
      <h4 className="zkp-trace-h">{title}</h4>
      <table className="zkp-history">
        <thead>
          <tr><th style={{ width: 28 }} /><th>Sprawdzenie</th>{withCriteria && <th>Kryterium</th>}{withCriteria && <th>Źródło</th>}<th style={{ width: 170 }}>Wynik</th></tr>
        </thead>
        <tbody>
          {checks.map((c) => (
            <tr key={c.key} className={form.checks[c.key] === 'NOK' ? 'zkp-row--nok' : undefined}>
              <td>{c.key.toUpperCase()}</td>
              <td>{c.label}</td>
              {withCriteria && <td>{c.criterion}</td>}
              {withCriteria && <td className="zkp-hint" style={{ margin: 0 }}>{c.source}</td>}
              <td><ResultPick value={form.checks[c.key] ?? ''} allowNa={c.allowNa} disabled={!editable} onChange={(v) => onChange(c.key, v)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
