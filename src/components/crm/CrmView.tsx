// =====================================================================
// Zakładka „CRM Po Drzwi” (pilot, brief 14.11.2026 pkt 3).
// Trzy ekrany: lista ofert → oferta (blok „Sprawdź tylko to”, mail do skopiowania,
// Wysłałam / Poprawka+Przelicz, dane techniczne, historia) → lead (kontakt,
// rozmowy z Ringostatu, oferty). Widoczność zakładki pilnuje App (useCrmAccess).
// Frontend nie liczy nic sam: czyta crm.oferty i zmienia status; nową wersję
// po poprawce tworzy backend (Edge Function drugiej sesji) — tu tylko odświeżamy.
// =====================================================================
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, Copy, RefreshCw, Phone, Mail, ExternalLink } from 'lucide-react'
import type { CurrentUser, ToastVariant } from '../../types'
import { CRM_LEAD_STATUS, CRM_OFERTA_STATUS, CRM_ZDARZENIE_LABEL, type CrmLead, type CrmOferta, type CrmRozmowa, type CrmZdarzenie } from '../../types/crm'
import {
  fetchLead,
  fetchOferta,
  fetchOferty,
  fetchOfertyLeada,
  fetchProfileNames,
  fetchRozmowy,
  fetchZdarzenia,
  markOfertaWyslana,
  requestOfertaPrzelicz,
  type CrmError,
} from '../../hooks/useCrm'
import { appConfirm } from '../../lib/appDialogs'
import { openExternalUrl } from '../../hooks/useAluOrders'
import DataTable, { type DataTableColumn } from '../DataTable'
import Spinner from '../Spinner'

/** Link https:// w systemowej przeglądarce (Electron: shell:open-external; w przeglądarce: nowa karta). */
function ExtLink({ href, children, title }: { href: string; children: ReactNode; title?: string }) {
  return (
    <a
      href={href}
      className="crm-ext"
      title={title ?? href}
      onClick={(e) => {
        e.preventDefault()
        void openExternalUrl(href) // w dev/przeglądarce helper sam robi window.open
      }}
    >
      {children}
    </a>
  )
}

type Props = {
  currentUser: CurrentUser | null
  pushToast: (message: string, variant: ToastVariant) => void
}

type Screen = { kind: 'list' } | { kind: 'oferta'; id: string } | { kind: 'lead'; id: string }

// ---- pomocnicze ----

const fmtPln = (v: number | null | undefined): string =>
  v == null ? '—' : new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }).format(Number(v))

const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('pl-PL')
}

const fmtDuration = (s: number | null | undefined): string => {
  if (s == null) return '—'
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean) : []

const leadName = (lead: CrmLead | null | undefined): string => (lead?.nazwa || lead?.telefon || lead?.email || 'Klient bez nazwy').trim()

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fallback niżej */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

function StatusBadge({ status }: { status: string }) {
  const s = CRM_OFERTA_STATUS[status] ?? { label: status, cls: 'crm-status--muted' }
  return <span className={`crm-status ${s.cls}`}>{s.label}</span>
}

function KoszykBadge({ value, compact = false }: { value: boolean | null | undefined; compact?: boolean }) {
  if (value === true) return <span className="crm-koszyk crm-koszyk--ok" title="Sklep policzył to samo, co kalkulator">{compact ? '✓' : '✓ koszyk zgodny z kalkulatorem'}</span>
  if (value === false) return <span className="crm-koszyk crm-koszyk--bad" title="Suma koszyka w sklepie różni się od kalkulatora">{compact ? '✗' : '✗ koszyk NIEZGODNY z kalkulatorem — sprawdź cenę przed wysyłką'}</span>
  return <span className="crm-koszyk crm-koszyk--na" title="Brak porównania z koszykiem sklepu">{compact ? '?' : 'brak porównania z koszykiem sklepu'}</span>
}

