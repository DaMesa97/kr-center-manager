import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { appPrompt } from '../../lib/appDialogs'
import { useZkpDeclarations } from '../../hooks/useZkpCards'
import type { ZkpProductCard } from '../../lib/zkpCard'
import {
  ZKP_SETTING_LABELS,
  groupDeclarationCandidates,
  type ZkpDeclaration,
  type ZkpDeclarationCandidate,
} from '../../lib/zkpProtocol'
import { printDeclarationPdf, printMarkingPdf } from '../../utils/zkpPdf'
import ZkpModal from './ZkpModal'
import type { ToastVariant } from '../../types'

// Deklaracje KDWU / DWU (zał. 6.9): wykaz, wystawianie do zlecenia (konstrukcje
// jednego typu ze zwolnionymi kartami), wycofanie z powodem, wydruk deklaracji
// oraz tabliczek 6.26 / etykiet 6.8. Ustawienia (certyfikaty, podpisujący) — PJ.

type Props = {
  roles: string[]
  isAdmin: boolean
  pushToast: (message: string, variant: ToastVariant) => void
}

const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : ''

export default function ZkpDeclarationsPanel({ roles, isAdmin, pushToast }: Props) {
  const api = useZkpDeclarations(pushToast, true)
  const canIssue = isAdmin || roles.includes('pelnomocnik') || roles.includes('zastepca')
  const [issueOpen, setIssueOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [q, setQ] = useState('')
  const groups = useMemo(() => groupDeclarationCandidates(api.candidates), [api.candidates])

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase()
    return api.declarations.filter((d) => !n || [d.number, d.type_code, d.certificate_no].some((v) => v.toLowerCase().includes(n)))
  }, [api.declarations, q])

  const orderNumbers = useMemo(() => {
    const m = new Map<number, string>()
    for (const c of api.candidates) m.set(c.r_order_id, c.r_order_number)
    return m
  }, [api.candidates])

  const printDeclaration = async (d: ZkpDeclaration) => {
    const [{ data: o }, { data: cons }] = await Promise.all([
      supabase.from('orders').select('order_number').eq('id', d.order_id).maybeSingle<{ order_number: string }>(),
      supabase.from('alu_constructions').select('construction_no').in('id', d.construction_ids).order('pp'),
    ])
    printDeclarationPdf({
      declaration: d,
      orderNumber: o?.order_number ?? orderNumbers.get(d.order_id) ?? `#${d.order_id}`,
      constructionNos: ((cons ?? []) as Array<{ construction_no: string }>).map((c) => c.construction_no),
    })
  }

  const printMarking = async (d: ZkpDeclaration) => {
    const [{ data: cons }, { data: cards }] = await Promise.all([
      supabase.from('alu_constructions').select('id, construction_no, year').in('id', d.construction_ids).order('pp'),
      supabase.from('zkp_product_cards').select('*').in('construction_id', d.construction_ids),
    ])
    const cardBy = new Map(((cards ?? []) as ZkpProductCard[]).map((c) => [c.construction_id, c]))
    const items = ((cons ?? []) as Array<{ id: number; construction_no: string; year: number }>)
      .map((c) => ({ card: cardBy.get(c.id), constructionNo: c.construction_no, year: c.year }))
      .filter((x): x is { card: ZkpProductCard; constructionNo: string; year: number } => !!x.card)
      .map((x) => ({
        constructionNo: x.constructionNo,
        card: x.card,
        declarationNo: d.number,
        certificateNo: d.certificate_no,
        year: x.year,
        height_mm: d.height_mm,
      }))
    if (items.length === 0) {
      pushToast('Brak kart wyrobu dla konstrukcji tej deklaracji', 'error')
      return
    }
    printMarkingPdf(items)
  }

  const withdraw = async (d: ZkpDeclaration) => {
    const reason = await appPrompt(`Wycofać deklarację ${d.number}? Numer zostaje w historii, konstrukcje będą wolne pod nową deklarację. Powód:`, {
      title: 'Wycofanie deklaracji',
      confirmLabel: 'Wycofaj',
    })
    if (reason != null) await api.withdraw(d.id, reason)
  }

  const missingSettings = ZKP_SETTING_LABELS.filter((s) => ['cert_krajowy_nr', 'signer_name'].includes(s.key) && !api.setting(s.key))

  return (
    <div>
      <div className="zkp-toolbar">
        <input className="zkp-trace-input" style={{ flex: '0 1 280px' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj: numer, kod typu, certyfikat…" />
        <span className="zkp-hint" style={{ margin: 0 }}>
          wydanych: {api.declarations.filter((d) => d.status === 'wydana').length} · do wystawienia: {api.candidates.length} konstrukcji w {groups.length} grupach
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
          {canIssue && <button type="button" className="btn btn-sm btn-secondary" onClick={() => setSettingsOpen(true)}>⚙ Certyfikaty i podpis</button>}
          {canIssue && (
            <button type="button" className="btn btn-sm btn-primary" disabled={groups.length === 0} onClick={() => setIssueOpen(true)}>
              + Wystaw deklarację
            </button>
          )}
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => void api.reload()} disabled={api.loading}>Odśwież</button>
        </span>
      </div>
      {missingSettings.length > 0 && canIssue && (
        <div className="zkp-warnbox" style={{ marginBottom: 8 }}>
          Brak w ustawieniach: {missingSettings.map((s) => s.label).join(', ')} — deklaracja wyjdzie z kropkami w tych miejscach.{' '}
          <button type="button" className="zkp-link" onClick={() => setSettingsOpen(true)}>Uzupełnij</button>
        </div>
      )}
      <p className="zkp-hint">
        Deklaracja do zlecenia; jedna może objąć konstrukcje tego samego typu (kod 6.8) ze zwolnionymi kartami (protokół 6.17.5).
        Numer KDWU/RR/NNNN (wewnętrzne) lub DWU/RR/NNNN (zewnętrzne) nadaje baza i wpisuje do kart (rejestr 6.33). Wartości z karty wyrobu.
      </p>

      <table className="orders-table zkp-register">
        <thead>
          <tr><th>Numer</th><th>Data</th><th>Zlecenie</th><th>Kod typu</th><th>Konstrukcje</th><th>Klasa</th><th>Certyfikat</th><th>Podpisał(a)</th><th>Status</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} style={d.status === 'wycofana' ? { opacity: 0.55 } : undefined}>
              <td><b>{d.number}</b></td>
              <td>{d.issued_on}</td>
              <td>{orderNumbers.get(d.order_id) ?? <OrderNo id={d.order_id} />}</td>
              <td><code className="zkp-type-code">{d.type_code}</code></td>
              <td>{d.construction_ids.length}</td>
              <td>{d.fire_class}{d.smoke !== 'NPD' ? ` · ${d.smoke}` : ''}{d.release_capability === 'zapewniona' ? ' · ewak.' : ''}</td>
              <td>{d.certificate_no || <span className="zkp-missing">brak</span>}</td>
              <td>{d.signer_name}</td>
              <td>{d.status === 'wydana' ? <span className="badge badge-success">wydana</span> : <span className="badge badge-danger" title={d.withdraw_reason ?? ''}>wycofana {fmt(d.withdrawn_at)}</span>}</td>
              <td className="zkp-actions">
                <button type="button" className="zkp-link" onClick={() => void printDeclaration(d)}>🖨 deklaracja</button>
                <button type="button" className="zkp-link" onClick={() => void printMarking(d)}>🏷 tabliczki</button>
                {canIssue && d.status === 'wydana' && <button type="button" className="zkp-link" onClick={() => void withdraw(d)}>wycofaj</button>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={10} className="zkp-hint">{api.loading ? 'Wczytuję…' : 'Brak deklaracji.'}</td></tr>
          )}
        </tbody>
      </table>

      {issueOpen && (
        <IssueModal
          groups={groups}
          api={api}
          onClose={() => setIssueOpen(false)}
          onIssued={(d) => {
            setIssueOpen(false)
            void printDeclaration(d)
          }}
        />
      )}
      {settingsOpen && <SettingsModal api={api} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

function OrderNo({ id }: { id: number }) {
  const [no, setNo] = useState<string>('')
  useEffect(() => {
    void supabase.from('orders').select('order_number').eq('id', id).maybeSingle<{ order_number: string }>().then(({ data }) => setNo(data?.order_number ?? `#${id}`))
  }, [id])
  return <>{no || '…'}</>
}

type Group = ReturnType<typeof groupDeclarationCandidates>[number]

function IssueModal({ groups, api, onClose, onIssued }: {
  groups: Group[]
  api: ReturnType<typeof useZkpDeclarations>
  onClose: () => void
  onIssued: (d: ZkpDeclaration) => void
}) {
  const [gi, setGi] = useState(0)
  const g = groups[gi]
  const [picked, setPicked] = useState<Set<number>>(() => new Set(groups[0]?.rows.map((r) => r.r_construction_id) ?? []))
  useEffect(() => {
    setPicked(new Set(g?.rows.map((r) => r.r_construction_id) ?? []))
  }, [g])
  const [f, setF] = useState({ mounting_text: '', certificate_no: '', test_reports: '', ud_value: '', impact_class: '', height_mm: '', issued_on: new Date().toLocaleDateString('sv-SE'), signer_name: '', signer_title: '' })
  if (!g) return null
  const kdwu = g.kind === 'KDWU'
  const maxH = Math.max(0, ...g.rows.filter((r) => picked.has(r.r_construction_id)).map((r) => Math.max(Number(r.r_active_h ?? 0), Number(r.r_passive_h ?? 0))))
  const toggle = (r: ZkpDeclarationCandidate) =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(r.r_construction_id)) n.delete(r.r_construction_id)
      else n.add(r.r_construction_id)
      return n
    })
  const issue = async () => {
    const d = await api.issue(g.orderId, [...picked], Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim() !== '')))
    if (d) onIssued(d)
  }
  const field = (k: keyof typeof f, label: string, placeholder: string) => (
    <label>
      <span className="order-field-label-text">{label}</span>
      <input value={f[k]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))} placeholder={placeholder} />
    </label>
  )

  return (
    <ZkpModal
      title="Wystaw deklarację właściwości użytkowych (zał. 6.9)"
      onClose={onClose}
      busy={api.saving}
      width={860}
      footer={
        <>
          <button type="button" className="btn btn-primary" disabled={api.saving || picked.size === 0} onClick={() => void issue()}>
            {api.saving ? 'Wystawiam…' : `Wystaw ${g.kind} dla ${picked.size} konstrukcji`}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={api.saving}>Anuluj</button>
        </>
      }
    >
      <label>
        <span className="order-field-label-text">Zlecenie i typ wyrobu (jedna deklaracja = jeden kod typu)</span>
        <select value={gi} onChange={(e) => setGi(Number(e.target.value))}>
          {groups.map((x, i) => (
            <option key={`${x.orderId}|${x.typeCode}`} value={i}>
              {x.orderNumber} — {x.company || '—'} · {x.typeCode} · {x.kind} · {x.rows.length} szt
            </option>
          ))}
        </select>
      </label>
      <div className="zkp-checks">
        {g.rows.map((r) => (
          <label key={r.r_construction_id}>
            <input type="checkbox" checked={picked.has(r.r_construction_id)} onChange={() => toggle(r)} /> {r.r_construction_no}
            <small className="zkp-hint" style={{ margin: '0 0 0 4px' }}>({r.r_range_code}, zwol. {r.r_released_on ?? '—'})</small>
          </label>
        ))}
      </div>
      <div className="zkp-info">
        Z karty: klasa {g.rows[0]?.r_range_code}, {g.rows[0]?.r_leaves === 2 ? 'dwuskrzydłowe' : 'jednoskrzydłowe'}; wysokość {maxH || '—'} mm ± 2 mm (największa z wybranych; można nadpisać niżej).
        Puste pola = z ustawień (⚙ Certyfikaty i podpis).
      </div>
      <div className="order-form-grid zkp-form-grid">
        {field('certificate_no', kdwu ? 'Nr krajowego certyfikatu (AC 158)' : 'Nr certyfikatu stałości (NB 2310)', api.setting(kdwu ? 'cert_krajowy_nr' : 'cert_ce_nr') || 'z ustawień')}
        {field('mounting_text', 'Konstrukcje mocujące', api.setting('mounting_default') || 'np. ściany murowane ≥ 115 mm, żelbet ≥ 100 mm')}
        {field('height_mm', 'Wysokość [mm]', String(maxH || ''))}
        <label>
          <span className="order-field-label-text">Data wydania</span>
          <input type="date" value={f.issued_on} onChange={(e) => setF((p) => ({ ...p, issued_on: e.target.value }))} />
        </label>
        {!kdwu && field('test_reports', 'Sprawozdania LTB (NB 1827)', api.setting('ltb_sprawozdania') || 'z ustawień')}
        {!kdwu && field('ud_value', 'UD [W/(m²·K)]', api.setting('ud_default') || 'NPD')}
        {!kdwu && field('impact_class', 'Odporność na uderzenie', api.setting('impact_default') || 'NPD')}
        {field('signer_name', 'Podpisuje — imię i nazwisko', api.setting('signer_name') || 'z ustawień')}
        {field('signer_title', 'Podpisuje — stanowisko', api.setting('signer_title') || 'z ustawień')}
      </div>
    </ZkpModal>
  )
}

