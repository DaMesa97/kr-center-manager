import { useCallback, useEffect, useRef, useState } from 'react'
import { appAlert, appPrompt } from '../lib/appDialogs'
import { DOC_KIND_LABELS, DOSSIER_UPLOAD_KINDS, documentVersions } from '../lib/aluDossier'
import DossierExportButton from './DossierExportButton'
import type { AluDossierItem, Order, OrderDocument, OrderDocumentKind, ToastVariant } from '../types'

// Teczka zlecenia aluminium (ZKP 5.9): lista dokumentów „jest / brak / nie dotyczy"
// (tylko dla zleceń ZKP = AS 75EI) i historia WSZYSTKICH wersji dokumentów —
// nowy plik nie nadpisuje poprzedniego, dokument można tylko wycofać z powodem
// (ZKP 5.1.6, zał. 6.34).

type DossierData = { items: AluDossierItem[]; isZkp: boolean; zkpOverride: boolean | null }

type Props = {
  order: Order
  documents: OrderDocument[]
  isManager: boolean
  /** ZKP 5.3.2: „nie dotyczy" — Pełnomocnik, Zastępca, Kierownik Produkcji */
  canDecideZkp: boolean
  uploading: boolean
  onOpenDocument: (doc: OrderDocument) => void
  onUploadDocument: (kind: OrderDocumentKind, file: File) => Promise<void>
  onWithdrawDocument: (doc: OrderDocument, reason: string) => Promise<boolean>
  fetchDossier: (orderId: number) => Promise<DossierData | null>
  onSetZkp: (orderId: number, value: boolean | null) => Promise<boolean>
  onSetNa: (orderId: number, itemKey: string, reason: string) => Promise<boolean>
  onRevokeNa: (naId: number, reason: string) => Promise<boolean>
  /** eksport teczki (ZIP dla audytora) — brak = bez przycisku */
  pushToast?: (message: string, variant: ToastVariant) => void
}

const STATUS_LABELS: Record<AluDossierItem['r_status'], string> = {
  jest: 'jest',
  brak: 'brak',
  nie_dotyczy: 'nie dotyczy',
}
const STATUS_BADGE: Record<AluDossierItem['r_status'], string> = {
  jest: 'badge badge-success',
  brak: 'badge badge-danger',
  nie_dotyczy: 'badge badge-neutral',
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
}