function ErrorBox({ error }: { error: CrmError }) {
  return (
    <div className={`crm-error${error.kind === 'schema_not_exposed' ? ' crm-error--config' : ''}`} role="alert">
      {error.message}
    </div>
  )
}

function CopyRow({ label, value, multiline, onCopied }: { label: string; value: string | null | undefined; multiline?: boolean; onCopied: (ok: boolean, label: string) => void }) {
  const text = value ?? ''
  return (
    <div className={`crm-copy-row${multiline ? ' crm-copy-row--multi' : ''}`}>
      <div className="crm-copy-head">
        <span className="crm-copy-label">{label}</span>
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          disabled={!text}
          onClick={() => void copyText(text).then((ok) => onCopied(ok, label))}
          title={`Skopiuj: ${label.toLowerCase()}`}
        >
          <Copy size={14} /> Kopiuj
        </button>
      </div>
      {multiline ? <pre className="crm-pre">{text || '—'}</pre> : <div className="crm-copy-value">{text || '—'}</div>}
    </div>
  )
}

function KeyValueTable({ data }: { data: Record<string, unknown> | null | undefined }) {
  const entries = Object.entries(data ?? {})
  if (entries.length === 0) return <span className="crm-muted">—</span>
  return (
    <table className="crm-kv">
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <th>{k}</th>
            <td>{typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '—')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ---- lista ofert ----

function OfertyList({ onOpenOferta, onOpenLead }: { onOpenOferta: (id: string) => void; onOpenLead: (id: string) => void }) {
  const [onlyOpen, setOnlyOpen] = useState(true)
  const [rows, setRows] = useState<CrmOferta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await fetchOferty(onlyOpen)
    setRows(data)
    setError(err)
    setLoading(false)
  }, [onlyOpen])

  useEffect(() => {
    void load()
  }, [load])

  const columns = useMemo<DataTableColumn<CrmOferta>[]>(
    () => [
      {
        key: 'klient',
        label: 'Klient',
        sortValue: (r) => leadName(r.lead),
        render: (r) => (
          <button type="button" className="crm-link" onClick={() => r.lead_id && onOpenLead(r.lead_id)} title="Otwórz leada (kontakt, rozmowy)">
            {leadName(r.lead)}
          </button>
        ),
      },
      { key: 'miejscowosc', label: 'Miejscowość', sortValue: (r) => r.lead?.miejscowosc ?? '', render: (r) => r.lead?.miejscowosc || '—' },
      {
        key: 'produkt',
        label: 'Produkt',
        sortValue: (r) => r.produkt ?? '',
        render: (r) =>
          r.produkt ||
          (r.cena_razem == null ? (
            <span className="crm-muted" title="System jeszcze nie policzył tej oferty (brak produktu, ceny i maila)">w przygotowaniu</span>
          ) : (
            '—'
          )),
      },
      { key: 'cena', label: 'Cena brutto', align: 'right', sortValue: (r) => r.cena_razem ?? -1, render: (r) => fmtPln(r.cena_razem) },
      { key: 'koszyk', label: 'Koszyk', align: 'center', sortValue: (r) => (r.koszyk_zgodny === true ? 1 : r.koszyk_zgodny === false ? -1 : 0), render: (r) => <KoszykBadge value={r.koszyk_zgodny} compact /> },
      {
        key: 'sprawdz',
        label: 'Do sprawdzenia',
        align: 'center',
        sortValue: (r) => asStrings(r.sprawdz).length,
        render: (r) => {
          const n = asStrings(r.sprawdz).length
          return n === 0 ? <span className="crm-muted" title="Konfiguracja w całości z rozmowy">0</span> : <span className="crm-count">{n}</span>
        },
      },
      { key: 'status', label: 'Status', sortValue: (r) => r.status, render: (r) => <StatusBadge status={r.status} /> },
      { key: 'wersja', label: 'Wersja', align: 'center', sortValue: (r) => r.wersja, render: (r) => `v${r.wersja}` },
      { key: 'data', label: 'Data', sortValue: (r) => r.created_at, render: (r) => fmtDateTime(r.created_at) },
      {
        key: 'akcje',
        label: '',
        render: (r) => (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => onOpenOferta(r.id)}>
            Otwórz
          </button>
        ),
      },
    ],
    [onOpenOferta, onOpenLead],
  )

  return (
    <>
      <div className="crm-toolbar">
        <div className="crm-toolbar-group" role="tablist" aria-label="Filtr ofert">
          <button type="button" className={`btn btn-sm ${onlyOpen ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOnlyOpen(true)}>
            Do zrobienia
          </button>
          <button type="button" className={`btn btn-sm ${!onlyOpen ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOnlyOpen(false)}>
            Wszystkie
          </button>
        </div>
        <span className="crm-toolbar-hint">
          {onlyOpen ? 'Oferty do sprawdzenia i w przeliczaniu. Klient = kontakt i rozmowy, Otwórz = mail do wysłania.' : 'Wszystkie wersje ofert, najnowsze na górze.'}
        </span>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void load()} title="Odśwież listę">
          <RefreshCw size={14} /> Odśwież
        </button>
      </div>
      {error && <ErrorBox error={error} />}
      {loading ? (
        <Spinner center label="Ładowanie ofert…" />
      ) : (
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          columns={columns}
          className="crm-table"
          emptyText={onlyOpen ? 'Nic do sprawdzenia — wszystkie oferty wysłane.' : 'Brak ofert w bazie.'}
        />
      )}
    </>
  )
}

