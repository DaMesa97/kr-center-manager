// =====================================================================
// Dokumenty klienta (brief pkt 22): karta pomiarowa / umowa / protokół odbioru w szablonie
// wtyczki dokumenty-po-drzwi. PDF robi Edge Function crm-dokumenty (synchronicznie, kilka
// sekund; zimny start do ~1 min) — aplikacja tylko zbiera pola, woła funkcję i dostaje
// podpisany link. Umowa = zobowiązanie: nic nie wysyłamy automatycznie, Autenti ręcznie.
// Panel w miejscu (bez natywnych dialogów — zasada aplikacji).
// =====================================================================
import { useState } from 'react'
import type { ToastVariant } from '../../types'
import { adresFirmy, formatNip } from '../../lib/nip'
import { CRM_DOKUMENT_RODZAJ, CRM_KARTA_OTWORY_MAX, CRM_OTWOR_RODZAJ, type CrmDokument, type CrmDokumentOdp, type CrmLead, type CrmOferta } from '../../types/crm'
import { generujDokument, type GenerujDokument, konfiguracjaPliki } from '../../hooks/useCrm'
import Spinner from '../Spinner'

export type DokumentRodzaj = GenerujDokument['rodzaj']

type Props = {
  rodzaj: DokumentRodzaj
  lead: CrmLead
  /** oferty oficjalne z montażem, policzone (umowa) */
  ofertyDoUmowy: CrmOferta[]
  /** istniejące umowy klienta (protokół) */
  umowy: CrmDokument[]
  /** „Generuj ponownie”: pola z migawki `dane`, dokument_id w wywołaniu (umowa zachowuje numer) */
  istniejacy?: CrmDokument | null
  pushToast: (message: string, variant: ToastVariant) => void
  onCreated: (odp: CrmDokumentOdp) => void
  onCancel: () => void
}

/** 'RRRR-MM-DD' (input date) → 'DD.MM.RRRR' (format funkcji) */
const toPl = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}
/** 'DD.MM.RRRR' → 'RRRR-MM-DD' (do inputa) */
const fromPl = (pl: unknown): string => {
  if (typeof pl !== 'string') return ''
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(pl)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : pl
}
const todayIso = (): string => new Date().toLocaleDateString('sv-SE')
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback)
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

type Otwor = { rodzaj: string; pomieszczenie: string }

const fmtPln = (v: number | null | undefined): string =>
  v == null ? '—' : new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }).format(Number(v))

