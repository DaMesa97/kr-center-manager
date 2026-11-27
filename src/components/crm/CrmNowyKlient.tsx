// =====================================================================
// „Dodaj klienta” — walk-in / wizyta w salonie (brief pkt 13.1) albo zapytanie z Facebooka /
// Instagrama (#166: bez telefonu i maila, wystarczy profil). Insert do crm.leady
// ze zrodlo='wizyta'|'social' + zdarzenie lead_utworzony (createLeadWizyta). Etykiety
// wybierane lokalnie (reguła „jedna na grupę” po stronie UI, trigger w bazie i tak
// pilnuje), opcjonalne zadanie z terminem. Telefon normalizowany do +48… (UNIQUE).
// =====================================================================
import { useMemo, useState } from 'react'
import type { CurrentUser, ToastVariant } from '../../types'
import { CRM_AKCJA, CRM_ETYKIETA_GRUPA, CRM_ETYKIETA_GRUPY, type CrmEtykieta } from '../../types/crm'
import { FIRMA_PUSTA, createLeadWizyta, zlecOferteZNagrania, type NowyKlient, type NowyKlientKanal } from '../../hooks/useCrm'
import CrmFirmaPolaForm from './CrmFirmaPola'
import { isoLocal, terminHintForIso } from '../../utils/crmTermin'
import { useDniWolne } from '../../hooks/useDniWolne'
import { EtykietaBadge } from './CrmEtykiety'
import CrmNagrajNotatke, { type Nagranie } from './CrmNagrajNotatke'
import Spinner from '../Spinner'

type Props = {
  currentUser: CurrentUser | null
  slownik: Map<string, CrmEtykieta>
  pushToast: (message: string, variant: ToastVariant) => void
  onCreated: (id: string) => void
  onOpenExisting: (id: string) => void
  onCancel: () => void
}

// 24.11 (Tymek): bez zadań „oddzwoń” — kontakt z klientem to „dopytaj”
const AKCJE_WIZYTA = ['follow_up', 'przygotuj_oferte', 'dopytaj', 'pomiar', 'montaz'] as const


// 21.11 (test UX): domyślnie „Zapytaj o decyzję” za 3 dni — „bez zadania” jako domyślne gubiło klientów (nie trafiali do „Do zrobienia”)
/** v3 (makieta „Dodaj klienta”, 27.11): źródło do wyboru + pole szczegółu tam, gdzie ma sens */
const ZRODLA: Array<{ k: NowyKlientKanal; label: string; szczegol?: { label: string; placeholder: string } }> = [
  { k: 'wizyta', label: 'Wizyta w salonie' },
  { k: 'telefon', label: 'Telefon (komórka, inny numer niż Ringostat)', szczegol: { label: 'Na który nasz numer zadzwonił', placeholder: 'np. komórka handlowca, stacjonarny w salonie' } },
  { k: 'mail', label: 'Mail (z innej skrzynki)', szczegol: { label: 'Na którą skrzynkę napisał', placeholder: 'np. prywatna skrzynka handlowca' } },
  { k: 'social', label: 'Facebook / Instagram' },
  { k: 'polecenie', label: 'Polecenie', szczegol: { label: 'Kto polecił', placeholder: 'np. pan Nowak z Pruszcza, montażysta, architekt' } },
  { k: 'inne', label: 'Inne', szczegol: { label: 'Skąd dokładnie', placeholder: 'np. targi, baner na budowie, ulotka' } },
]

const za3dni = () => { const d = new Date(); d.setDate(d.getDate() + 3); return isoLocal(d) }
const empty = (): NowyKlient => ({ kanal: 'wizyta', zrodlo_szczegol: '', nazwa: '', telefon: '', email: '', profil_social: '', miejscowosc: '', notatka: '', nastepna_akcja: 'follow_up', nastepny_krok: za3dni(), etykiety: [], firma: { ...FIRMA_PUSTA } })

