import { useState } from 'react'
import { supabase } from '../../supabaseClient'
import { openExternalUrl } from '../../hooks/useAluOrders'
import { ALU_CONSTRUCTION_LABELS, ALU_REALIZACJA_LABELS, ALU_STAGE_DEFS, ORDER_DOCUMENTS_BUCKET } from '../../constants'
import { aluOrderExtra, aluStageDone, formatAluDims, formatAluGlass, formatAluNotes, formatPlDateWithDow } from '../../lib/alu'
import { formatProductionOrderNo } from '../../lib/aluConstructions'
import { findTrace, loadAluOrderTrace, type AluOrderTrace, type TraceOrderChoice } from '../../lib/aluTraceData'
import { describeTraceQuery, parseTraceQuery } from '../../lib/zkpTrace'
import { isReleaseDateEmpty } from '../../utils'
import DossierExportButton from '../DossierExportButton'
import type { AluDossierItem, OrderDocument, ToastVariant } from '../../types'

// Wyszukiwarka „od tabliczki" (ZKP 5.9, zał. 6.26): numer konstrukcji z tabliczki
// znamionowej → zlecenie, pozycja, postęp, teczka; eksport teczki dla audytora.
// Tylko odczyt — każdy z dostępem do zakładki ZKP.

type Props = { pushToast: (message: string, variant: ToastVariant) => void }

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'message'; text: string }
  | { kind: 'choices'; rows: TraceOrderChoice[] }
  | { kind: 'result'; trace: AluOrderTrace; constructionId: number | null }

const STATUS_BADGE: Record<AluDossierItem['r_status'], string> = {
  jest: 'badge badge-success',
  brak: 'badge badge-danger',
  nie_dotyczy: 'badge badge-neutral',
}
const STATUS_LABEL: Record<AluDossierItem['r_status'], string> = { jest: 'jest', brak: 'brak', nie_dotyczy: 'nie dotyczy' }

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
}

export default function ZkpTracePanel({ pushToast }: Props) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<State>({ kind: 'idle' })

  const openOrder = async (orderId: number, constructionId: number | null) => {
    setState({ kind: 'loading' })
    const res = await loadAluOrderTrace(orderId)
    if (!res.ok) {
      setState({ kind: 'message', text: `Błąd wczytywania zlecenia: ${res.error}` })
      return
    }
    setState({ kind: 'result', trace: res.value, constructionId })
  }

  const search = async () => {
    const q = parseTraceQuery(query)
    if (!q) {
      setState({ kind: 'message', text: 'Nie rozpoznano numeru. Wpisz numer z tabliczki (np. 2026/01/03), numer zlecenia w roku (2026/01) albo numer OF (OF341/2026).' })
      return
    }
    setState({ kind: 'loading' })
    const res = await findTrace(q)
    if (!res.ok) {
      setState({ kind: 'message', text: `Błąd wyszukiwania: ${res.error}` })
      return
    }
    if (res.value === null) {
      setState({ kind: 'message', text: `Nie znaleziono ${describeTraceQuery(q)}.` })
      return
    }
    if (Array.isArray(res.value)) {
      setState({ kind: 'choices', rows: res.value })
      return
    }
    await openOrder(res.value.orderId, res.value.constructionId)
  }

  const openDocument = async (doc: OrderDocument) => {
    const { data, error } = await supabase.storage.from(ORDER_DOCUMENTS_BUCKET).createSignedUrl(doc.storage_path, 600)
    if (error || !data?.signedUrl) {
      pushToast(`Nie udało się otworzyć ${doc.file_name}: ${error?.message ?? 'brak adresu'}`, 'error')
      return
    }
    if (!(await openExternalUrl(data.signedUrl))) pushToast('Nie udało się otworzyć przeglądarki z dokumentem', 'error')
  }

  return (
    <div className="zkp-trace">
      <form
        className="zkp-toolbar"
        onSubmit={(e) => {
          e.preventDefault()
          void search()
        }}
      >
        <input
          autoFocus
          className="zkp-trace-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Numer z tabliczki: 2026/01/03 · zlecenie 2026/01 · OF341/2026"
          aria-label="Numer konstrukcji z tabliczki znamionowej"
        />
        <button type="submit" className="btn btn-primary" disabled={state.kind === 'loading'}>
          {state.kind === 'loading' ? 'Szukam…' : 'Szukaj'}
        </button>
      </form>

      {state.kind === 'idle' && (
        <p className="zkp-hint">
          Ścieżka audytora: tabliczka → konstrukcja → zlecenie i teczka. Działa też skaner kodu QR z etykiety (ID zlecenia).
        </p>
      )}
      {state.kind === 'message' && <p className="zkp-missing">{state.text}</p>}
      {state.kind === 'choices' && (
        <div className="zkp-info">
          <span>Kilka zleceń o tym numerze — wybierz:</span>
          {state.rows.map((r) => (
            <button key={r.id} type="button" className="zkp-link" onClick={() => void openOrder(r.id, null)}>
              {r.order_number} — {r.company || '—'}
            </button>
          ))}
        </div>
      )}
      {state.kind === 'result' && (
        <TraceResult
          trace={state.trace}
          constructionId={state.constructionId}
          onSelectConstruction={(id) => setState({ ...state, constructionId: id })}
          onOpenDocument={(d) => void openDocument(d)}
          pushToast={pushToast}
        />
      )}
    </div>
  )
}

