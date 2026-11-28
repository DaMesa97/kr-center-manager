// =====================================================================
// CRM Po Drzwi → Klienci → „Bez klienta” (zgłoszenie właściciela 28.11): rozmowy i maile z ostatnich 60 dni, które
// system przeczytał, ale NIE założył z nich klienta — głównie nowe kontakty „bez potencjału” (klient zrezygnował,
// odmówił danych, pomyłka, produkt spoza oferty…). Przy każdym: podsumowanie, powód, nagranie / mail
// i „Utwórz klienta”, gdy system się pomylił (rpc crm.utworz_klienta_z_kontaktu).
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ToastVariant } from '../../types'
import { CRM_SPRAWA } from '../../types/crm'
import { fetchBezKlienta, utworzKlientaZKontaktu, type CrmError } from '../../hooks/useCrm'
import { BEZ_KLIENTA_DNI, doPrzejrzenia, listaBezKlienta, numerZRozmowy, type BezKlientaPozycja } from '../../lib/crmBezKlienta'
import { openExternalUrl } from '../../hooks/useAluOrders'
import { appConfirm } from '../../lib/appDialogs'
import { fmtDateTime } from '../../lib/crmFormat'
import { ileOdm } from '../../utils/odmiana'
import Spinner from '../Spinner'
import { useOnCrmReshow } from './crmActive'

type Mode = 'handlowiec' | 'pelny'
type Filtr = 'przejrzyj' | 'wszystkie'

const czas = (s: number | null | undefined): string => (s == null ? '' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)

const kto = (p: BezKlientaPozycja): string => {
  if (p.rozmowa) return numerZRozmowy(p.rozmowa) ?? 'numer zastrzeżony'
  const m = p.mail
  return m ? (m.od_nazwa ? `${m.od_nazwa} <${m.od_adres ?? ''}>` : m.od_adres ?? '—') : '—'
}

