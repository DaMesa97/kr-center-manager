// =====================================================================
// CRM Po Drzwi → „Maile” (brief pkt 11, 14.11.2026): lista crm.maile (przychodzące
// analizowane przez AI jak rozmowy, wychodzące dopasowane do ofert) + podgląd
// jednego maila. W trybie handlowca bez analizy i kosztu AI. „Analizuj ponownie”
// = status 'nowy' (trigger w bazie zleca analizę; tylko przychodzące).
// MailList jest też używana na karcie klienta (obok rozmów).
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ToastVariant } from '../../types'
import { CRM_AKCJA, CRM_MAIL_KIERUNEK, CRM_MAIL_STATUS, CRM_MAIL_TYP, type CrmMail } from '../../types/crm'
import { fetchMail, fetchMaile, retryMailAnaliza, type CrmError } from '../../hooks/useCrm'
import { appConfirm } from '../../lib/appDialogs'
import DataTable, { type DataTableColumn } from '../DataTable'
import Spinner from '../Spinner'
import { useCrmActive, useOnCrmReshow } from './crmActive'

type Mode = 'handlowiec' | 'pelny'
type PushToast = (message: string, variant: ToastVariant) => void

const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const fromLabel = (m: CrmMail): string => (m.od_nazwa ? `${m.od_nazwa} <${m.od_adres ?? ''}>` : m.od_adres ?? '—')
const toLabel = (m: CrmMail): string => (m.do_adresy && m.do_adresy.length ? m.do_adresy.join(', ') : '—')
const leadLabel = (m: CrmMail): string => m.lead?.nazwa || m.lead?.email || m.lead?.telefon || '—'

function StatusChip({ status }: { status: string | null }) {
  if (!status) return null
  const st = CRM_MAIL_STATUS[status] ?? { label: status, cls: 'crm-status--muted' }
  return <span className={`crm-status ${st.cls}`}>{st.label}</span>
}

/** Lista maili w stylu rozmów (karta klienta i podgląd skrzynki). */
export function MailList({ maile, mode, onOpenMail }: { maile: CrmMail[]; mode: Mode; onOpenMail: (id: string) => void }) {
  if (maile.length === 0) return <p className="crm-muted">Brak maili.</p>
  return (
    <ul className="crm-calls">
      {maile.map((m) => (
        <li key={m.id} className={`crm-call${m.status_przetwarzania === 'blad' ? ' crm-call--blad' : ''}`}>
          <div className="crm-call-head">
            <span className="crm-call-when">{fmtDateTime(m.data ?? m.created_at)}</span>
            <span className={`crm-call-dir crm-call-dir--${m.kierunek ?? 'x'}`}>{CRM_MAIL_KIERUNEK[m.kierunek ?? ''] ?? m.kierunek ?? '—'}</span>
            <button type="button" className="crm-link" onClick={() => onOpenMail(m.id)} title="Otwórz mail">
              {m.temat || '(bez tematu)'}
            </button>
            {m.kanal === 'formularz' && <span className="crm-tag crm-kanal" title="Zgłoszenie z formularza kontaktowego strony">Formularz</span>}
            {mode === 'pelny' && m.typ && <span className="crm-call-typ" title="Sprawa (z analizy)">{CRM_MAIL_TYP[m.typ] ?? m.typ}</span>}
            {m.nastepna_akcja && CRM_AKCJA[m.nastepna_akcja] && <span className="crm-call-typ">{CRM_AKCJA[m.nastepna_akcja].label}</span>}
            {m.zalaczniki && m.zalaczniki.length > 0 && (
              <span className="crm-muted" title={m.zalaczniki.map((z) => z.nazwa ?? '').join(', ')}>
                {m.zalaczniki.length}
              </span>
            )}
            {(mode === 'pelny' || m.status_przetwarzania === 'blad' || m.status_przetwarzania === 'nowy') && <StatusChip status={m.status_przetwarzania} />}
          </div>
          <div className="crm-muted crm-mail-addr">{m.kierunek === 'wychodzacy' ? `do: ${toLabel(m)}` : `od: ${fromLabel(m)}`}</div>
          {m.status_przetwarzania === 'blad' && m.blad && <p className="crm-text-bad">{m.blad}</p>}
          {m.podsumowanie && <p className="crm-call-summary">{m.podsumowanie}</p>}
        </li>
      ))}
    </ul>
  )
}

type Filter = 'wszystkie' | 'przychodzacy' | 'wychodzacy'

