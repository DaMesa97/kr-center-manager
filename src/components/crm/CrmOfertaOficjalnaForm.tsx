// =====================================================================
// „Oferta z montażem” (brief pkt 21): formularz na karcie klienta. Ceny NIE są liczone
// przez nas — AI przepisuje je z konfiguracji producenta (plik z konfiguratora albo
// wklejony tekst); usługi własne bez stałych stawek; VAT 8%/23% liczy backend wg
// obiektu mieszkalnego i powierzchni. Zapis: upload pliku do crm-dokumenty + rpc
// zlec_oferte_oficjalna (zlecOferteOficjalna) → po ~20–40 s oferta do_sprawdzenia.
// =====================================================================
import { useState } from 'react'
import { FileText, Plus, Trash2, X } from 'lucide-react'
import type { ToastVariant } from '../../types'
import { CRM_PRODUCENCI, CRM_RODZAJ_LOKALU, CRM_USLUGI_PODPOWIEDZI, CRM_ZAKRES_PODPOWIEDZI } from '../../types/crm'
import { zlecOferteOficjalna, type OfertaOficjalnaForm } from '../../hooks/useCrm'
import Spinner from '../Spinner'

type Props = {
  leadId: string
  klient: string
  pushToast: (message: string, variant: ToastVariant) => void
  /** id nowej oferty (status przelicz) */
  onCreated: (ofertaId: string | null) => void
  onCancel: () => void
}

const ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'
const MAX_MB = 25

const empty = (): OfertaOficjalnaForm => ({
  konfiguracja_plik: null,
  konfiguracja_tekst: '',
  producent: '',
  uslugi: [{ nazwa: 'Montaż', netto: 0 }],
  zakres: CRM_ZAKRES_PODPOWIEDZI[0],
  z_montazem: true,
  lokal_mieszkalny: true,
  rodzaj_lokalu: 'dom',
  powierzchnia_m2: '',
})