export default function AluDossierPanel({
  order, documents, isManager, canDecideZkp, uploading, onOpenDocument, onUploadDocument, onWithdrawDocument,
  fetchDossier, onSetZkp, onSetNa, onRevokeNa, pushToast,
}: Props) {
  const orderId = order.id!
  const [data, setData] = useState<DossierData | null>(null)
  const [uploadKind, setUploadKind] = useState<OrderDocumentKind>('ZK')
  const fileRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    setData(await fetchDossier(orderId))
  }, [fetchDossier, orderId])

  // dokumenty zmieniają się po wgraniu/wycofaniu (fetchAluData) → odśwież stan teczki
  useEffect(() => {
    void reload()
  }, [reload, documents])

  const handleZkpChange = async (value: string) => {
    const v = value === 'auto' ? null : value === 'tak'
    if (await onSetZkp(orderId, v)) await reload()
  }

  const handleNa = async (item: AluDossierItem) => {
    const reason = await appPrompt(`Dlaczego „${item.r_label}" nie dotyczy tego zlecenia?`, {
      title: 'Nie dotyczy — decyzja ZKP',
      confirmLabel: 'Zapisz',
    })
    if (reason == null) return
    if (await onSetNa(orderId, item.r_item_key, reason)) await reload()
  }

  const handleRevokeNa = async (item: AluDossierItem) => {
    if (item.r_na_id == null) return
    const reason = await appPrompt(`Powód cofnięcia „nie dotyczy" dla „${item.r_label}":`, {
      title: 'Cofnięcie decyzji',
      confirmLabel: 'Cofnij',
    })
    if (reason == null) return
    if (await onRevokeNa(item.r_na_id, reason)) await reload()
  }

  const handleWithdraw = async (doc: OrderDocument) => {
    const reason = await appPrompt(
      `Wycofać ${DOC_KIND_LABELS[doc.kind]} v${doc.version} (${doc.file_name})? Plik zostaje w teczce jako wycofany. Podaj powód:`,
      { title: 'Wycofanie dokumentu', confirmLabel: 'Wycofaj' },
    )
    if (reason == null) return
    await onWithdrawDocument(doc, reason)
  }

  const onFilePicked = async (file: File | null) => {
    if (!file) return
    if (!/\.pdf$/i.test(file.name)) {
      await appAlert('Do teczki można dodać tylko pliki PDF.')
      return
    }
    await onUploadDocument(uploadKind, file)
    if (fileRef.current) fileRef.current.value = ''
  }

  const kindsPresent = Array.from(new Set(documents.map((d) => d.kind)))
  const missing = data?.items.filter((i) => i.r_status === 'brak').length ?? 0

  return (
    <div className="alu-dossier">
      <div className="alu-docs-row" style={{ flexWrap: 'wrap' }}>
        <span className="alu-details-label">Teczka zlecenia (ZKP 5.9)</span>
        {data && (
          <span
            className={data.isZkp ? 'badge badge-warning' : 'badge badge-neutral'}
            title={data.zkpOverride === null ? 'Rozpoznane automatycznie po systemie pozycji (AS 75EI)' : 'Oznaczone ręcznie przez kierownika'}
          >
            {data.isZkp ? 'Zlecenie ZKP (AS 75EI)' : 'Bez ZKP'}
            {data.zkpOverride === null ? ' · auto' : ' · ręcznie'}
          </span>
        )}
        {data?.isZkp && (
          <span className={missing ? 'badge badge-danger' : 'badge badge-success'}>
            {missing ? `brakuje ${missing} — wydanie zablokowane` : 'teczka kompletna'}
          </span>
        )}
        {isManager && data && (
          <select
            value={data.zkpOverride === null ? 'auto' : data.zkpOverride ? 'tak' : 'nie'}
            onChange={(e) => void handleZkpChange(e.target.value)}
            title="Reguły ZKP (teczka, karta, protokół, deklaracje) dotyczą tylko AS 75EI"
          >
            <option value="auto">ZKP: automatycznie</option>
            <option value="tak">ZKP: tak (AS 75EI)</option>
            <option value="nie">ZKP: nie</option>
          </select>
        )}
        {pushToast && documents.length > 0 && <DossierExportButton orderId={orderId} pushToast={pushToast} />}
      </div>

      {data?.isZkp && (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Dokument</th>
                <th>Stan</th>
                <th>Szczegóły</th>
                <th>Kiedy / kto</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.r_item_key}>
                  <td>{item.r_label}</td>
                  <td><span className={STATUS_BADGE[item.r_status]}>{STATUS_LABELS[item.r_status]}</span></td>
                  <td>{item.r_detail}</td>
                  <td>{[fmt(item.r_at), item.r_by].filter(Boolean).join(' · ')}</td>
                  <td>
                    {canDecideZkp && item.r_na_allowed && item.r_status === 'brak' && (
                      <button type="button" className="btn btn-sm btn-secondary" onClick={() => void handleNa(item)}>
                        Nie dotyczy…
                      </button>
                    )}
                    {canDecideZkp && item.r_status === 'nie_dotyczy' && (
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => void handleRevokeNa(item)}>
                        Cofnij
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {kindsPresent.length > 0 && (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Rodzaj</th>
                <th>Wersja</th>
                <th>Plik</th>
                <th>Dodano</th>
                <th>Stan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {kindsPresent.flatMap((kind) =>
                documentVersions(documents, kind).map((doc) => (
                  <tr key={doc.id} style={doc.withdrawn_at ? { opacity: 0.6 } : undefined}>
                    <td>{DOC_KIND_LABELS[doc.kind] ?? doc.kind}</td>
                    <td>v{doc.version ?? 1}</td>
                    <td>{doc.file_name}{doc.number ? ` (${doc.number})` : ''}</td>
                    <td>{[fmt(doc.uploaded_at), doc.uploaded_by_name].filter(Boolean).join(' · ')}</td>
                    <td title={doc.withdraw_reason ?? undefined}>
                      {doc.withdrawn_at ? `wycofany ${fmt(doc.withdrawn_at)}: ${doc.withdraw_reason ?? ''}` : 'aktualny'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn btn-sm btn-secondary" onClick={() => onOpenDocument(doc)}>
                        Otwórz
                      </button>
                      {isManager && !doc.withdrawn_at && (
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void handleWithdraw(doc)}>
                          Wycofaj…
                        </button>
                      )}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}

      {isManager && (
        <div className="alu-docs-row">
          <span className="alu-details-label">Dodaj do teczki</span>
          <select value={uploadKind} onChange={(e) => setUploadKind(e.target.value as OrderDocumentKind)}>
            {DOSSIER_UPLOAD_KINDS.map((k) => (
              <option key={k} value={k}>{DOC_KIND_LABELS[k]}</option>
            ))}
          </select>
          <button type="button" className="btn btn-sm btn-primary" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? 'Wgrywam…' : '+ Plik PDF'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            style={{ display: 'none' }}
            onChange={(e) => void onFilePicked(e.target.files?.[0] ?? null)}
          />
        </div>
      )}
    </div>
  )
}
