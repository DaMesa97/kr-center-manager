// =====================================================================
// „Dodaj klienta” — walk-in / wizyta w salonie (brief pkt 13.1). Insert do crm.leady
// ze zrodlo='wizyta' + zdarzenie lead_utworzony (createLeadWizyta). Etykiety
// wybierane lokalnie (reguła „jedna na grupę” po stronie UI, trigger w bazie i tak
// pilnuje), opcjonalne zadanie z terminem. Telefon normalizowany do +48… (UNIQUE).
// =====================================================================
import { useMemo, useState } from 'react'
import { Save, X } from 'lucide-react'
import type { CurrentUser, ToastVariant } from '../../types'
import { CRM_AKCJA, CRM_ETYKIETA_GRUPA, CRM_ETYKIETA_GRUPY, type CrmEtykieta } from '../../types/crm'
import { createLeadWizyta, zlecOferteZNagrania, type NowyKlient } from '../../hooks/useCrm'
import { terminHintForIso } from '../../utils/crmTermin'
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

const AKCJE_WIZYTA = ['przygotuj_oferte', 'dopytaj', 'oddzwon'] as const

const todayIso = () => new Date().toISOString().slice(0, 10)

const empty = (): NowyKlient => ({ nazwa: '', telefon: '', email: '', miejscowosc: '', notatka: '', nastepna_akcja: null, nastepny_krok: todayIso(), etykiety: [] })

export default function CrmNowyKlient({ currentUser, slownik, pushToast, onCreated, onOpenExisting, onCancel }: Props) {
  const [k, setK] = useState<NowyKlient>(empty)
  const [busy, setBusy] = useState(false)
  const [existingId, setExistingId] = useState<string | null>(null)
  // brief pkt 18: nagranie trzymane do zapisu — najpierw insert leada, potem upload + rpc zlec_oferte_z_nagrania
  const [nagranie, setNagranie] = useState<Nagranie | null>(null)
  const dniWolne = useDniWolne()
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
    if (!k.nazwa.trim() && !k.telefon.trim() && !k.email.trim()) {
      pushToast('Podaj przynajmniej nazwę i telefon albo e-mail', 'error')
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
      <h4>Nowy klient — wizyta w salonie</h4>
      <div className="crm-pf-grid">
        <label className="crm-pf-field">
          <span className="crm-pf-label">Imię i nazwisko / firma</span>
          <input type="text" value={k.nazwa} onChange={(e) => set('nazwa', e.target.value)} placeholder="np. Jan Kowalski" autoComplete="off" autoFocus />
        </label>
        <label className="crm-pf-field">
          <span className="crm-pf-label">Telefon</span>
          <input type="tel" value={k.telefon} onChange={(e) => set('telefon', e.target.value)} placeholder="601 234 567" autoComplete="off" />
          <span className="crm-pf-hint">Zapisze się jako +48… (tak samo jak z Ringostatu).</span>
        </label>
        <label className="crm-pf-field">
          <span className="crm-pf-label">E-mail</span>
          <input type="email" value={k.email} onChange={(e) => set('email', e.target.value)} placeholder="jan@przyklad.pl" autoComplete="off" />
        </label>
        <label className="crm-pf-field">
          <span className="crm-pf-label">Miejscowość</span>
          <input type="text" value={k.miejscowosc} onChange={(e) => set('miejscowosc', e.target.value)} autoComplete="off" />
        </label>
        <label className="crm-pf-field crm-pf-field--wide">
          <span className="crm-pf-label">Notatka z rozmowy (czego chce)</span>
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
          <span className="crm-pf-label">Zadanie po wizycie</span>
          <select value={k.nastepna_akcja ?? ''} onChange={(e) => set('nastepna_akcja', e.target.value || null)}>
            <option value="">bez zadania</option>
            {AKCJE_WIZYTA.map((a) => (
              <option key={a} value={a}>
                {CRM_AKCJA[a].icon} {CRM_AKCJA[a].label}
              </option>
            ))}
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
          {busy ? <Spinner inline size={14} /> : <Save size={14} />} Zapisz klienta
        </button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={onCancel} disabled={busy}>
          <X size={14} /> Anuluj
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