// ---- widok oferty ----

function OfertaScreen({
  id,
  currentUser,
  pushToast,
  onBack,
  onOpenLead,
  onOpenOferta,
}: {
  id: string
  currentUser: CurrentUser | null
  pushToast: Props['pushToast']
  onBack: () => void
  onOpenLead: (id: string) => void
  onOpenOferta: (id: string) => void
}) {
  const [oferta, setOferta] = useState<CrmOferta | null>(null)
  const [wersje, setWersje] = useState<CrmOferta[]>([])
  const [zdarzenia, setZdarzenia] = useState<CrmZdarzenie[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)
  const [poprawka, setPoprawka] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: o, error: err } = await fetchOferta(id)
    setError(err)
    setOferta(o)
    if (o) {
      const [v, z] = await Promise.all([o.lead_id ? fetchOfertyLeada(o.lead_id) : Promise.resolve({ data: [] as CrmOferta[], error: null }), fetchZdarzenia({ ofertaId: o.id })])
      setWersje(v.data)
      setZdarzenia(z.data)
      setNames(await fetchProfileNames([...z.data.map((e) => e.kto ?? ''), o.handlowiec ?? '', o.sprawdzil ?? '']))
      setPoprawka(o.status === 'przelicz' ? o.poprawka ?? '' : '')
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const onCopied = (ok: boolean, label: string) =>
    pushToast(ok ? `Skopiowano: ${label.toLowerCase()}` : 'Nie udało się skopiować — zaznacz tekst i skopiuj ręcznie', ok ? 'success' : 'error')

  const handleWyslane = async () => {
    if (!oferta || !currentUser) return
    const ok = await appConfirm(`Oznaczyć ofertę v${oferta.wersja} dla ${leadName(oferta.lead)} jako wysłaną? Mail trzeba wysłać samodzielnie ze swojej poczty.`, {
      title: 'Wysłałam',
      confirmLabel: 'Tak, wysłane',
    })
    if (!ok) return
    setSaving(true)
    const err = await markOfertaWyslana(oferta, currentUser.id)
    setSaving(false)
    if (err) {
      pushToast(`Nie udało się oznaczyć: ${err.message}`, 'error')
      return
    }
    pushToast('Oferta oznaczona jako wysłana', 'success')
    await load()
  }

  const handlePrzelicz = async () => {
    if (!oferta) return
    const text = poprawka.trim()
    if (!text) {
      pushToast('Wpisz, co poprawić — zwykłym językiem, np. „okucia zwykłe Haga, kolor antracyt struktura”', 'error')
      return
    }
    setSaving(true)
    const err = await requestOfertaPrzelicz(oferta, text)
    setSaving(false)
    if (err) {
      pushToast(`Nie udało się zlecić przeliczenia: ${err.message}`, 'error')
      return
    }
    pushToast('Poprawka zapisana — system przelicza ofertę. Nowa wersja pojawi się na liście za chwilę.', 'success')
    await load()
  }

  if (loading) return <Spinner center label="Ładowanie oferty…" />
  if (error) return <ErrorBox error={error} />
  if (!oferta) {
    return (
      <div className="crm-screen">
        <button type="button" className="btn btn-sm btn-secondary" onClick={onBack}><ArrowLeft size={14} /> Lista ofert</button>
        <p className="no-results">Nie znaleziono oferty (mogła zostać usunięta albo nie masz do niej dostępu).</p>
      </div>
    )
  }

  const sprawdz = asStrings(oferta.sprawdz)
  const zalozenia = asStrings(oferta.zalozenia)
  const rozbicie = Array.isArray(oferta.rozbicie) ? oferta.rozbicie : []
  const canSend = oferta.status === 'do_sprawdzenia'
  const isRecalc = oferta.status === 'przelicz'
  // Pusta zapowiedź: ingest założył wersję (po rozmowie / poprawce), ale backend
  // jeszcze nie policzył ceny, koszyka i maila — nie ma czego sprawdzać ani wysyłać
  const pending = !oferta.mail_tresc && !oferta.produkt && oferta.cena_razem == null
  const dobor = oferta.dobor ?? {}
  const analiza = oferta.analiza ?? {}
  const linkValid = oferta.link_wazny_do ? new Date(oferta.link_wazny_do).getTime() > Date.now() : null

  return (
    <div className="crm-screen">
      <div className="crm-screen-head">
        <button type="button" className="btn btn-sm btn-secondary" onClick={onBack}><ArrowLeft size={14} /> Lista ofert</button>
        <div className="crm-screen-title">
          <h3>
            {pending
              ? `Oferta v${oferta.wersja} · w przygotowaniu`
              : `Oferta v${oferta.wersja} · ${oferta.produkt || 'produkt nieustalony'} · ${fmtPln(oferta.cena_razem)}`}
          </h3>
          <div className="crm-screen-sub">
            <button type="button" className="crm-link" onClick={() => oferta.lead_id && onOpenLead(oferta.lead_id)}>
              {leadName(oferta.lead)}
            </button>
            {oferta.lead?.miejscowosc ? ` · ${oferta.lead.miejscowosc}` : ''}
            {' · '}
            <StatusBadge status={oferta.status} />
            {' · utworzona '}
            {fmtDateTime(oferta.created_at)}
            {oferta.wyslano_at ? ` · wysłana ${fmtDateTime(oferta.wyslano_at)}${oferta.sprawdzil ? ` (${names.get(oferta.sprawdzil) ?? '…'})` : ''}` : ''}
          </div>
        </div>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void load()} title="Odśwież"><RefreshCw size={14} /></button>
      </div>

      {/* 1. SPRAWDŹ TYLKO TO */}
      {pending ? (
        <section className="crm-check crm-check--pending">
          <h4>Oferta w przygotowaniu</h4>
          <p className="crm-pending-text">
            System ma jeszcze policzyć cenę, zrobić koszyk w sklepie i napisać mail
            {isRecalc && oferta.poprawka ? <> po poprawce: <em>„{oferta.poprawka}”</em></> : isRecalc ? ' po nowej rozmowie' : ''}.
            Nie ma tu nic do sprawdzenia — wróć za chwilę albo kliknij Odśwież. Gdy oferta będzie gotowa, dostanie status „Do sprawdzenia”.
          </p>
          {oferta.lead?.telefon || oferta.mail_do ? (
            <p className="crm-muted">Adres do wysyłki: {oferta.mail_do || '—'}</p>
          ) : null}
        </section>
      ) : (
        <section className={`crm-check ${oferta.koszyk_zgodny === false ? 'crm-check--bad' : sprawdz.length === 0 && oferta.koszyk_zgodny ? 'crm-check--clean' : ''}`}>
          <h4>Sprawdź tylko to</h4>
          <div className="crm-check-koszyk"><KoszykBadge value={oferta.koszyk_zgodny} /></div>
          {sprawdz.length === 0 ? (
            <p className="crm-check-clean">Konfiguracja w całości z rozmowy — przeczytaj mail raz i wyślij.</p>
          ) : (
            <ol className="crm-check-list">
              {sprawdz.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}
          {isRecalc && (
            <p className="crm-recalc-note">
              {oferta.poprawka ? <>Trwa przeliczanie po poprawce: <em>„{oferta.poprawka}”</em>.</> : 'Trwa przeliczanie tej wersji.'} Nowa wersja pojawi się na liście „Do zrobienia”; ta zostanie oznaczona jako robocza.
            </p>
          )}
        </section>
      )}

      {/* 2. MAIL */}
      {!pending && (
        <section className="crm-mail">
          <h4>Mail do klienta — skopiuj do swojej poczty</h4>
          <CopyRow label="Adres" value={oferta.mail_do} onCopied={onCopied} />
          <CopyRow label="Temat" value={oferta.mail_temat} onCopied={onCopied} />
          <CopyRow label="Treść" value={oferta.mail_tresc} multiline onCopied={onCopied} />
          <div className="crm-mail-actions">
            <button type="button" className="btn btn-primary" disabled={!canSend || saving} onClick={() => void handleWyslane()} title={canSend ? 'Mail wysłany ze swojej poczty — oznacz ofertę jako wysłaną' : 'Dostępne tylko dla oferty do sprawdzenia'}>
              Wysłałam
            </button>
            {!canSend && !isRecalc && <span className="crm-muted">Ta wersja ma status „{CRM_OFERTA_STATUS[oferta.status]?.label ?? oferta.status}”.</span>}
          </div>
        </section>
      )}

      {/* 3. POPRAWKA — dopiero gdy jest co poprawiać */}
      {!pending && (
      <section className="crm-fix">
        <h4>Poprawka</h4>
        <p className="user-modal-hint">
          Napisz zwykłym językiem, co zmienić (np. „okucia zwykłe Haga nie Premium, kolor antracyt struktura, dopisz że mogę podjechać na pomiar”).
          System przeliczy cenę, zrobi nowy koszyk i napisze mail od nowa jako kolejną wersję.
        </p>
        <textarea
          className="crm-fix-textarea"
          rows={3}
          value={poprawka}
          onChange={(e) => setPoprawka(e.target.value)}
          disabled={isRecalc || saving}
          placeholder={isRecalc ? 'Przeliczanie w toku…' : 'Co poprawić?'}
        />
        <div className="crm-mail-actions">
          <button type="button" className="btn btn-secondary" disabled={isRecalc || saving || !poprawka.trim()} onClick={() => void handlePrzelicz()}>
            Przelicz
          </button>
          {isRecalc && <span className="crm-muted">Przeliczanie w toku — odśwież za chwilę.</span>}
        </div>
      </section>
      )}

      {/* 4. DANE TECHNICZNE */}
      <details className="crm-details">
        <summary>Dane techniczne</summary>
        <div className="crm-details-body">
          <div className="crm-tech-grid">
            <div>
              <h5>Produkt</h5>
              <p>{oferta.produkt || '—'}{oferta.product_id != null ? <span className="crm-muted"> (ID {oferta.product_id})</span> : null}</p>
              <h5>Cena</h5>
              <p>bazowa {fmtPln(oferta.cena_bazowa)} · razem {fmtPln(oferta.cena_razem)}</p>
              <h5>Link do koszyka</h5>
              {oferta.link_koszyka ? (
                <p>
                  <ExtLink href={oferta.link_koszyka}><ExternalLink size={13} /> otwórz koszyk</ExtLink>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => void copyText(oferta.link_koszyka ?? '').then((ok) => onCopied(ok, 'Link'))}><Copy size={13} /> Kopiuj</button>
                  {oferta.link_wazny_do ? <span className={`crm-muted${linkValid === false ? ' crm-text-bad' : ''}`}> ważny do {fmtDateTime(oferta.link_wazny_do)}{linkValid === false ? ' — WYGASŁ' : ''}</span> : null}
                </p>
              ) : (
                <p className="crm-muted">brak linku</p>
              )}
              <h5>Uzasadnienie doboru</h5>
              <p>{typeof dobor.uzasadnienie === 'string' ? dobor.uzasadnienie : '—'}{typeof dobor.pewnosc === 'string' ? <span className="crm-muted"> (pewność: {dobor.pewnosc})</span> : null}</p>
              <h5>Podsumowanie rozmowy</h5>
              <p>{typeof analiza.podsumowanie === 'string' ? analiza.podsumowanie : '—'}</p>
              {zalozenia.length > 0 && (
                <>
                  <h5>Założenia</h5>
                  <ul>{zalozenia.map((z, i) => <li key={i}>{z}</li>)}</ul>
                </>
              )}
            </div>
            <div>
              <h5>Wybory (opcje)</h5>
              <KeyValueTable data={oferta.wybory} />
              <h5>Rozbicie ceny</h5>
              {rozbicie.length === 0 ? (
                <span className="crm-muted">—</span>
              ) : (
                <ul className="crm-rozbicie">
                  {rozbicie.map((r, i) => {
                    const row = (typeof r === 'object' && r !== null ? r : { pozycja: String(r) }) as Record<string, unknown>
                    const label = String(row.pozycja ?? row.nazwa ?? row.opis ?? row.label ?? JSON.stringify(row))
                    const kwota = row.kwota ?? row.cena ?? row.doplata ?? row.amount
                    return (
                      <li key={i}>
                        <span>{label}</span>
                        {kwota != null && <span className="crm-rozbicie-kwota">{fmtPln(Number(kwota))}</span>}
                      </li>
                    )
                  })}
                </ul>
              )}
              {oferta.koszt_ai_usd != null && <p className="crm-muted">Koszt AI: {Number(oferta.koszt_ai_usd).toFixed(3)} USD</p>}
            </div>
          </div>
        </div>
      </details>

      {/* 5. HISTORIA */}
      <section className="crm-history">
        <h4>Historia</h4>
        {wersje.length > 1 && (
          <div className="crm-versions">
            {wersje.map((w) => (
              <button
                key={w.id}
                type="button"
                className={`crm-version${w.id === oferta.id ? ' crm-version--current' : ''}`}
                onClick={() => w.id !== oferta.id && onOpenOferta(w.id)}
                title={`${fmtDateTime(w.created_at)} · ${CRM_OFERTA_STATUS[w.status]?.label ?? w.status}${w.poprzednia_id ? ' · poprawka poprzedniej wersji' : ''}`}
              >
                v{w.wersja}{w.cena_razem != null ? ` · ${fmtPln(w.cena_razem)}` : ''} · <StatusBadge status={w.status} />
              </button>
            ))}
          </div>
        )}
        <Timeline items={zdarzenia} names={names} />
      </section>
    </div>
  )
}