function SettingsModal({ api, onClose }: { api: ReturnType<typeof useZkpDeclarations>; onClose: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(ZKP_SETTING_LABELS.map((s) => [s.key, api.setting(s.key)])))
  const save = async () => {
    for (const s of ZKP_SETTING_LABELS) {
      if ((vals[s.key] ?? '') !== api.setting(s.key)) {
        const ok = await api.setSetting(s.key, vals[s.key] ?? '')
        if (!ok) return
      }
    }
    onClose()
  }
  return (
    <ZkpModal
      title="Deklaracje — certyfikaty, dokumenty odniesienia, podpisujący"
      onClose={onClose}
      busy={api.saving}
      width={760}
      footer={
        <>
          <button type="button" className="btn btn-primary" disabled={api.saving} onClick={() => void save()}>Zapisz</button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={api.saving}>Anuluj</button>
        </>
      }
    >
      <p className="zkp-hint">Wartości trafiają do nowych deklaracji (puste pole w oknie wystawiania = stąd). Numery certyfikatów tylko z certyfikatów wydanych dla MR Profil.</p>
      <div className="order-form-grid zkp-form-grid">
        {ZKP_SETTING_LABELS.map((s) => (
          <label key={s.key} style={s.key === 'mounting_default' ? { gridColumn: '1 / -1' } : undefined}>
            <span className="order-field-label-text">{s.label}</span>
            <input value={vals[s.key] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [s.key]: e.target.value }))} placeholder={s.hint} />
          </label>
        ))}
      </div>
    </ZkpModal>
  )
}