export default function CrmOfertaOficjalnaForm({ leadId, klient, pushToast, onCreated, onCancel }: Props) {
  const [f, setF] = useState<OfertaOficjalnaForm>(empty)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof OfertaOficjalnaForm>(k: K, v: OfertaOficjalnaForm[K]) => setF((s) => ({ ...s, [k]: v }))

  const onFile = (file: File | null) => {
    if (file && file.size > MAX_MB * 1024 * 1024) {
      pushToast(`Plik jest za duży (limit ${MAX_MB} MB)`, 'error')
      return
    }
    set('konfiguracja_plik', file)
  }

  const setUsluga = (i: number, patch: Partial<{ nazwa: string; netto: number }>) =>
    setF((s) => ({ ...s, uslugi: s.uslugi.map((u, j) => (j === i ? { ...u, ...patch } : u)) }))

  const onSave = async () => {
    if (!f.konfiguracja_plik && !f.konfiguracja_tekst.trim()) {
      pushToast('Dodaj plik z konfiguratora albo wklej treść konfiguracji', 'error')
      return
    }
    // stawka VAT jest źródłem prawdy z konfiguracji producenta (crm-oferta-pdf v3); obiekt/rodzaj/m² tylko do kontroli
    setBusy(true)
    const res = await zlecOferteOficjalna(leadId, f)
    setBusy(false)
    if (res.error) {
      pushToast(`Nie udało się zlecić oferty: ${res.error.message}`, 'error')
      return
    }
    pushToast('Zlecono ofertę z montażem — system przepisuje pozycje i robi PDF (ok. pół minuty)', 'success')
    onCreated(res.data)
  }

  const sumaUslug = f.uslugi.reduce((a, u) => a + (Number(u.netto) || 0), 0)

  return (
    <section className="crm-box crm-pf crm-ofic-form">
      <div className="crm-screen-head">
        <div className="crm-screen-title">
          <h4><FileText size={16} /> Oferta z montażem (PDF) · {klient}</h4>
          <div className="crm-screen-sub">Ceny i stawkę VAT przepisujemy z konfiguracji producenta, usługi wpisujesz sam. Dane o obiekcie są opcjonalne — służą do kontroli, czy stawka z pliku ma sens.</div>
        </div>
      </div>

      <h5>1. Konfiguracja producenta</h5>
      <div className="crm-pf-grid">
        <label className="crm-pf-field">
          <span className="crm-pf-label">Plik z konfiguratora (PDF / JPG / PNG)</span>
          <input type="file" accept={ACCEPT} disabled={busy} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          {f.konfiguracja_plik && <span className="crm-pf-hint">{f.konfiguracja_plik.name} · {(f.konfiguracja_plik.size / 1024 / 1024).toFixed(1)} MB</span>}
        </label>
        <label className="crm-pf-field">
          <span className="crm-pf-label">Producent (opcjonalnie)</span>
          <input type="text" list="crm-producenci" value={f.producent} onChange={(e) => set('producent', e.target.value)} placeholder="rozpozna system" disabled={busy} autoComplete="off" />
          <datalist id="crm-producenci">{CRM_PRODUCENCI.map((p) => <option key={p} value={p} />)}</datalist>
        </label>
        <label className="crm-pf-field crm-pf-field--wide">
          <span className="crm-pf-label">…albo wklej treść konfiguracji</span>
          <textarea className="crm-fix-textarea" rows={5} value={f.konfiguracja_tekst} onChange={(e) => set('konfiguracja_tekst', e.target.value)} placeholder="Skopiuj z wydruku konfiguratora: pozycje, ilości, ceny" disabled={busy} />
        </label>
      </div>

      <h5>2. Usługi własne (netto, bez stałych stawek)</h5>
      <div className="crm-uslugi">
        {f.uslugi.map((u, i) => (
          <div key={i} className="crm-usluga-row">
            <input type="text" list="crm-uslugi-podp" value={u.nazwa} onChange={(e) => setUsluga(i, { nazwa: e.target.value })} placeholder="Nazwa usługi" disabled={busy} autoComplete="off" />
            <input type="number" min={0} step={1} value={u.netto || ''} onChange={(e) => setUsluga(i, { netto: Number(e.target.value) || 0 })} placeholder="netto zł" disabled={busy} />
            <button type="button" className="crm-link" disabled={busy} onClick={() => setF((s) => ({ ...s, uslugi: s.uslugi.filter((_, j) => j !== i) }))} title="Usuń usługę"><Trash2 size={14} /></button>
          </div>
        ))}
        <datalist id="crm-uslugi-podp">{CRM_USLUGI_PODPOWIEDZI.map((p) => <option key={p} value={p} />)}</datalist>
        <div className="crm-poczta-actions">
          <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setF((s) => ({ ...s, uslugi: [...s.uslugi, { nazwa: '', netto: 0 }] }))}><Plus size={14} /> Dodaj usługę</button>
          <span className="crm-muted">razem usługi: {sumaUslug.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł netto</span>
        </div>
      </div>

      <h5>3. Zakres i obiekt <span className="crm-muted">(obiekt opcjonalnie)</span></h5>
      <div className="crm-pf-grid">
        <label className="crm-pf-field crm-pf-field--wide">
          <span className="crm-pf-label">Zakres (jedno zdanie w PDF)</span>
          <input type="text" list="crm-zakres-podp" value={f.zakres} onChange={(e) => set('zakres', e.target.value)} disabled={busy} autoComplete="off" />
          <datalist id="crm-zakres-podp">{CRM_ZAKRES_PODPOWIEDZI.map((p) => <option key={p} value={p} />)}</datalist>
        </label>
        <label className="crm-pf-field crm-pf-field--check">
          <input type="checkbox" checked={f.z_montazem} onChange={(e) => set('z_montazem', e.target.checked)} disabled={busy} />
          <span>Z montażem</span>
        </label>
        <label className="crm-pf-field crm-pf-field--check">
          <input type="checkbox" checked={f.lokal_mieszkalny === true} onChange={(e) => set('lokal_mieszkalny', e.target.checked)} disabled={busy} />
          <span>Obiekt mieszkalny</span>
        </label>
        <label className="crm-pf-field crm-pf-field--short">
          <span className="crm-pf-label">Rodzaj</span>
          <select value={f.rodzaj_lokalu} onChange={(e) => set('rodzaj_lokalu', e.target.value)} disabled={busy}>
            {Object.entries(CRM_RODZAJ_LOKALU).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="crm-pf-field crm-pf-field--short">
          <span className="crm-pf-label">Powierzchnia użytkowa (m²)</span>
          <input type="text" inputMode="decimal" value={f.powierzchnia_m2} onChange={(e) => set('powierzchnia_m2', e.target.value)} placeholder="np. 150" disabled={busy} />
          <span className="crm-pf-hint">Opcjonalnie: system ostrzeże w „Sprawdź tylko to”, gdy stawka z pliku nie pasuje do obiektu.</span>
        </label>
      </div>

      <div className="crm-poczta-actions">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void onSave()} disabled={busy}>
          {busy ? <Spinner inline size={14} /> : <FileText size={14} />} Zleć ofertę PDF
        </button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={onCancel} disabled={busy}><X size={14} /> Anuluj</button>
      </div>
    </section>
  )
}
