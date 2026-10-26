import { useMemo, useState } from 'react'
import DataTable, { type DataTableColumn } from '../DataTable'
import ZkpModal from './ZkpModal'
import { printRegister624Pdf } from '../../utils/zkpPdf'
import { register624Rows } from '../../lib/zkpPrint'
import {
  ZKP_CRITICAL_KIND_LABELS,
  ZKP_LOT_DECISION_LABELS,
  ZKP_QUALITY_DOC_KINDS,
  zkpSupplierState,
  zkpWillForceQuarantine,
  type ZkpLotDecision,
  type ZkpMaterialLot,
} from '../../lib/zkp'
import type { ZkpData, ZkpSub } from './ZkpView'

type Props = {
  zkp: ZkpData
  canReceive: boolean
  canDecide: boolean
  onGoTo: (sub: ZkpSub) => void
}

const today = () => new Date().toLocaleDateString('sv-SE')
const fmtDate = (ymd: string | null | undefined) => (ymd ? ymd.slice(0, 10).split('-').reverse().join('.') : '—')
const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : ''
const yesNo = (v: boolean) => (v ? '✓' : '✗')

const ACCEPT_SCAN = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png'

export default function ZkpReceiptsPanel({ zkp, canReceive, canDecide, onGoTo }: Props) {
  const [decisionFilter, setDecisionFilter] = useState<'' | ZkpLotDecision>('')
  const [search, setSearch] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [completeLot, setCompleteLot] = useState<ZkpMaterialLot | null>(null)
  const [decideLot, setDecideLot] = useState<ZkpMaterialLot | null>(null)
  const [printOpen, setPrintOpen] = useState(false)

  const componentById = useMemo(() => new Map(zkp.components.map((c) => [c.id, c])), [zkp.components])
  const supplierById = useMemo(() => new Map(zkp.suppliers.map((s) => [s.id, s])), [zkp.suppliers])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return zkp.lots.filter((l) => {
      if (decisionFilter && l.decision !== decisionFilter) return false
      if (!q) return true
      const c = componentById.get(l.component_id)
      const s = supplierById.get(l.supplier_id)
      return [l.lot_no, l.delivery_doc, l.catalog_no, l.quality_doc_no, l.pz_reference, c?.name, c?.code, s?.name]
        .some((v) => String(v ?? '').toLowerCase().includes(q))
    })
  }, [zkp.lots, decisionFilter, search, componentById, supplierById])

  const columns = useMemo<DataTableColumn<ZkpMaterialLot>[]>(
    () => [
      { key: 'received_on', label: 'DATA', sortValue: (l) => l.received_on, render: (l) => fmtDate(l.received_on) },
      {
        key: 'component',
        label: 'KOMPONENT',
        headerSub: 'RODZAJ · NR KATALOGOWY',
        sortValue: (l) => componentById.get(l.component_id)?.name ?? '',
        render: (l) => {
          const c = componentById.get(l.component_id)
          const kind = c?.zkp_critical_kind ? ZKP_CRITICAL_KIND_LABELS[c.zkp_critical_kind] : ''
          return (
            <>
              <div>{c?.name ?? `#${l.component_id}`}</div>
              <div className="dt-stack-sub">{[kind, l.catalog_no].filter(Boolean).join(' · ') || '—'}</div>
            </>
          )
        },
      },
      {
        key: 'supplier',
        label: 'DOSTAWCA',
        headerSub: 'WZ / FAKTURA',
        sortValue: (l) => supplierById.get(l.supplier_id)?.name ?? '',
        render: (l) => (
          <>
            <div>{supplierById.get(l.supplier_id)?.name ?? `#${l.supplier_id}`}</div>
            <div className="dt-stack-sub">{l.delivery_doc}</div>
          </>
        ),
      },
      {
        key: 'quantity',
        label: 'ILOŚĆ',
        headerSub: 'WYDANO',
        sortValue: (l) => l.quantity,
        render: (l) => {
          const unit = componentById.get(l.component_id)?.unit ?? ''
          return (
            <>
              <div>
                {l.quantity} {unit}
              </div>
              <div className="dt-stack-sub">{l.qty_issued ? `${l.qty_issued} ${unit}` : '—'}</div>
            </>
          )
        },
      },
      { key: 'lot_no', label: 'NR PARTII', sortValue: (l) => l.lot_no, render: (l) => l.lot_no || <span className="zkp-missing">brak</span> },
      {
        key: 'quality',
        label: 'DOKUMENT JAKOŚCI',
        render: (l) => (
          <>
            <div>{[l.quality_doc_kind, l.quality_doc_no].filter(Boolean).join(' ') || <span className="zkp-missing">brak</span>}</div>
            {l.quality_doc_path && (
              <button type="button" className="zkp-link" onClick={() => void zkp.openScan(l.quality_doc_path as string)}>
                📎 skan
              </button>
            )}
          </>
        ),
      },
      {
        key: 'checks',
        label: 'KONTROLA',
        headerSub: 'ZAMÓW. · 6.10.5 · STAN',
        render: (l) => (
          <span title={l.condition_notes || undefined} className={l.conforms_to_order && l.conforms_to_list_6105 && l.condition_ok ? '' : 'zkp-warn'}>
            {yesNo(l.conforms_to_order)} · {yesNo(l.conforms_to_list_6105)} · {yesNo(l.condition_ok)}
            {l.condition_notes ? ' 💬' : ''}
          </span>
        ),
      },
      {
        key: 'decision',
        label: 'DECYZJA',
        sortValue: (l) => l.decision,
        render: (l) => (
          <>
            <span className={`zkp-decision zkp-decision--${l.decision}`}>{ZKP_LOT_DECISION_LABELS[l.decision]}</span>
            {l.decision_reason && <div className="dt-stack-sub" title={l.decision_reason}>{l.decision_reason}</div>}
            {l.decided_by_name && (
              <div className="dt-stack-sub">
                {l.decided_by_name} · {fmtDateTime(l.decided_at)}
              </div>
            )}
          </>
        ),
      },
      {
        key: 'received_by',
        label: 'PRZYJĄŁ',
        headerSub: 'PZ',
        render: (l) => (
          <>
            <div>{l.received_by_name || '—'}</div>
            <div className="dt-stack-sub">{l.pz_reference || ''}</div>
          </>
        ),
      },
      {
        key: 'actions',
        label: '',
        stopRowClick: true,
        render: (l) =>
          l.decision === 'kwarantanna' ? (
            <span className="zkp-actions">
              {canReceive && (
                <button type="button" className="btn btn-sm btn-secondary" disabled={zkp.saving} onClick={() => setCompleteLot(l)}>
                  Uzupełnij
                </button>
              )}
              {canDecide && (
                <button type="button" className="btn btn-sm btn-primary" disabled={zkp.saving} onClick={() => setDecideLot(l)}>
                  Decyzja…
                </button>
              )}
            </span>
          ) : null,
      },
    ],
    [componentById, supplierById, zkp, canReceive, canDecide],
  )

  return (
    <div>
      <div className="orders-filters zkp-toolbar">
        <select value={decisionFilter} onChange={(e) => setDecisionFilter(e.target.value as '' | ZkpLotDecision)} className="day-filter">
          <option value="">Wszystkie decyzje</option>
          <option value="kwarantanna">Kwarantanna</option>
          <option value="przyjeto">Przyjęto</option>
          <option value="zwrot">Zwrot</option>
        </select>
        <input
          type="text"
          className="search-input"
          placeholder="Szukaj: partia, komponent, dostawca, WZ…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 260 }}
        />
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void zkp.reload()} disabled={zkp.loading}>
          Odśwież
        </button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => setPrintOpen(true)} disabled={zkp.lots.length === 0}>
          🖨 Rejestr 6.24 (PDF)
        </button>
        {canReceive && (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setNewOpen(true)} style={{ marginLeft: 'auto' }}>
            + Nowe przyjęcie
          </button>
        )}
      </div>

      <DataTable
        rows={rows}
        rowKey={(l) => l.id}
        columns={columns}
        loading={zkp.loading}
        emptyText="Brak przyjęć komponentów krytycznych."
        rowClassName={(l) => (l.decision === 'kwarantanna' ? 'zkp-row--quarantine' : undefined)}
      />

      {printOpen && <Print624Modal zkp={zkp} onClose={() => setPrintOpen(false)} />}
      {newOpen && <ReceiptModal zkp={zkp} onClose={() => setNewOpen(false)} onGoTo={onGoTo} />}
      {completeLot && <CompleteModal zkp={zkp} lot={completeLot} onClose={() => setCompleteLot(null)} />}
      {decideLot && <DecideModal zkp={zkp} lot={decideLot} onClose={() => setDecideLot(null)} />}
    </div>
  )
}