export default function CrmMaileScreen({
  mode,
  onOpenMail,
  onOpenLead,
  onOpenOferta,
}: {
  mode: Mode
  onOpenMail: (id: string) => void
  onOpenLead: (id: string) => void
  onOpenOferta: (id: string) => void
}) {
  const [rows, setRows] = useState<CrmMail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)
  const [filter, setFilter] = useState<Filter>('wszystkie')
  const [q, setQ] = useState('')

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const res = await fetchMaile({ kierunek: filter === 'wszystkie' ? null : filter })
    setRows(res.data)
    setError(res.error)
    setLoading(false)
  }, [filter])

  useEffect(() => {
    void load()
  }, [load])
  useOnCrmReshow(() => void load(true))
  const visible = useCrmActive()

  // póki coś czeka na analizę — odśwież co 10 s (tylko na widocznym ekranie)
  const pending = rows.some((m) => m.status_przetwarzania === 'nowy')
  useEffect(() => {
    if (!pending || !visible) return
    const t = window.setInterval(() => void load(true), 10_000)
    return () => window.clearInterval(t)
  }, [pending, visible, load])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((m) =>
      [m.temat, m.od_adres, m.od_nazwa, m.podsumowanie, leadLabel(m), ...(m.do_adresy ?? [])].some((v) => (v ?? '').toLowerCase().includes(needle)),
    )
  }, [rows, q])

  const columns = useMemo<DataTableColumn<CrmMail>[]>(() => {
    const all: Array<DataTableColumn<CrmMail> & { pelnyOnly?: boolean }> = [
      { key: 'data', label: 'Data', sortValue: (m) => m.data ?? m.created_at, render: (m) => fmtDateTime(m.data ?? m.created_at) },
      {
        key: 'kierunek',
        label: 'Kierunek',
        sortValue: (m) => m.kierunek ?? '',
        render: (m) => <span className={`crm-call-dir crm-call-dir--${m.kierunek ?? 'x'}`}>{CRM_MAIL_KIERUNEK[m.kierunek ?? ''] ?? m.kierunek ?? '—'}</span>,
      },
      {
        key: 'kto',
        label: 'Od / do',
        sortValue: (m) => (m.kierunek === 'wychodzacy' ? toLabel(m) : fromLabel(m)),
        render: (m) => <span className="crm-mail-addr">{m.kierunek === 'wychodzacy' ? toLabel(m) : fromLabel(m)}</span>,
      },
      {
        key: 'temat',
        label: 'Temat',
        sortValue: (m) => m.temat ?? '',
        render: (m) => (
          <button type="button" className="crm-link" onClick={() => onOpenMail(m.id)} title="Otwórz mail">
            {m.temat || '(bez tematu)'}
          </button>
        ),
      },
      // kanał (mail / formularz ze strony) widzi każdy; SPRAWA (wynik AI) tylko tryb pełny (brief pkt 13)
      { key: 'kanal', label: 'Kanał', sortValue: (m) => m.kanal ?? '', render: (m) => (m.kanal === 'formularz' ? <span className="crm-tag crm-kanal" title="Zgłoszenie z formularza kontaktowego strony">Formularz</span> : <span className="crm-muted">✉️</span>) },
      { key: 'sprawa', label: 'Sprawa', pelnyOnly: true, sortValue: (m) => m.typ ?? '', render: (m) => (m.typ ? <span className="crm-call-typ">{CRM_MAIL_TYP[m.typ] ?? m.typ}</span> : '—') },
      {
        key: 'status',
        label: 'Status',
        sortValue: (m) => m.status_przetwarzania ?? '',
        render: (m) => <StatusChip status={m.status_przetwarzania} />,
      },
      {
        key: 'klient',
        label: 'Klient',
        sortValue: (m) => leadLabel(m),
        render: (m) =>
          m.lead_id ? (
            <button type="button" className="crm-link" onClick={() => m.lead_id && onOpenLead(m.lead_id)}>
              {leadLabel(m)}
            </button>
          ) : (
            '—'
          ),
      },
      {
        key: 'oferta',
        label: 'Oferta',
        sortValue: (m) => (m.oferta_id ? 1 : 0),
        render: (m) =>
          m.oferta_id ? (
            <button type="button" className="crm-link" onClick={() => m.oferta_id && onOpenOferta(m.oferta_id)}>
              otwórz
            </button>
          ) : (
            '—'
          ),
      },
      {
        key: 'zal',
        label: null,
        title: 'Załączniki',
        align: 'center',
        sortValue: (m) => m.zalaczniki?.length ?? 0,
        render: (m) => (m.zalaczniki && m.zalaczniki.length ? m.zalaczniki.length : ''),
      },
      {
        key: 'podsumowanie',
        label: 'Podsumowanie',
        render: (m) => (
          <span className="crm-mail-summary" title={m.podsumowanie ?? ''}>
            {m.status_przetwarzania === 'blad' && m.blad ? <span className="crm-text-bad">{m.blad}</span> : m.podsumowanie || ''}
          </span>
        ),
      },
      { key: 'koszt', label: 'Koszt AI', align: 'right', pelnyOnly: true, sortValue: (m) => m.koszt_ai_usd ?? 0, render: (m) => (m.koszt_ai_usd != null ? `${Number(m.koszt_ai_usd).toFixed(3)} $` : '') },
    ]
    return all.filter((c) => mode === 'pelny' || !c.pelnyOnly)
  }, [mode, onOpenMail, onOpenLead, onOpenOferta])

  const counts = useMemo(
    () => ({
      blad: rows.filter((m) => m.status_przetwarzania === 'blad').length,
      nowy: rows.filter((m) => m.status_przetwarzania === 'nowy').length,
    }),
    [rows],
  )

  return (
    <>
      <div className="crm-toolbar">
        <div className="crm-toolbar-group" role="tablist" aria-label="Filtr maili">
          {(
            [
              ['wszystkie', 'Wszystkie'],
              ['przychodzacy', 'Przychodzące'],
              ['wychodzacy', 'Wychodzące'],
            ] as Array<[Filter, string]>
          ).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} className={`btn btn-sm ${filter === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
        <input type="search" className="crm-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj: temat, adres, klient…" aria-label="Szukaj w mailach" />
        <span className="crm-toolbar-hint">
          {rows.length} {rows.length === 1 ? 'mail' : rows.length < 5 ? 'maile' : 'maili'}
          {counts.nowy ? ` · ${counts.nowy} czeka na analizę` : ''}
          {counts.blad ? ` · ${counts.blad} z błędem` : ''}
          {' '}· maile przychodzące analizuje system i sam tworzy klientów, zadania i oferty.
        </span>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void load()} title="Odśwież listę">
          Odśwież
        </button>
      </div>
      {error && <div className="crm-box crm-box--bad">{error.message}</div>}
      {loading ? (
        <Spinner center label="Ładowanie maili…" />
      ) : (
        <DataTable rows={filtered} rowKey={(m) => m.id} columns={columns} className="crm-table" emptyText="Brak maili — pojawią się po pierwszym sprawdzeniu skrzynki z włączonym czytaniem Odebranych." />
      )}
    </>
  )
}

export function CrmMailScreen({
  id,
  mode,
  pushToast,
  onBack,
  onOpenLead,
  onOpenOferta,
}: {
  id: string
  mode: Mode
  pushToast: PushToast
  onBack: () => void
  onOpenLead: (id: string) => void
  onOpenOferta: (id: string) => void
}) {
  const [mail, setMail] = useState<CrmMail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const res = await fetchMail(id)
    setMail(res.data)
    setError(res.error)
    setLoading(false)
  }, [id])

  useEffect(() => {
    void load()
  }, [load])
  useOnCrmReshow(() => void load(true))
  const visible = useCrmActive()

  const pending = mail?.status_przetwarzania === 'nowy'
  useEffect(() => {
    if (!pending || !visible) return
    const t = window.setInterval(() => void load(true), 10_000)
    return () => window.clearInterval(t)
  }, [pending, visible, load])

  const onRetry = async () => {
    if (!mail) return
    const ok = await appConfirm('Zlecić ponowną analizę tego maila? System przeczyta go jeszcze raz i może zaktualizować klienta, zadanie lub ofertę.', { title: 'Analizuj ponownie', confirmLabel: 'Analizuj' })
    if (!ok) return
    setBusy(true)
    const err = await retryMailAnaliza(mail.id)
    setBusy(false)
    if (err) {
      pushToast(`Nie udało się zlecić analizy: ${err.message}`, 'error')
      return
    }
    pushToast('Analiza zlecona — wynik za chwilę', 'success')
    await load(true)
  }

  if (loading) return <Spinner center label="Ładowanie maila…" />
  if (error) return <div className="crm-box crm-box--bad">{error.message}</div>
  if (!mail) {
    return (
      <div className="crm-screen">
        <button type="button" className="btn btn-sm btn-secondary" onClick={onBack}>Wróć</button>
        <p className="no-results">Nie znaleziono maila.</p>
      </div>
    )
  }

  const canRetry = mail.kierunek === 'przychodzacy' && (mode === 'pelny' || mail.status_przetwarzania === 'blad')

  return (
    <div className="crm-screen crm-mail">
      <div className="crm-screen-head">
        <button type="button" className="btn btn-sm btn-secondary" onClick={onBack}>Wróć</button>
        <div className="crm-screen-title">
          <h3>{mail.temat || '(bez tematu)'}</h3>
          <div className="crm-screen-sub">
            <span className={`crm-call-dir crm-call-dir--${mail.kierunek ?? 'x'}`}>{CRM_MAIL_KIERUNEK[mail.kierunek ?? ''] ?? mail.kierunek ?? '—'}</span>
            {' · '}
            {fmtDateTime(mail.data ?? mail.created_at)}
            {mail.kanal === 'formularz' ? <> · <span className="crm-tag crm-kanal" title="Zgłoszenie z formularza kontaktowego strony">Formularz ze strony</span></> : null}
            {mail.typ ? <> · <span className="crm-call-typ" title="Sprawa (z analizy)">Sprawa: {CRM_MAIL_TYP[mail.typ] ?? mail.typ}</span></> : null}
            {mail.nadawca_techniczny ? <span className="crm-muted"> · nadawca techniczny: {mail.nadawca_techniczny}</span> : null}
            {' · '}
            <StatusChip status={mail.status_przetwarzania} />
            {mail.nastepna_akcja && CRM_AKCJA[mail.nastepna_akcja] ? <> · {CRM_AKCJA[mail.nastepna_akcja].label}</> : null}
          </div>
        </div>
        {canRetry && (
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => void onRetry()} disabled={busy || pending} title="Status → czeka na analizę; system przeczyta mail jeszcze raz">
            {busy ? <Spinner inline size={14} /> : null} Analizuj ponownie
          </button>
        )}
      </div>

      {mail.status_przetwarzania === 'blad' && (
        <section className="crm-box crm-box--bad">
          <b>Błąd analizy:</b> {mail.blad || 'brak opisu'}
          {mail.proby ? <span className="crm-muted"> · prób: {mail.proby}/4 (automat ponawia co 15 min)</span> : null}
        </section>
      )}
      {pending && (
        <section className="crm-box">
          <Spinner inline size={14} /> System analizuje ten mail… ekran odświeży się sam.
        </section>
      )}

      <section className="crm-lead-grid">
        <div>
          <h4>Nagłówek</h4>
          <div className="crm-field"><span className="crm-field-label">Od</span><span className="crm-copy-value">{fromLabel(mail)}</span></div>
          <div className="crm-field"><span className="crm-field-label">Do</span><span className="crm-copy-value">{toLabel(mail)}</span></div>
          {mail.cc_adresy && mail.cc_adresy.length > 0 && <div className="crm-field"><span className="crm-field-label">DW</span><span className="crm-copy-value">{mail.cc_adresy.join(', ')}</span></div>}
          <div className="crm-field">
            <span className="crm-field-label">Klient</span>
            <span>
              {mail.lead_id ? (
                <button type="button" className="crm-link" onClick={() => mail.lead_id && onOpenLead(mail.lead_id)}>{leadLabel(mail)}</button>
              ) : (
                <span className="crm-muted">nie powiązano</span>
              )}
            </span>
          </div>
          <div className="crm-field">
            <span className="crm-field-label">Oferta</span>
            <span>
              {mail.oferta_id ? (
                <button type="button" className="crm-link" onClick={() => mail.oferta_id && onOpenOferta(mail.oferta_id)}>otwórz ofertę</button>
              ) : (
                <span className="crm-muted">brak</span>
              )}
            </span>
          </div>
          {mail.zalaczniki && mail.zalaczniki.length > 0 && (
            <div className="crm-field">
              <span className="crm-field-label">Załączniki</span>
              <span>
                {mail.zalaczniki.map((z, i) => (
                  <span key={i} className="crm-call-typ crm-mail-zal">
                    {z.nazwa || 'plik'}
                    {z.rozmiar ? ` (${Math.max(1, Math.round(z.rozmiar / 1024))} KB)` : ''}
                  </span>
                ))}
                <span className="crm-muted"> — pliki są w skrzynce pocztowej, tu tylko lista.</span>
              </span>
            </div>
          )}
        </div>
        <div>
          <h4>Co system z tego wyczytał</h4>
          <p>{mail.podsumowanie || <span className="crm-muted">brak podsumowania</span>}</p>
          {mode === 'pelny' && mail.analiza && (
            <details className="crm-details crm-details--inline">
              <summary>Analiza AI{mail.koszt_ai_usd != null ? ` · ${Number(mail.koszt_ai_usd).toFixed(3)} USD` : ''}</summary>
              <pre className="crm-pre">{JSON.stringify(mail.analiza, null, 2)}</pre>
            </details>
          )}
        </div>
      </section>

      <section>
        <h4>Treść{mail.tresc_ucieta ? <span className="crm-muted"> (ucięta — pełna w skrzynce)</span> : null}</h4>
        <pre className="crm-pre crm-mail-body">{mail.tresc || '(pusta treść)'}</pre>
      </section>
    </div>
  )
}