export default function CrmDokumentForm({ rodzaj, lead, ofertyDoUmowy, umowy, istniejacy, pushToast, onCreated, onCancel }: Props) {
  const d = istniejacy?.dane ?? {}
  const [busy, setBusy] = useState(false)
  const klient = (lead.nazwa || lead.telefon || lead.email || 'Klient bez nazwy').trim()
  const tytul = `${CRM_DOKUMENT_RODZAJ[rodzaj]?.label ?? rodzaj}${istniejacy ? ' — generuj ponownie' : ''} · ${klient}`

  // ---- karta pomiarowa ----
  const [dataPomiaru, setDataPomiaru] = useState(fromPl(d.data_pomiaru))
  const [godzina, setGodzina] = useState(str(d.godzina))
  const [adresPomiaru, setAdresPomiaru] = useState(str(d.adres_pomiaru, lead.miejscowosc ?? ''))
  // „kto jedzie” za każdym razem wpisywane (decyzja właściciela), bez pamiętania — przy regeneracji z migawki
  const [wykonal, setWykonal] = useState(str(d.wykonal))
  const [pietro, setPietro] = useState(str(d.pietro))
  const [otwory, setOtwory] = useState<Otwor[]>(
    Array.isArray(d.otwory) ? (d.otwory as Otwor[]).map((o) => ({ rodzaj: str(o?.rodzaj, CRM_OTWOR_RODZAJ[0]), pomieszczenie: str(o?.pomieszczenie) })) : [],
  )

  // ---- umowa ----
  // runda 4 (tester CRM): domyślnie brana była najstarsza oferta z listy (inna kwota niż przyjęta) — najpierw
  // zaakceptowana („Zamówił”), potem najnowsza
  const ofertaDomyslna =
    ofertyDoUmowy.find((o) => o.status === 'zaakceptowana') ??
    [...ofertyDoUmowy].sort((a, b) => (Number(b.wersja) || 0) - (Number(a.wersja) || 0))[0]
  const [ofertaId, setOfertaId] = useState(istniejacy?.oferta_id ?? ofertaDomyslna?.id ?? '')
  // 27.11: klient-firma — adres z danych firmy (NIP / GUS) jako podpowiedź
  const [klientAdres, setKlientAdres] = useState(str(d.klient_adres, adresFirmy(lead)))
  const [adresMontazu, setAdresMontazu] = useState(str(d.adres_montazu))
  const [zaliczka, setZaliczka] = useState(num(d.zaliczka_proc, 40))
  const [terminTryb, setTerminTryb] = useState<'tygodnie' | 'data'>(typeof d.termin_data === 'string' && d.termin_data ? 'data' : 'tygodnie')
  const [terminTyg, setTerminTyg] = useState(num(d.termin_tygodnie, 8))
  const [terminData, setTerminData] = useState(fromPl(d.termin_data))
  const [gwarancja, setGwarancja] = useState(num(d.gwarancja_miesiace, 24))
  const [dataZawarcia, setDataZawarcia] = useState(fromPl(d.data_zawarcia) || todayIso())
  const [miejsce, setMiejsce] = useState(str(d.miejsce_zawarcia, 'Wodzisławiu Śląskim'))
  const [nadpisz, setNadpisz] = useState(Boolean(istniejacy && (d.przedmiot || d.zakres_prac)))
  const [przedmiot, setPrzedmiot] = useState(str(d.przedmiot))
  const [zakresPrac, setZakresPrac] = useState(str(d.zakres_prac))

  // ---- protokół ----
  const umowaZMigawki = typeof d.umowa_id === 'string' ? d.umowa_id : ''
  const [umowaId, setUmowaId] = useState(umowaZMigawki || umowy[0]?.id || '')
  const [dataOdbioru, setDataOdbioru] = useState(fromPl(d.data_odbioru))
  const [adresOdbioru, setAdresOdbioru] = useState(str(d.adres_montazu))

  const oferta = ofertyDoUmowy.find((o) => o.id === ofertaId)
  const umowa = umowy.find((u) => u.id === umowaId)

  const onSave = async () => {
    let req: GenerujDokument
    if (rodzaj === 'karta_pomiarowa') {
      // crm-dokumenty v4 (zgłoszenie #151): karta wymaga tylko nazwiska klienta — reszta to puste pola do wpisania ręcznie na pomiarze
      if (!lead.nazwa?.trim()) {
        pushToast('Karta wymaga nazwiska klienta — uzupełnij dane w karcie klienta („edytuj” przy Kontakcie)', 'error')
        return
      }
      req = {
        rodzaj,
        lead_id: lead.id,
        dane: {
          data_pomiaru: dataPomiaru ? toPl(dataPomiaru) : undefined,
          godzina: godzina || undefined,
          adres_pomiaru: adresPomiaru.trim() || undefined,
          wykonal: wykonal.trim() || undefined,
          pietro: pietro.trim() || undefined,
          otwory: otwory.filter((o) => o.pomieszczenie.trim() || o.rodzaj).map((o) => ({ rodzaj: o.rodzaj, pomieszczenie: o.pomieszczenie.trim() })),
        },
      }
    } else if (rodzaj === 'umowa') {
      if (!ofertaId) {
        pushToast('Wybierz ofertę oficjalną z montażem', 'error')
        return
      }
      if (!klientAdres.trim()) {
        pushToast('Wpisz adres klienta (ulica, kod, miejscowość)', 'error')
        return
      }
      if (terminTryb === 'data' && !terminData) {
        pushToast('Wpisz indywidualny termin albo przełącz na tygodnie', 'error')
        return
      }
      req = {
        rodzaj,
        lead_id: lead.id,
        oferta_id: ofertaId,
        dane: {
          klient_adres: klientAdres.trim(),
          // 27.11: firma klienta z karty (NIP / GUS) — do umowy z firmą
          ...(lead.nip ? { klient_nip: formatNip(lead.nip) } : {}),
          ...(lead.firma_nazwa ? { klient_firma: lead.firma_nazwa } : {}),
          adres_montazu: adresMontazu.trim() || klientAdres.trim(),
          zaliczka_proc: zaliczka,
          ...(terminTryb === 'data' ? { termin_data: toPl(terminData) } : { termin_tygodnie: terminTyg }),
          gwarancja_miesiace: gwarancja,
          data_zawarcia: toPl(dataZawarcia),
          miejsce_zawarcia: miejsce.trim() || 'Wodzisławiu Śląskim',
          ...(nadpisz && przedmiot.trim() ? { przedmiot: przedmiot.trim() } : {}),
          ...(nadpisz && zakresPrac.trim() ? { zakres_prac: zakresPrac.trim() } : {}),
        },
      }
    } else {
      // umowę wskazuje dane.umowa_id (bez niej funkcja bierze ostatnią umowę klienta)
      req = {
        rodzaj,
        lead_id: lead.id,
        dane: {
          ...(umowaId ? { umowa_id: umowaId } : {}),
          ...(dataOdbioru ? { data_odbioru: toPl(dataOdbioru) } : {}),
          ...(adresOdbioru.trim() ? { adres_montazu: adresOdbioru.trim() } : {}),
        },
      }
    }
    // regeneracja: dokument_id = ten sam wiersz dla karty, umowy (zachowuje numer) i protokołu (crm-dokumenty v3)
    if (istniejacy) req.dokument_id = istniejacy.id
    setBusy(true)
    const res = await generujDokument(req)
    setBusy(false)
    if (res.error || !res.data) {
      pushToast(res.error?.message ?? 'Nie udało się wygenerować dokumentu', 'error')
      return
    }
    onCreated(res.data)
  }

  return (
    <section className="crm-box crm-pf crm-ofic-form crm-dok-form" role="dialog" aria-label={tytul}>
      <div className="crm-screen-head">
        <div className="crm-screen-title">
          <h4>{tytul}</h4>
          <div className="crm-screen-sub">{CRM_DOKUMENT_RODZAJ[rodzaj]?.title}. PDF w szablonie Po Drzwi powstaje po kilku sekundach (pierwsze wywołanie do minuty).</div>
        </div>
      </div>

      {rodzaj === 'karta_pomiarowa' && (
        <>
          <div className="crm-pf-grid">
            <label className="crm-pf-field crm-pf-field--short">
              <span className="crm-pf-label">Data pomiaru</span>
              <input type="date" value={dataPomiaru} onChange={(e) => setDataPomiaru(e.target.value)} disabled={busy} />
            </label>
            <label className="crm-pf-field crm-pf-field--short">
              <span className="crm-pf-label">Godzina</span>
              <input type="time" value={godzina} onChange={(e) => setGodzina(e.target.value)} disabled={busy} />
            </label>
            <label className="crm-pf-field crm-pf-field--wide">
              <span className="crm-pf-label">Adres pomiaru</span>
              <input type="text" value={adresPomiaru} onChange={(e) => setAdresPomiaru(e.target.value)} placeholder="ulica, kod, miejscowość" disabled={busy} />
            </label>
            <label className="crm-pf-field">
              <span className="crm-pf-label">Kto jedzie na pomiar</span>
              <input type="text" value={wykonal} onChange={(e) => setWykonal(e.target.value)} placeholder="imię i nazwisko" disabled={busy} autoComplete="off" />
            </label>
            <label className="crm-pf-field crm-pf-field--short">
              <span className="crm-pf-label">Piętro</span>
              <input type="text" value={pietro} onChange={(e) => setPietro(e.target.value)} placeholder="np. parter" disabled={busy} />
            </label>
          </div>
          <h5>Otwory wpisane z góry <span className="crm-muted">(opcjonalnie; w tabeli zawsze {CRM_KARTA_OTWORY_MAX} wierszy)</span></h5>
          <div className="crm-uslugi">
            {otwory.map((o, i) => (
              <div key={i} className="crm-usluga-row crm-otwor-row">
                <select value={o.rodzaj} onChange={(e) => setOtwory((s) => s.map((x, j) => (j === i ? { ...x, rodzaj: e.target.value } : x)))} disabled={busy} aria-label="Rodzaj drzwi">
                  {CRM_OTWOR_RODZAJ.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <input type="text" value={o.pomieszczenie} onChange={(e) => setOtwory((s) => s.map((x, j) => (j === i ? { ...x, pomieszczenie: e.target.value } : x)))} placeholder="pomieszczenie (np. łazienka)" disabled={busy} />
                <button type="button" className="crm-link" disabled={busy} onClick={() => setOtwory((s) => s.filter((_, j) => j !== i))} title="Usuń wiersz">Usuń</button>
              </div>
            ))}
            <div className="crm-poczta-actions">
              <button type="button" className="btn btn-sm btn-secondary" disabled={busy || otwory.length >= CRM_KARTA_OTWORY_MAX} onClick={() => setOtwory((s) => [...s, { rodzaj: CRM_OTWOR_RODZAJ[0], pomieszczenie: '' }])}>Dodaj otwór</button>
            </div>
          </div>
          <p className="crm-muted">Wymagane jest tylko nazwisko klienta. Puste pola zostają na karcie jako kropki do wpisania długopisem na pomiarze{(!lead.telefon || !lead.email) ? ` — w danych klienta brakuje: ${[!lead.telefon && 'telefon', !lead.email && 'e-mail'].filter(Boolean).join(', ')}` : ''}.</p>
        </>
      )}

      {rodzaj === 'umowa' && (
        <>
          <div className="crm-pf-grid">
            <label className="crm-pf-field crm-pf-field--wide">
              <span className="crm-pf-label">Oferta oficjalna z montażem *</span>
              {ofertyDoUmowy.length === 0 ? (
                <span className="crm-muted">Brak policzonej oferty oficjalnej z montażem — najpierw „Oferta z montażem”.</span>
              ) : (
                <select value={ofertaId} onChange={(e) => setOfertaId(e.target.value)} disabled={busy || Boolean(istniejacy)}>
                  {ofertyDoUmowy.map((o) => <option key={o.id} value={o.id}>nr {o.numer ?? '…'} v{o.wersja} · {fmtPln(o.brutto)} brutto{o.status === 'zaakceptowana' ? ' · PRZYJĘTA' : ''}{o.streszczenie ? ` · ${o.streszczenie}` : ''}</option>)}
                </select>
              )}
              {oferta && <span className="crm-pf-hint">Załącznik nr 1 = PDF tej oferty{(() => { const n = konfiguracjaPliki(oferta).filter((p) => p.toLowerCase().endsWith('.pdf')).length; return n === 0 ? '' : n === 1 ? ' + konfiguracja producenta' : ` + ${n} konfiguracje producenta` })()}. VAT {oferta.vat_stawka != null ? `${oferta.vat_stawka}%` : 'z oferty'}{Number(oferta.vat_stawka) === 8 ? ' → §3a (oświadczenie o budynku mieszkalnym) wstawi się sam' : ''}.</span>}
            </label>
            <label className="crm-pf-field crm-pf-field--wide">
              <span className="crm-pf-label">Adres klienta * <span className="crm-muted">{adresFirmy(lead) ? `(z danych firmy, NIP ${formatNip(lead.nip)})` : '(karta klienta nie ma ulicy — wpisz albo dodaj NIP firmy na karcie)'}</span></span>
              <input type="text" value={klientAdres} onChange={(e) => setKlientAdres(e.target.value)} placeholder="ul. …, kod, miejscowość" disabled={busy} />
            </label>
            <label className="crm-pf-field crm-pf-field--wide">
              <span className="crm-pf-label">Adres montażu</span>
              <input type="text" value={adresMontazu} onChange={(e) => setAdresMontazu(e.target.value)} placeholder={klientAdres.trim() ? `jak adres klienta: ${klientAdres.trim()}` : 'puste = jak adres klienta'} disabled={busy} />
            </label>
            <label className="crm-pf-field crm-pf-field--short">
              <span className="crm-pf-label">Zaliczka (%)</span>
              <input type="number" min={0} max={100} step={1} value={zaliczka} onChange={(e) => setZaliczka(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} disabled={busy} />
              {oferta?.brutto != null && <span className="crm-pf-hint">{fmtPln(Math.round((Number(oferta.brutto) * zaliczka) / 100))} z {fmtPln(oferta.brutto)}</span>}
            </label>
            <div className="crm-pf-field">
              <span className="crm-pf-label">Termin realizacji</span>
              <div className="crm-dok-termin">
                <label className="crm-check-inline"><input type="radio" name="crm-termin" checked={terminTryb === 'tygodnie'} onChange={() => setTerminTryb('tygodnie')} disabled={busy} /> tygodni:</label>
                <input type="number" min={1} max={52} value={terminTyg} onChange={(e) => setTerminTyg(Math.max(1, Number(e.target.value) || 1))} disabled={busy || terminTryb !== 'tygodnie'} aria-label="Termin w tygodniach" />
                <label className="crm-check-inline"><input type="radio" name="crm-termin" checked={terminTryb === 'data'} onChange={() => setTerminTryb('data')} disabled={busy} /> do dnia:</label>
                <input type="date" value={terminData} onChange={(e) => setTerminData(e.target.value)} disabled={busy || terminTryb !== 'data'} aria-label="Termin indywidualny" />
              </div>
            </div>
            <label className="crm-pf-field crm-pf-field--short">
              <span className="crm-pf-label">Gwarancja (miesiące)</span>
              <input type="number" min={0} max={120} value={gwarancja} onChange={(e) => setGwarancja(Math.max(0, Number(e.target.value) || 0))} disabled={busy} />
            </label>
            <label className="crm-pf-field crm-pf-field--short">
              <span className="crm-pf-label">Data zawarcia</span>
              <input type="date" value={dataZawarcia} onChange={(e) => setDataZawarcia(e.target.value)} disabled={busy} />
            </label>
            <label className="crm-pf-field">
              <span className="crm-pf-label">Miejsce zawarcia <span className="crm-muted">(„zawarta w …”)</span></span>
              <input type="text" value={miejsce} onChange={(e) => setMiejsce(e.target.value)} disabled={busy} />
            </label>
            <label className="crm-pf-field crm-pf-field--check crm-pf-field--wide">
              <input type="checkbox" checked={nadpisz} onChange={(e) => setNadpisz(e.target.checked)} disabled={busy} />
              <span>Własny tekst §1 (przedmiot i zakres prac) zamiast tekstu ze streszczenia oferty i jej zakresu</span>
            </label>
            {nadpisz && (
              <>
                <label className="crm-pf-field crm-pf-field--wide">
                  <span className="crm-pf-label">Przedmiot umowy</span>
                  <textarea className="crm-fix-textarea" rows={2} value={przedmiot} onChange={(e) => setPrzedmiot(e.target.value)} placeholder={oferta?.streszczenie ?? 'np. Drzwi zewnętrzne … wraz z montażem'} disabled={busy} />
                </label>
                <label className="crm-pf-field crm-pf-field--wide">
                  <span className="crm-pf-label">Zakres prac</span>
                  <textarea className="crm-fix-textarea" rows={2} value={zakresPrac} onChange={(e) => setZakresPrac(e.target.value)} placeholder="np. Towar z montażem, dostawa wliczona, bez obróbki murarskiej." disabled={busy} />
                </label>
              </>
            )}
          </div>
          <p className="crm-dok-uwaga"><b>Umowa to zobowiązanie.</b> System tylko składa PDF z numerem NN/MM/RRRR — nic nie wysyła. Obejrzyj dokument przed wysłaniem do Autenti; wysyłka zostaje ręczna.</p>
        </>
      )}

      {rodzaj === 'protokol' && (
        <>
          <div className="crm-pf-grid">
            <label className="crm-pf-field crm-pf-field--wide">
              <span className="crm-pf-label">Umowa</span>
              {umowy.length === 0 ? (
                <span className="crm-muted">Brak umowy klienta — protokół robi się do umowy.</span>
              ) : (
                <select value={umowaId} onChange={(e) => setUmowaId(e.target.value)} disabled={busy}>
                  {umowy.map((u) => <option key={u.id} value={u.id}>umowa nr {u.numer ?? '…'} · {str(u.dane.data_zawarcia)} · {fmtPln(typeof u.dane.brutto === 'number' ? u.dane.brutto : null)}</option>)}
                </select>
              )}
              {umowa && <span className="crm-pf-hint">Rozliczenie z umowy: brutto {fmtPln(typeof umowa.dane.brutto === 'number' ? umowa.dane.brutto : null)}, zaliczka {fmtPln(typeof umowa.dane.zaliczka === 'number' ? umowa.dane.zaliczka : null)}, po odbiorze {fmtPln(typeof umowa.dane.pozostalo === 'number' ? umowa.dane.pozostalo : null)}.</span>}
            </label>
            <label className="crm-pf-field crm-pf-field--short">
              <span className="crm-pf-label">Data odbioru</span>
              <input type="date" value={dataOdbioru} onChange={(e) => setDataOdbioru(e.target.value)} disabled={busy} />
              <span className="crm-pf-hint">puste = kropki do wpisania ręcznie</span>
            </label>
            <label className="crm-pf-field crm-pf-field--wide">
              <span className="crm-pf-label">Adres montażu</span>
              <input type="text" value={adresOdbioru} onChange={(e) => setAdresOdbioru(e.target.value)} placeholder={umowa ? `z umowy: ${str(umowa.dane.adres_montazu)}` : 'puste = z umowy'} disabled={busy} />
            </label>
          </div>
        </>
      )}

      <div className="crm-poczta-actions">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void onSave()} disabled={busy || (rodzaj === 'umowa' && ofertyDoUmowy.length === 0) || (rodzaj === 'protokol' && umowy.length === 0)}>
          {busy ? <Spinner inline size={14} /> : null} {busy ? 'Składam PDF…' : istniejacy ? 'Generuj ponownie' : 'Generuj PDF'}
        </button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={onCancel} disabled={busy}>Anuluj</button>
      </div>
    </section>
  )
}