export default function CrmBezKlientaScreen({
  mode,
  pushToast,
  onBack,
  onOpenLead,
  onOpenMail,
}: {
  mode: Mode
  pushToast: (message: string, variant: ToastVariant) => void
  onBack: () => void
  onOpenLead: (id: string) => void
  onOpenMail: (id: string) => void
}) {
  const [rows, setRows] = useState<BezKlientaPozycja[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)
  const [filtr, setFiltr] = useState<Filtr>('przejrzyj')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const res = await fetchBezKlienta(BEZ_KLIENTA_DNI)
    setRows(listaBezKlienta(res.data.rozmowy, res.data.maile))
    setError(res.error)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])
  useOnCrmReshow(() => void load(true))

  const doPrzejrzeniaIle = useMemo(() => rows.filter(doPrzejrzenia).length, [rows])
  const pokazane = useMemo(() => {
    const baza = filtr === 'przejrzyj' ? rows.filter(doPrzejrzenia) : rows
    const needle = q.trim().toLowerCase()
    if (!needle) return baza
    return baza.filter((p) => [p.podsumowanie, p.powod, kto(p), p.mail?.temat].some((v) => (v ?? '').toLowerCase().includes(needle)))
  }, [rows, filtr, q])

  const utworz = async (p: BezKlientaPozycja) => {
    const ok = await appConfirm(
      p.rodzaj === 'rozmowa'
        ? `Założyć klienta z numeru ${kto(p)} i przypiąć do niego tę rozmowę? Jeśli klient z tym numerem już jest, rozmowa trafi do niego.`
        : `Założyć klienta z adresu ${p.mail?.od_adres ?? ''} i przypiąć do niego ten mail? Jeśli klient z tym adresem już jest, mail trafi do niego.`,
      { title: 'Utwórz klienta', confirmLabel: 'Utwórz klienta' },
    )
    if (!ok) return
    setBusy(p.id)
    const res = await utworzKlientaZKontaktu(p.rodzaj === 'rozmowa' ? { rozmowaId: p.id } : { mailId: p.id })
    setBusy(null)
    if (res.error || !res.data) {
      pushToast(res.error?.message ?? 'Nie udało się utworzyć klienta', 'error')
      return
    }
    setRows((r) => r.filter((x) => !(x.id === p.id && x.rodzaj === p.rodzaj)))
    pushToast(res.data.nowy ? 'Klient utworzony — ustaw mu zadanie na karcie' : 'Przypięto do istniejącego klienta', 'success')
    onOpenLead(res.data.leadId)
  }

  return (
    <div className="crm-screen crm-bez-klienta">
      <div className="crm-head">
        <div className="crm-head-tekst">
          <h2>Bez klienta</h2>
          <span className="crm-head-sub">
            Rozmowy i maile z {BEZ_KLIENTA_DNI} dni, z których system nie założył klienta (np. bez potencjału sprzedażowego)
            {!loading ? ` · do przejrzenia: ${doPrzejrzeniaIle}` : ''}
          </span>
        </div>
        <div className="crm-head-akcje">
          <button type="button" className="btn btn-secondary" onClick={onBack}>Wróć do klientów</button>
        </div>
      </div>
      <div className="crm-filtry">
        <div className="crm-seg" role="group" aria-label="Zakres">
          {(
            [
              ['przejrzyj', 'Do przejrzenia', 'Bez potencjału i sprawy, które mogły być klientem (bez dostawców, spamu i zamówień sklepu)'],
              ['wszystkie', 'Wszystkie', 'Także dostawcy, spam, newslettery i zamówienia sklepu'],
            ] as Array<[Filtr, string, string]>
          ).map(([k, label, title]) => (
            <button key={k} type="button" title={title} aria-pressed={filtr === k} className={`crm-seg-btn${filtr === k ? ' crm-seg-btn--on' : ''}`} onClick={() => setFiltr(k)}>
              {label}
            </button>
          ))}
        </div>
        <input type="search" className="crm-of-szukaj" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj: podsumowanie, numer, adres" aria-label="Szukaj w kontaktach bez klienta" />
      </div>
      {error && <div className="crm-box crm-box--bad">{error.message}</div>}
      {loading ? (
        <Spinner center label="Ładowanie…" />
      ) : pokazane.length === 0 ? (
        <p className="crm-muted">{rows.length === 0 ? `Brak rozmów i maili bez klienta z ostatnich ${BEZ_KLIENTA_DNI} dni.` : 'Nic tu nie pasuje do filtra.'}</p>
      ) : (
        <>
          <p className="crm-muted">{ileOdm(pokazane.length, 'kontakt', 'kontakty', 'kontaktów')}</p>
          <ul className="crm-calls">
            {pokazane.map((p) => {
              const r = p.rozmowa
              const m = p.mail
              return (
                <li key={`${p.rodzaj}:${p.id}`} className="crm-call">
                  <div className="crm-call-head">
                    <span className="crm-call-when">{fmtDateTime(p.kiedy)}</span>
                    <span className="crm-call-typ">{p.rodzaj === 'rozmowa' ? (r?.kierunek === 'wychodzaca' ? 'Rozmowa wychodząca' : 'Rozmowa') : m?.kanal === 'formularz' ? 'Formularz ze strony' : 'Mail'}</span>
                    {r && <span className="crm-call-meta">{czas(r.czas_s)}</span>}
                    <span className="crm-muted">{kto(p)}</span>
                    {p.typ && <span className="crm-call-typ" title="Sprawa (z analizy)">{CRM_SPRAWA[p.typ] ?? p.typ}</span>}
                    {p.potencjal === 'nie' && <span className="crm-status crm-status--muted" title="Ocena systemu">bez potencjału</span>}
                    {r?.link_nagrania && (
                      <a
                        href={r.link_nagrania}
                        className="crm-ext"
                        title="Nagranie w Ringostacie (otwiera przeglądarkę)"
                        onClick={(e) => {
                          e.preventDefault()
                          void openExternalUrl(r.link_nagrania!)
                        }}
                      >
                        odsłuchaj
                      </a>
                    )}
                    {m && (
                      <button type="button" className="crm-link" onClick={() => onOpenMail(m.id)} title="Otwórz mail">
                        {m.temat || '(bez tematu)'}
                      </button>
                    )}
                  </div>
                  {p.podsumowanie && <p className="crm-call-summary">{p.podsumowanie}</p>}
                  {p.powod && !(p.podsumowanie ?? '').includes(p.powod) && <p className="crm-muted">Powód: {p.powod}</p>}
                  {r?.transkrypcja && (
                    <details className="crm-details crm-details--inline">
                      <summary>Transkrypcja</summary>
                      <pre className="crm-pre">{r.transkrypcja}</pre>
                    </details>
                  )}
                  {mode === 'pelny' && (r?.analiza || m?.analiza) && (
                    <details className="crm-details crm-details--inline">
                      <summary>Analiza AI</summary>
                      <pre className="crm-pre">{JSON.stringify(r?.analiza ?? m?.analiza, null, 2)}</pre>
                    </details>
                  )}
                  <div className="crm-call-akcje">
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      disabled={busy !== null || (p.rodzaj === 'rozmowa' && !numerZRozmowy(r!))}
                      onClick={() => void utworz(p)}
                      title={p.rodzaj === 'rozmowa' && !numerZRozmowy(r!) ? 'Numer zastrzeżony — dodaj klienta ręcznie' : 'System się pomylił: załóż klienta i przypnij do niego ten kontakt'}
                    >
                      {busy === p.id ? <Spinner inline size={14} /> : null} Utwórz klienta
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