function Timeline({ items, names }: { items: CrmZdarzenie[]; names: Map<string, string> }) {
  if (items.length === 0) return <p className="crm-muted">Brak zdarzeń.</p>
  return (
    <ul className="crm-timeline">
      {items.map((z) => (
        <li key={z.id} className={`crm-timeline-item crm-timeline-item--${z.typ}`}>
          <span className="crm-timeline-when">{fmtDateTime(z.created_at)}</span>
          <span className="crm-timeline-typ">{CRM_ZDARZENIE_LABEL[z.typ] ?? z.typ}</span>
          <span className="crm-timeline-kto">{z.kto ? names.get(z.kto) ?? '…' : 'system'}</span>
          {z.opis && <span className="crm-timeline-opis">{z.opis}</span>}
        </li>
      ))}
    </ul>
  )
}

// ---- widok leada ----

function LeadScreen({ id, onBack, onOpenOferta }: { id: string; onBack: () => void; onOpenOferta: (id: string) => void }) {
  const [lead, setLead] = useState<CrmLead | null>(null)
  const [rozmowy, setRozmowy] = useState<CrmRozmowa[]>([])
  const [oferty, setOferty] = useState<CrmOferta[]>([])
  const [zdarzenia, setZdarzenia] = useState<CrmZdarzenie[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      const { data: l, error: err } = await fetchLead(id)
      if (cancelled) return
      setError(err)
      setLead(l)
      if (l) {
        const [r, o, z] = await Promise.all([fetchRozmowy(l.id), fetchOfertyLeada(l.id), fetchZdarzenia({ leadId: l.id })])
        if (cancelled) return
        setRozmowy(r.data)
        setOferty(o.data)
        setZdarzenia(z.data)
        setNames(await fetchProfileNames(z.data.map((e) => e.kto ?? '')))
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) return <Spinner center label="Ładowanie leada…" />
  if (error) return <ErrorBox error={error} />
  if (!lead) {
    return (
      <div className="crm-screen">
        <button type="button" className="btn btn-sm btn-secondary" onClick={onBack}><ArrowLeft size={14} /> Wróć</button>
        <p className="no-results">Nie znaleziono leada.</p>
      </div>
    )
  }

  const Field = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="crm-field">
      <span className="crm-field-label">{label}</span>
      <span className="crm-field-value">{children}</span>
    </div>
  )

  return (
    <div className="crm-screen">
      <div className="crm-screen-head">
        <button type="button" className="btn btn-sm btn-secondary" onClick={onBack}><ArrowLeft size={14} /> Wróć</button>
        <div className="crm-screen-title">
          <h3>{leadName(lead)}</h3>
          <div className="crm-screen-sub">
            {CRM_LEAD_STATUS[lead.status ?? ''] ?? lead.status ?? '—'}
            {lead.kategoria ? ` · ${lead.kategoria}` : ''}
            {lead.zrodlo ? ` · źródło: ${lead.zrodlo}` : ''}
            {lead.kampania ? ` · kampania: ${lead.kampania}` : ''}
          </div>
        </div>
      </div>

      <section className="crm-lead-grid">
        <div>
          <h4>Kontakt</h4>
          {/* tel:/mailto: nie przechodzą przez shell:open-external (tylko https) — tekst do zaznaczenia/skopiowania */}
          <Field label="Telefon">{lead.telefon ? <span className="crm-ext crm-copy-value"><Phone size={13} /> {lead.telefon}</span> : '—'}</Field>
          <Field label="E-mail">{lead.email ? <span className="crm-ext crm-copy-value"><Mail size={13} /> {lead.email}</span> : '—'}</Field>
          <Field label="Miejscowość">{lead.miejscowosc || '—'}</Field>
          <Field label="Wartość szac.">{fmtPln(lead.wartosc_szac)}</Field>
          <Field label="Następny krok">{fmtDate(lead.nastepny_krok)}</Field>
          <Field label="Pierwszy kontakt">{fmtDateTime(lead.created_at)}</Field>
        </div>
        <div>
          <h4>Czego chce</h4>
          <p>{lead.podsumowanie || <span className="crm-muted">brak podsumowania</span>}</p>
          {lead.brakuje && (
            <>
              <h5>Brakuje</h5>
              <p>{lead.brakuje}</p>
            </>
          )}
        </div>
      </section>

      <section>
        <h4>Oferty ({oferty.length})</h4>
        {oferty.length === 0 ? (
          <p className="crm-muted">Brak ofert dla tego leada.</p>
        ) : (
          <div className="crm-versions">
            {[...oferty].reverse().map((o) => (
              <button key={o.id} type="button" className="crm-version" onClick={() => onOpenOferta(o.id)}>
                v{o.wersja}{o.produkt ? ` · ${o.produkt}` : ''}{o.cena_razem != null ? ` · ${fmtPln(o.cena_razem)}` : ''} · <StatusBadge status={o.status} /> · {fmtDate(o.created_at)}
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <h4>Rozmowy ({rozmowy.length})</h4>
        {rozmowy.length === 0 ? (
          <p className="crm-muted">Brak rozmów zapisanych z Ringostatu.</p>
        ) : (
          <ul className="crm-calls">
            {rozmowy.map((r) => (
              <li key={r.id} className="crm-call">
                <div className="crm-call-head">
                  <span className="crm-call-when">{fmtDateTime(r.data_rozmowy ?? r.created_at)}</span>
                  <span className={`crm-call-dir crm-call-dir--${r.kierunek ?? 'x'}`}>{r.kierunek === 'przychodzaca' ? '↙ przychodząca' : r.kierunek === 'wychodzaca' ? '↗ wychodząca' : r.kierunek ?? '—'}</span>
                  <span className="crm-call-meta">{r.odebrana === false ? 'nieodebrana' : fmtDuration(r.czas_s)}</span>
                  {r.typ && <span className="crm-call-typ">{r.typ}</span>}
                  {r.ivr && <span className="crm-muted">IVR {r.ivr}</span>}
                  {r.link_nagrania && (
                    <ExtLink href={r.link_nagrania} title="Nagranie w Ringostacie (otwiera przeglądarkę)"><ExternalLink size={13} /> nagranie</ExtLink>
                  )}
                </div>
                {r.podsumowanie && <p className="crm-call-summary">{r.podsumowanie}</p>}
                {r.transkrypcja && (
                  <details className="crm-details crm-details--inline">
                    <summary>Transkrypcja</summary>
                    <pre className="crm-pre">{r.transkrypcja}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="crm-history">
        <h4>Historia</h4>
        <Timeline items={zdarzenia} names={names} />
      </section>
    </div>
  )
}

// ---- korzeń ----

export default function CrmView({ currentUser, pushToast }: Props) {
  const [screen, setScreen] = useState<Screen>({ kind: 'list' })
  // historia ekranów (lista → oferta → lead → oferta…): „Wróć” cofa o jeden
  const [, setStack] = useState<Screen[]>([])

  const go = useCallback((next: Screen) => {
    setStack((prev) => [...prev, screen])
    setScreen(next)
  }, [screen])

  const back = useCallback(() => {
    setStack((prev) => {
      const next = [...prev]
      const last = next.pop()
      setScreen(last ?? { kind: 'list' })
      return next
    })
  }, [])

  const openOferta = useCallback((id: string) => go({ kind: 'oferta', id }), [go])
  const openLead = useCallback((id: string) => go({ kind: 'lead', id }), [go])

  return (
    <div className="crm-view">
      {screen.kind === 'list' && <OfertyList onOpenOferta={openOferta} onOpenLead={openLead} />}
      {screen.kind === 'oferta' && (
        <OfertaScreen id={screen.id} currentUser={currentUser} pushToast={pushToast} onBack={back} onOpenLead={openLead} onOpenOferta={openOferta} />
      )}
      {screen.kind === 'lead' && <LeadScreen id={screen.id} onBack={back} onOpenOferta={openOferta} />}
    </div>
  )
}