export default function CrmNowyKlient({ currentUser, slownik, pushToast, onCreated, onOpenExisting, onCancel }: Props) {
  const [k, setK] = useState<NowyKlient>(empty)
  const [busy, setBusy] = useState(false)
  const [existingId, setExistingId] = useState<string | null>(null)
  // brief pkt 18: nagranie trzymane do zapisu — najpierw insert leada, potem upload + rpc zlec_oferte_z_nagrania
  const [nagranie, setNagranie] = useState<Nagranie | null>(null)
  const dniWolne = useDniWolne()
  const szczegol = ZRODLA.find((z) => z.k === k.kanal)?.szczegol
  const set = <F extends keyof NowyKlient>(f: F, v: NowyKlient[F]) => setK((s) => ({ ...s, [f]: v }))

  const grupy = useMemo(
    () =>
      CRM_ETYKIETA_GRUPY.map((g) => ({ grupa: g, items: [...slownik.values()].filter((e) => e.grupa === g && e.aktywna) })).filter((x) => x.items.length > 0),
    [slownik],
  )

  const toggleEtykieta = (e: CrmEtykieta) => {
    setK((s) => {
      const has = s.etykiety.includes(e.slug)
      if (has) return { ...s, etykiety: s.etykiety.filter((x) => x !== e.slug) }
      // „jedna na grupę”: podmień inną z tej samej grupy
      const rest = e.jedna_na_grupe ? s.etykiety.filter((x) => slownik.get(x)?.grupa !== e.grupa) : s.etykiety
      return { ...s, etykiety: [...rest, e.slug] }
    })
  }

  const onSave = async () => {
    if (!currentUser) return
    if (!k.nazwa.trim() && !k.telefon.trim() && !k.email.trim() && !k.profil_social.trim()) {
      pushToast(k.kanal === 'social' ? 'Podaj przynajmniej nazwę i profil (link albo @nazwa)' : 'Podaj przynajmniej nazwę i telefon albo e-mail', 'error')
      return
    }
    setBusy(true)
    setExistingId(null)
    const res = await createLeadWizyta(k, currentUser.id)
    setBusy(false)
    if (res.error) {
      pushToast(res.error.message, 'error')
      if (res.existingId) setExistingId(res.existingId)
      return
    }
    if (res.id) {
      if (nagranie) {
        setBusy(true)
        const err = await zlecOferteZNagrania(res.id, nagranie.blob, nagranie.contentType)
        setBusy(false)
        if (err) pushToast(`Klient dodany, ale nagranie nie poszło: ${err.message}. Nagraj ponownie na karcie klienta.`, 'error')
        else pushToast('Klient dodany, nagranie wysłane — system spisze notatkę i policzy ofertę', 'success')
      } else {
        pushToast('Klient dodany', 'success')
      }
      onCreated(res.id)
    }
  }

  return (
    <section className="crm-box crm-pf crm-nowy-klient">
      <h4>Dodaj klienta</h4>
      <p className="crm-muted crm-nowy-opis">Klient, którego system nie złapał sam. Rozmowy z Ringostatu i maile ze skrzynek w CRM dodają się same.</p>
      <div className="crm-pf-grid">
        <label className="crm-pf-field crm-pf-field--short">
          <span className="crm-pf-label">Skąd klient</span>
          <select value={k.kanal} onChange={(e) => set('kanal', e.target.value as NowyKlientKanal)}>
            {ZRODLA.map((z) => <option key={z.k} value={z.k}>{z.label}</option>)}
          </select>
        </label>
        {szczegol && (
          <label className="crm-pf-field">
            <span className="crm-pf-label">{szczegol.label}</span>
            <input type="text" value={k.zrodlo_szczegol} onChange={(e) => set('zrodlo_szczegol', e.target.value)} placeholder={szczegol.placeholder} autoComplete="off" />
          </label>
        )}
        <label className="crm-pf-field">
          <span className="crm-pf-label">Imię i nazwisko / firma</span>
          <input type="text" value={k.nazwa} onChange={(e) => set('nazwa', e.target.value)} placeholder="np. Jan Kowalski" autoComplete="off" autoFocus />
        </label>
        {k.kanal === 'social' && (
          <label className="crm-pf-field">
            <span className="crm-pf-label">Profil / nick <span className="crm-muted">(wystarczy zamiast telefonu i maila)</span></span>
            <input type="text" value={k.profil_social} onChange={(e) => set('profil_social', e.target.value)} placeholder="@jan.kowalski albo link do profilu" autoComplete="off" />
            <span className="crm-pf-hint">Wklej link z Messengera/Instagrama albo nazwę profilu — po tym odnajdziesz rozmowę.</span>
          </label>
        )}
        <label className="crm-pf-field">
          <span className="crm-pf-label">Telefon {k.kanal === 'social' ? <span className="crm-muted">(jeśli podał)</span> : <span className="crm-muted">(telefon albo e-mail — jedno wymagane)</span>}</span>
          <input type="tel" value={k.telefon} onChange={(e) => set('telefon', e.target.value)} placeholder="601 234 567" autoComplete="off" />
          <span className="crm-pf-hint">Zapisze się jako +48… (tak samo jak z Ringostatu).</span>
        </label>
        <label className="crm-pf-field">
          <span className="crm-pf-label">E-mail{k.kanal === 'social' ? <span className="crm-muted"> (jeśli podał)</span> : null}</span>
          <input type="email" value={k.email} onChange={(e) => set('email', e.target.value)} placeholder="jan@przyklad.pl" autoComplete="off" />
        </label>
        <label className="crm-pf-field">
          <span className="crm-pf-label">Miejscowość</span>
          <input type="text" value={k.miejscowosc} onChange={(e) => set('miejscowosc', e.target.value)} autoComplete="off" />
        </label>
        {/* 27.11: klient-firma — NIP i dane z GUS (do zamówień i umów) */}
        <CrmFirmaPolaForm
          value={k.firma ?? FIRMA_PUSTA}
          onChange={(f) => set('firma', f)}
          disabled={busy}
          pushToast={pushToast}
          onPobrano={(r) => setK((s) => ({ ...s, nazwa: s.nazwa.trim() ? s.nazwa : r.nazwa, miejscowosc: s.miejscowosc.trim() ? s.miejscowosc : (r.miasto ?? '') }))}
        />
        <label className="crm-pf-field crm-pf-field--wide">
          <span className="crm-pf-label">Czego chce <span className="crm-muted">(z tego system policzy ofertę)</span></span>
          <textarea value={k.notatka} onChange={(e) => set('notatka', e.target.value)} rows={3} placeholder="np. drzwi zewnętrzne 90 prawe, antracyt, z montażem, termin do końca miesiąca" />
          <span className="crm-pf-hint crm-pf-hint--rec">
            albo powiedz do mikrofonu:{' '}
            <CrmNagrajNotatke size="sm" pending={nagranie} onRecorded={(n) => setNagranie(n)} onClear={() => setNagranie(null)} disabled={busy} />
            {nagranie && <span className="crm-muted"> · po zapisie klienta system spisze nagranie i policzy ofertę</span>}
          </span>
        </label>
      </div>

      {grupy.length > 0 && (
        <div className="crm-pf-grid crm-pf-grid--folders">
          {grupy.map(({ grupa, items }) => (
            <div key={grupa} className="crm-tags-group">
              <span className="crm-tags-group-name">
                {CRM_ETYKIETA_GRUPA[grupa] ?? grupa}
                {items[0]?.jedna_na_grupe ? <span className="crm-muted"> · jedna</span> : null}
              </span>
              <span className="crm-tags-group-items">
                {items.map((e) => (
                  <EtykietaBadge key={e.slug} e={e} on={k.etykiety.includes(e.slug)} onClick={() => toggleEtykieta(e)} />
                ))}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="crm-pf-grid crm-pf-grid--folders">
        <label className="crm-pf-field">
          <span className="crm-pf-label">Następny krok</span>
          <select value={k.nastepna_akcja ?? ''} onChange={(e) => set('nastepna_akcja', e.target.value || null)}>
            {AKCJE_WIZYTA.map((a) => (
              <option key={a} value={a}>
                {CRM_AKCJA[a].label}
              </option>
            ))}
            <option value="">bez zadania (klient nie pojawi się w „Do zrobienia”)</option>
          </select>
        </label>
        {k.nastepna_akcja && (
          <label className="crm-pf-field crm-pf-field--short">
            <span className="crm-pf-label">Termin</span>
            <input type="date" value={k.nastepny_krok ?? ''} onChange={(e) => set('nastepny_krok', e.target.value || null)} />
            {terminHintForIso(k.nastepny_krok, new Date(), dniWolne) && <span className="crm-pf-hint">{terminHintForIso(k.nastepny_krok, new Date(), dniWolne)}</span>}
          </label>
        )}
      </div>

      <div className="crm-poczta-actions">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void onSave()} disabled={busy}>
          {busy ? <Spinner inline size={14} /> : null} Zapisz klienta
        </button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={onCancel} disabled={busy}>
          Anuluj
        </button>
        {existingId && (
          <button type="button" className="crm-link" onClick={() => onOpenExisting(existingId)}>
            Otwórz istniejącego klienta z tym numerem
          </button>
        )}
      </div>
    </section>
  )
}