function TraceResult({
  trace, constructionId, onSelectConstruction, onOpenDocument, pushToast,
}: {
  trace: AluOrderTrace
  constructionId: number | null
  onSelectConstruction: (id: number | null) => void
  onOpenDocument: (doc: OrderDocument) => void
  pushToast: (message: string, variant: ToastVariant) => void
}) {
  const { order, production, positions, constructions, documents, dossier } = trace
  const extra = aluOrderExtra(order)
  const cancelled = (order.extra_fields as Record<string, unknown> | null)?.cancelled === true
  const status = cancelled ? 'Anulowane' : !isReleaseDateEmpty(order.release_date) ? `Wydane ${order.release_date}` : 'W realizacji'
  const construction = constructions.find((c) => c.id === constructionId) ?? null
  const position = construction?.position_id != null ? positions.find((p) => p.id === construction.position_id) ?? null : null
  const docById = new Map(documents.map((d) => [d.id, d]))
  const missing = dossier.filter((i) => i.r_status === 'brak').length
  const sorted = [...constructions].sort((a, b) => a.pp - b.pp)

  return (
    <div className="zkp-trace-result">
      <div className="zkp-trace-hero">
        <span className="zkp-trace-no">{construction ? construction.construction_no : order.order_number}</span>
        {construction && (
          <span className={construction.status === 'aktywna' ? 'badge badge-success' : 'badge badge-danger'}>
            {construction.status === 'aktywna' ? 'aktywna' : `anulowana — ${construction.status_reason ?? ''}`}
          </span>
        )}
        <span className={trace.isZkp ? 'badge badge-warning' : 'badge badge-neutral'}>{trace.isZkp ? 'ZKP AS 75EI' : 'bez ZKP'}</span>
        {trace.isZkp && (
          <span className={missing ? 'badge badge-danger' : 'badge badge-success'}>
            {missing ? `teczka: brakuje ${missing}` : 'teczka kompletna'}
          </span>
        )}
        <span style={{ marginLeft: 'auto' }}>
          <DossierExportButton orderId={order.id!} pushToast={pushToast} className="btn btn-sm btn-primary" />
        </span>
      </div>

      <h3 className="zkp-trace-h">Zlecenie</h3>
      <div className="alu-details-grid">
        <div><span className="alu-details-label">Nr OF</span>{order.order_number}</div>
        <div><span className="alu-details-label">Klient</span>{order.company || '—'}</div>
        <div>
          <span className="alu-details-label">Nr zlecenia w roku</span>
          {production ? `${formatProductionOrderNo(production.year, production.zz)} · ${fmt(production.started_at)}${production.started_by_name ? ` · ${production.started_by_name}` : ''}` : 'nieuruchomione'}
        </div>
        <div><span className="alu-details-label">Lista produkcyjna</span>{extra.lp_number || '—'}</div>
        <div><span className="alu-details-label">Termin</span>{extra.deadline ? formatPlDateWithDow(extra.deadline) : '—'}</div>
        <div><span className="alu-details-label">Realizacja</span>{ALU_REALIZACJA_LABELS[extra.realizacja]}</div>
        <div><span className="alu-details-label">Status</span>{status}</div>
      </div>

      {construction && (
        <>
          <h3 className="zkp-trace-h">
            Konstrukcja — poz. {construction.pos_no}, sztuka {construction.piece_index}
            {position ? ` z ${position.quantity}` : ''}
          </h3>
          {position ? (
            <>
              <div className="alu-details-grid">
                <div><span className="alu-details-label">Typ</span>{ALU_CONSTRUCTION_LABELS[position.construction_type] ?? position.construction_type}</div>
                <div><span className="alu-details-label">System</span>{position.system || '—'}</div>
                <div><span className="alu-details-label">Wymiary</span>{formatAluDims(position.width_mm, position.height_mm) || '—'}</div>
                <div><span className="alu-details-label">Kolor profili / okuć</span>{[position.profile_color, position.hardware_color].filter(Boolean).join(' / ') || '—'}</div>
                <div style={{ gridColumn: '1 / -1' }}><span className="alu-details-label">Opis</span>{position.description || '—'}</div>
                {position.fillings && <div style={{ gridColumn: '1 / -1' }}><span className="alu-details-label">Wypełnienia</span>{position.fillings}</div>}
                {formatAluGlass(position.glass) && <div style={{ gridColumn: '1 / -1' }}><span className="alu-details-label">Szyby</span>{formatAluGlass(position.glass)}</div>}
                {formatAluNotes(position.notes) && <div style={{ gridColumn: '1 / -1' }}><span className="alu-details-label">Uwagi produkcyjne</span>{formatAluNotes(position.notes)}</div>}
              </div>
              <table className="zkp-history" style={{ marginTop: 8 }}>
                <thead>
                  <tr><th>Etap</th><th>Zrobione sztuki pozycji</th><th>Kto (kolejne kliknięcia)</th></tr>
                </thead>
                <tbody>
                  {ALU_STAGE_DEFS.map((s) => {
                    const done = aluStageDone(position.production_stages, s.key, position.quantity)
                    return (
                      <tr key={s.key}>
                        <td>{s.title}</td>
                        <td>{done} / {position.quantity}</td>
                        <td>{(position.production_stages?.[s.key]?.marks ?? []).join(', ') || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          ) : (
            <p className="zkp-hint">Pozycja usunięta ze zlecenia — numer konstrukcji zostaje w bazie jako anulowany.</p>
          )}
        </>
      )}

      <h3 className="zkp-trace-h">Partie komponentów (6.24 → 6.25)</h3>
      <p className="zkp-hint">
        Powiązanie partii (uszczelka pęczniejąca, wkład, szkło) z konstrukcją pojawi się z kartą wyrobu i wydaniem partii na
        zlecenie — wtedy tutaj: konstrukcja → partia → przyjęcie 6.24 → dokument jakości i WZ.
      </p>

      {dossier.length > 0 && (
        <>
          <h3 className="zkp-trace-h">Teczka zlecenia (ZKP 5.9)</h3>
          <table className="zkp-history">
            <thead>
              <tr><th>Dokument</th><th>Stan</th><th>Szczegóły</th><th>Kiedy / kto</th><th /></tr>
            </thead>
            <tbody>
              {dossier.map((i) => {
                const doc = i.r_document_id != null ? docById.get(i.r_document_id) : undefined
                return (
                  <tr key={i.r_item_key}>
                    <td>{i.r_label}</td>
                    <td><span className={STATUS_BADGE[i.r_status]}>{STATUS_LABEL[i.r_status]}</span></td>
                    <td>{i.r_detail}</td>
                    <td>{[i.r_at ? fmt(i.r_at) : '', i.r_by ?? ''].filter(Boolean).join(' · ')}</td>
                    <td>{doc && <button type="button" className="zkp-link" onClick={() => onOpenDocument(doc)}>otwórz</button>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}

      <h3 className="zkp-trace-h">Konstrukcje zlecenia ({constructions.length})</h3>
      {sorted.length ? (
        <div className="zkp-trace-chips">
          {sorted.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`badge ${c.id === constructionId ? 'badge-warning' : 'badge-neutral'} zkp-trace-chip`}
              style={c.status === 'anulowana' ? { textDecoration: 'line-through', opacity: 0.55 } : undefined}
              title={`Poz. ${c.pos_no}, sztuka ${c.piece_index}${c.status === 'anulowana' ? ` — anulowana: ${c.status_reason ?? ''}` : ''}`}
              onClick={() => onSelectConstruction(c.id === constructionId ? null : c.id)}
            >
              {c.construction_no}
            </button>
          ))}
        </div>
      ) : (
        <p className="zkp-hint">Zlecenie nieuruchomione do produkcji — numery konstrukcji nadaje „▶ Uruchom do produkcji”.</p>
      )}
    </div>
  )
}