// ── Nowe przyjęcie (zał. 6.24) ───────────────────────────────────────────────
function ReceiptModal({ zkp, onClose, onGoTo }: { zkp: ZkpData; onClose: () => void; onGoTo: (s: ZkpSub) => void }) {
  const critical = useMemo(() => zkp.components.filter((c) => c.zkp_critical_kind && c.is_active), [zkp.components])
  const supplierOptions = useMemo(() => {
    const t = today()
    return zkp.suppliers
      .map((s) => {
        const st = zkpSupplierState(
          zkp.qualifications.find((q) => q.supplier_id === s.id),
          zkp.assessments.filter((a) => a.supplier_id === s.id),
          t,
        )
        return { ...s, qualified: st.qualified, onList: st.onList }
      })
      .filter((s) => s.onList)
      .sort((a, b) => Number(b.qualified) - Number(a.qualified) || a.name.localeCompare(b.name, 'pl'))
  }, [zkp.suppliers, zkp.qualifications, zkp.assessments])

  const [f, setF] = useState({
    received_on: today(),
    supplier_id: '',
    delivery_doc: '',
    component_id: '',
    catalog_no: '',
    quantity: '',
    lot_no: '',
    quality_doc_kind: '',
    quality_doc_no: '',
    conforms_to_order: true,
    conforms_to_list_6105: true,
    condition_ok: true,
    condition_notes: '',
    decision: 'przyjeto' as ZkpLotDecision,
    decision_reason: '',
    pz_reference: '',
  })
  const [scan, setScan] = useState<File | null>(null)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))

  const forced = zkpWillForceQuarantine({ decision: f.decision, lot_no: f.lot_no, quality_doc_no: f.quality_doc_no, hasScan: !!scan })
  const qty = Number(String(f.quantity).replace(',', '.'))
  const problems = [
    !f.supplier_id && 'Wybierz dostawcę z wykazu kwalifikowanych.',
    !f.delivery_doc.trim() && 'Podaj nr WZ / faktury.',
    !f.component_id && 'Wybierz komponent krytyczny.',
    !(qty > 0) && 'Ilość musi być większa od zera.',
    (f.decision === 'zwrot' || !f.condition_ok || !f.conforms_to_order || !f.conforms_to_list_6105) &&
      !f.decision_reason.trim() &&
      f.decision !== 'kwarantanna' &&
      'Przy zwrocie albo niezgodności podaj uzasadnienie.',
  ].filter(Boolean) as string[]

  const pickComponent = (id: string) => {
    const c = critical.find((x) => String(x.id) === id)
    setF((p) => ({ ...p, component_id: id, catalog_no: p.catalog_no || c?.zkp_model || '' }))
  }
  const pickSupplier = (id: string) => {
    const q = zkp.qualifications.find((x) => String(x.supplier_id) === id)
    setF((p) => ({ ...p, supplier_id: id, quality_doc_kind: p.quality_doc_kind || q?.required_quality_doc || '' }))
  }

  const save = async () => {
    if (problems.length) return
    const ok = await zkp.registerReceipt({
      received_on: f.received_on,
      supplier_id: Number(f.supplier_id),
      delivery_doc: f.delivery_doc,
      component_id: Number(f.component_id),
      catalog_no: f.catalog_no,
      quantity: qty,
      lot_no: f.lot_no,
      quality_doc_kind: f.quality_doc_kind,
      quality_doc_no: f.quality_doc_no,
      scan,
      conforms_to_order: f.conforms_to_order,
      conforms_to_list_6105: f.conforms_to_list_6105,
      condition_ok: f.condition_ok,
      condition_notes: f.condition_notes,
      decision: f.decision,
      decision_reason: f.decision_reason,
      pz_reference: f.pz_reference,
    })
    if (ok) onClose()
  }

  const missingSetup = critical.length === 0 || supplierOptions.every((s) => !s.qualified)

  return (
    <ZkpModal
      title="Przyjęcie komponentu krytycznego (zał. 6.24)"
      onClose={onClose}
      busy={zkp.saving}
      footer={
        <>
          <button type="button" className="btn btn-primary" disabled={zkp.saving || problems.length > 0} onClick={() => void save()}>
            {zkp.saving ? 'Zapisuję…' : 'Zapisz przyjęcie'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={zkp.saving}>
            Anuluj
          </button>
        </>
      }
    >
      {missingSetup && (
        <div className="zkp-info">
          {critical.length === 0 && (
            <div>
              Brak komponentów na liście krytycznych.{' '}
              <button type="button" className="zkp-link" onClick={() => { onClose(); onGoTo('komponenty') }}>
                Komponenty krytyczne (6.10.5) →
              </button>
            </div>
          )}
          {supplierOptions.every((s) => !s.qualified) && (
            <div>
              Brak dostawców kwalifikowanych (wpis na wykazie + ocena pozytywna/warunkowa).{' '}
              <button type="button" className="zkp-link" onClick={() => { onClose(); onGoTo('dostawcy') }}>
                Dostawcy kwalifikowani (6.31) →
              </button>
            </div>
          )}
        </div>
      )}

      <div className="order-form-grid zkp-form-grid">
        <label>
          <span className="order-field-label-text">Data przyjęcia *</span>
          <input type="date" value={f.received_on} onChange={(e) => set('received_on', e.target.value)} />
        </label>
        <label>
          <span className="order-field-label-text">Dostawca (wykaz 6.31) *</span>
          <select value={f.supplier_id} onChange={(e) => pickSupplier(e.target.value)}>
            <option value="">— wybierz —</option>
            {supplierOptions.map((s) => (
              <option key={s.id} value={s.id} disabled={!s.qualified}>
                {s.name}
                {s.qualified ? '' : ' — niekwalifikowany (ocena negatywna / brak oceny)'}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="order-field-label-text">Nr WZ / faktury *</span>
          <input value={f.delivery_doc} onChange={(e) => set('delivery_doc', e.target.value)} />
        </label>
        <label>
          <span className="order-field-label-text">Komponent krytyczny (6.10.5) *</span>
          <select value={f.component_id} onChange={(e) => pickComponent(e.target.value)}>
            <option value="">— wybierz —</option>
            {critical.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.zkp_critical_kind ? ` · ${ZKP_CRITICAL_KIND_LABELS[c.zkp_critical_kind]}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="order-field-label-text">Nr katalogowy / model</span>
          <input value={f.catalog_no} onChange={(e) => set('catalog_no', e.target.value)} />
        </label>
        <label>
          <span className="order-field-label-text">Ilość *</span>
          <input inputMode="decimal" value={f.quantity} onChange={(e) => set('quantity', e.target.value)} />
        </label>
        <label>
          <span className="order-field-label-text">Nr partii</span>
          <input value={f.lot_no} onChange={(e) => set('lot_no', e.target.value)} placeholder="brak = kwarantanna" />
        </label>
        <label>
          <span className="order-field-label-text">Rodzaj dokumentu jakości</span>
          <input list="zkp-quality-doc-kinds" value={f.quality_doc_kind} onChange={(e) => set('quality_doc_kind', e.target.value)} />
          <datalist id="zkp-quality-doc-kinds">
            {ZKP_QUALITY_DOC_KINDS.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        </label>
        <label>
          <span className="order-field-label-text">Nr dokumentu jakości</span>
          <input value={f.quality_doc_no} onChange={(e) => set('quality_doc_no', e.target.value)} />
        </label>
        <label>
          <span className="order-field-label-text">Skan dokumentu jakości (PDF/JPG/PNG)</span>
          <input type="file" accept={ACCEPT_SCAN} onChange={(e) => setScan(e.target.files?.[0] ?? null)} />
        </label>
        <label>
          <span className="order-field-label-text">Powiązanie z PZ</span>
          <input value={f.pz_reference} onChange={(e) => set('pz_reference', e.target.value)} placeholder="np. PZ/2026/123" />
        </label>
      </div>

      <div className="zkp-checks">
        <label>
          <input type="checkbox" checked={f.conforms_to_order} onChange={(e) => set('conforms_to_order', e.target.checked)} /> Zgodne z zamówieniem
        </label>
        <label>
          <input type="checkbox" checked={f.conforms_to_list_6105} onChange={(e) => set('conforms_to_list_6105', e.target.checked)} /> Zgodne z listą 6.10.5
          (model / nr DWU)
        </label>
        <label>
          <input type="checkbox" checked={f.condition_ok} onChange={(e) => set('condition_ok', e.target.checked)} /> Stan / opakowanie bez uwag
        </label>
      </div>
      <label className="order-field-full">
        <span className="order-field-label-text">Uwagi ze sprawdzenia</span>
        <input value={f.condition_notes} onChange={(e) => set('condition_notes', e.target.value)} />
      </label>

      <div className="zkp-decision-pick">
        <span className="order-field-label-text">Decyzja</span>
        {(['przyjeto', 'kwarantanna', 'zwrot'] as ZkpLotDecision[]).map((d) => (
          <label key={d}>
            <input type="radio" name="zkp-decision" checked={f.decision === d} onChange={() => set('decision', d)} /> {ZKP_LOT_DECISION_LABELS[d]}
          </label>
        ))}
      </div>
      <label className="order-field-full">
        <span className="order-field-label-text">Uzasadnienie decyzji</span>
        <input value={f.decision_reason} onChange={(e) => set('decision_reason', e.target.value)} />
      </label>

      {forced && (
        <div className="zkp-warnbox">
          Brak nr partii albo dokumentu jakości (numer lub skan) — przyjęcie zostanie zapisane jako <b>KWARANTANNA</b>. Partię zwolni
          Pełnomocnik / Zastępca po uzupełnieniu.
        </div>
      )}
      {problems.length > 0 && <div className="zkp-problems">{problems.join(' ')}</div>}
    </ZkpModal>
  )
}

// ── Uzupełnienie partii w kwarantannie ───────────────────────────────────────
function CompleteModal({ zkp, lot, onClose }: { zkp: ZkpData; lot: ZkpMaterialLot; onClose: () => void }) {
  const [lotNo, setLotNo] = useState(lot.lot_no)
  const [docKind, setDocKind] = useState(lot.quality_doc_kind)
  const [docNo, setDocNo] = useState(lot.quality_doc_no)
  const [scan, setScan] = useState<File | null>(null)
  const changed = lotNo.trim() !== lot.lot_no || docKind.trim() !== lot.quality_doc_kind || docNo.trim() !== lot.quality_doc_no || !!scan

  const save = async () => {
    if (await zkp.completeLot(lot.id, lotNo, docKind, docNo, scan)) onClose()
  }

  return (
    <ZkpModal
      title="Uzupełnij partię w kwarantannie"
      onClose={onClose}
      busy={zkp.saving}
      width={560}
      footer={
        <>
          <button type="button" className="btn btn-primary" disabled={zkp.saving || !changed} onClick={() => void save()}>
            {zkp.saving ? 'Zapisuję…' : 'Zapisz'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={zkp.saving}>
            Anuluj
          </button>
        </>
      }
    >
      <p className="zkp-hint">Uzupełnienie nie zwalnia partii — decyzję podejmuje Pełnomocnik ZKP albo Zastępca.</p>
      <div className="order-form-grid zkp-form-grid">
        <label>
          <span className="order-field-label-text">Nr partii</span>
          <input value={lotNo} onChange={(e) => setLotNo(e.target.value)} />
        </label>
        <label>
          <span className="order-field-label-text">Rodzaj dokumentu jakości</span>
          <input list="zkp-quality-doc-kinds-2" value={docKind} onChange={(e) => setDocKind(e.target.value)} />
          <datalist id="zkp-quality-doc-kinds-2">
            {ZKP_QUALITY_DOC_KINDS.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        </label>
        <label>
          <span className="order-field-label-text">Nr dokumentu jakości</span>
          <input value={docNo} onChange={(e) => setDocNo(e.target.value)} />
        </label>
        <label>
          <span className="order-field-label-text">Skan{lot.quality_doc_path ? ' (zastąpi bieżący)' : ''}</span>
          <input type="file" accept={ACCEPT_SCAN} onChange={(e) => setScan(e.target.files?.[0] ?? null)} />
        </label>
      </div>
    </ZkpModal>
  )
}

// ── Decyzja PJ / Zastępcy o partii z kwarantanny ─────────────────────────────
function DecideModal({ zkp, lot, onClose }: { zkp: ZkpData; lot: ZkpMaterialLot; onClose: () => void }) {
  const [decision, setDecision] = useState<'przyjeto' | 'zwrot'>('przyjeto')
  const [reason, setReason] = useState('')
  const incomplete = !lot.lot_no || (!lot.quality_doc_no && !lot.quality_doc_path)
  const blocked = decision === 'przyjeto' && incomplete

  const save = async () => {
    if (await zkp.decideLot(lot.id, decision, reason)) onClose()
  }

  return (
    <ZkpModal
      title="Decyzja o partii z kwarantanny"
      onClose={onClose}
      busy={zkp.saving}
      width={560}
      footer={
        <>
          <button
            type="button"
            className={`btn ${decision === 'przyjeto' ? 'btn-success' : 'btn-danger'}`}
            disabled={zkp.saving || blocked || reason.trim().length < 3}
            onClick={() => void save()}
          >
            {zkp.saving ? 'Zapisuję…' : decision === 'przyjeto' ? 'Zwolnij partię' : 'Oznacz zwrot'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={zkp.saving}>
            Anuluj
          </button>
        </>
      }
    >
      <p className="zkp-hint">
        Partia {lot.lot_no || <span className="zkp-missing">bez numeru</span>} · {lot.quantity} · WZ {lot.delivery_doc}
      </p>
      <div className="zkp-decision-pick">
        <label>
          <input type="radio" name="zkp-decide" checked={decision === 'przyjeto'} onChange={() => setDecision('przyjeto')} /> Przyjąć (zwolnić z kwarantanny)
        </label>
        <label>
          <input type="radio" name="zkp-decide" checked={decision === 'zwrot'} onChange={() => setDecision('zwrot')} /> Zwrot do dostawcy
        </label>
      </div>
      <label className="order-field-full">
        <span className="order-field-label-text">Uzasadnienie * (min. 3 znaki)</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </label>
      {blocked && (
        <div className="zkp-warnbox">Nie można przyjąć partii bez nr partii i dokumentu jakości — najpierw „Uzupełnij”.</div>
      )}
    </ZkpModal>
  )
}

/** Wydruk rejestru przyjęć 6.24 za okres (domyślnie bieżący rok). */
function Print624Modal({ zkp, onClose }: { zkp: ZkpData; onClose: () => void }) {
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`)
  const [to, setTo] = useState(today())
  const input = { lots: zkp.lots, components: zkp.components, suppliers: zkp.suppliers, from, to }
  const count = register624Rows(input).length
  return (
    <ZkpModal
      title="Rejestr przyjęć komponentów krytycznych (zał. 6.24) — wydruk"
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" className="btn btn-primary" disabled={count === 0 || from > to} onClick={() => { printRegister624Pdf(input); onClose() }}>
            Drukuj ({count})
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Anuluj</button>
        </>
      }
    >
      <div className="order-form-grid zkp-form-grid">
        <label>
          <span className="order-field-label-text">Od (data przyjęcia)</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          <span className="order-field-label-text">Do</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <p className="zkp-hint">Wszystkie decyzje (także kwarantanna i zwrot), w kolejności przyjęć. PDF poziomy A4.</p>
    </ZkpModal>
  )
}
