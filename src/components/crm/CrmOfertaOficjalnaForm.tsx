// =====================================================================
// „Oferta z montażem” (brief pkt 21): formularz na karcie klienta. Ceny NIE są liczone
// przez nas — AI przepisuje je z konfiguracji producenta (pliki z konfiguratora i/lub
// wklejony tekst); usługi własne bez stałych stawek; VAT 8%/23% liczy backend wg
// obiektu mieszkalnego i powierzchni. Zapis: upload plików do crm-dokumenty + rpc
// zlec_oferte_oficjalna (zlecOferteOficjalna) → po ~20–40 s oferta do_sprawdzenia.
// Brief pkt 29 (#160): kilka konfiguracji naraz (pliki + tekst razem), zrzut ekranu
// wklejany Ctrl+V jako PNG — wszystko trafia do jednej oferty.
// =====================================================================
import { useEffect, useRef, useState, type ClipboardEvent } from 'react'
import type { ToastVariant } from '../../types'
import { CRM_PRODUCENCI, CRM_RODZAJ_LOKALU, CRM_USLUGI_PODPOWIEDZI, CRM_ZAKRES_PODPOWIEDZI } from '../../types/crm'
import {
  zlecOferteOficjalna,
  KONFIGURACJA_MAX_PLIKOW,
  KONFIGURACJA_MAX_MB_RAZEM,
  type OfertaOficjalnaForm,
} from '../../hooks/useCrm'
import Spinner from '../Spinner'

type Props = {
  leadId: string
  klient: string
  pushToast: (message: string, variant: ToastVariant) => void
  /** id nowej oferty (status przelicz) */
  onCreated: (ofertaId: string | null) => void
  onCancel: () => void
}

// crm-oferta-pdf v9 czyta PDF, PNG, JPG, WEBP, GIF
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.gif,application/pdf,image/jpeg,image/png,image/webp,image/gif'
const ACCEPT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']

const empty = (): OfertaOficjalnaForm => ({
  konfiguracja_pliki: [],
  konfiguracja_tekst: '',
  producent: '',
  uslugi: [{ nazwa: 'Montaż', netto: 0 }],
  zakres: CRM_ZAKRES_PODPOWIEDZI[0],
  z_montazem: true,
  lokal_mieszkalny: true,
  rodzaj_lokalu: 'dom',
  powierzchnia_m2: '',
})

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

export default function CrmOfertaOficjalnaForm({ leadId, klient, pushToast, onCreated, onCancel }: Props) {
  const [f, setF] = useState<OfertaOficjalnaForm>(empty)
  const [busy, setBusy] = useState(false)
  // miniatury obrazków (object URL per plik); zwalniane przy usuwaniu i odmontowaniu
  const [thumbs, setThumbs] = useState<Map<File, string>>(new Map())
  const thumbsRef = useRef(thumbs)
  thumbsRef.current = thumbs
  const zrzutNr = useRef(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const set = <K extends keyof OfertaOficjalnaForm>(k: K, v: OfertaOficjalnaForm[K]) => setF((s) => ({ ...s, [k]: v }))

  useEffect(() => () => {
    thumbsRef.current.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  const addFiles = (files: File[]) => {
    if (files.length === 0) return
    const ok: File[] = []
    for (const file of files) {
      const typeOk = ACCEPT_TYPES.includes(file.type) || /\.(pdf|jpe?g|png|webp|gif)$/i.test(file.name)
      if (!typeOk) {
        pushToast(`„${file.name}” — ten rodzaj pliku nie jest obsługiwany (PDF, JPG, PNG, WEBP, GIF)`, 'error')
        continue
      }
      ok.push(file)
    }
    setF((s) => {
      const next = [...s.konfiguracja_pliki]
      for (const file of ok) {
        if (next.length >= KONFIGURACJA_MAX_PLIKOW) {
          pushToast(`Maksymalnie ${KONFIGURACJA_MAX_PLIKOW} plików w jednej ofercie`, 'error')
          break
        }
        const razem = next.reduce((a, x) => a + x.size, 0) + file.size
        if (razem > KONFIGURACJA_MAX_MB_RAZEM * 1024 * 1024) {
          pushToast(`Pliki razem przekroczyłyby ${KONFIGURACJA_MAX_MB_RAZEM} MB — „${file.name}” pominięty`, 'error')
          continue
        }
        next.push(file)
      }
      return { ...s, konfiguracja_pliki: next }
    })
    const obrazki = ok.filter((file) => file.type.startsWith('image/'))
    if (obrazki.length) {
      setThumbs((m) => {
        const n = new Map(m)
        for (const file of obrazki) n.set(file, URL.createObjectURL(file))
        return n
      })
    }
  }

  const removeFile = (file: File) => {
    setF((s) => ({ ...s, konfiguracja_pliki: s.konfiguracja_pliki.filter((x) => x !== file) }))
    setThumbs((m) => {
      const url = m.get(file)
      if (!url) return m
      URL.revokeObjectURL(url)
      const n = new Map(m)
      n.delete(file)
      return n
    })
  }

  // Ctrl+V: obrazek ze schowka (zrzut konfiguratora producenta) → plik zrzut-N.png.
  // Tekst wklejony do pola tekstowego zostaje tekstem (nie przechwytujemy go).
  const onPaste = (e: ClipboardEvent<HTMLElement>) => {
    if (busy) return
    const items = Array.from(e.clipboardData?.items ?? [])
    const images = items.filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
    if (images.length === 0) return
    e.preventDefault()
    const files: File[] = []
    for (const it of images) {
      const blob = it.getAsFile()
      if (!blob) continue
      zrzutNr.current += 1
      files.push(new File([blob], `zrzut-${zrzutNr.current}.png`, { type: blob.type || 'image/png' }))
    }
    addFiles(files)
    if (files.length) pushToast(files.length === 1 ? 'Dodano zrzut ekranu' : `Dodano ${files.length} zrzuty ekranu`, 'success')
  }

  const setUsluga = (i: number, patch: Partial<{ nazwa: string; netto: number }>) =>
    setF((s) => ({ ...s, uslugi: s.uslugi.map((u, j) => (j === i ? { ...u, ...patch } : u)) }))

  const onSave = async () => {
    if (f.konfiguracja_pliki.length === 0 && !f.konfiguracja_tekst.trim()) {
      pushToast('Dodaj plik lub zrzut z konfiguratora albo wklej treść konfiguracji', 'error')
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
  const rozmiarRazem = f.konfiguracja_pliki.reduce((a, x) => a + x.size, 0)

  return (
    <section className="crm-box crm-pf crm-ofic-form" onPaste={onPaste}>
      <div className="crm-screen-head">
        <div className="crm-screen-title">
          <h4>Oferta z montażem (PDF) · {klient}</h4>
          <div className="crm-screen-sub">Ceny i stawkę VAT przepisujemy z konfiguracji producenta, usługi wpisujesz sam. Dane o obiekcie są opcjonalne — służą do kontroli, czy stawka z pliku ma sens.</div>
        </div>
      </div>

      <h5>1. Konfiguracja producenta</h5>
      <div className="crm-pf-grid">
        <div className="crm-pf-field crm-pf-field--wide">
          <span className="crm-pf-label">Pliki z konfiguratora (PDF / JPG / PNG) — można kilka</span>
          <div className="crm-konf-dodaj">
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              multiple
              disabled={busy}
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []))
                e.target.value = '' // ten sam plik można wybrać ponownie po usunięciu
              }}
            />
            <span className="crm-muted">albo zrób zrzut ekranu konfiguratora i wklej go tutaj: <b>Ctrl+V</b></span>
          </div>
          {f.konfiguracja_pliki.length > 0 && (
            <ul className="crm-konf-pliki">
              {f.konfiguracja_pliki.map((file, i) => {
                const thumb = thumbs.get(file)
                return (
                  <li key={`${file.name}-${i}-${file.size}`} className="crm-konf-plik">
                    {thumb ? <img src={thumb} alt="" className="crm-konf-thumb" /> : <span className="crm-konf-ikona" aria-hidden="true">{file.type.startsWith('image/') ? 'IMG' : 'PDF'}</span>}
                    <span className="crm-konf-nazwa" title={file.name}>{file.name}</span>
                    <span className="crm-muted">{mb(file.size)} MB</span>
                    <button type="button" className="crm-link" disabled={busy} onClick={() => removeFile(file)} title="Usuń plik" aria-label={`Usuń ${file.name}`}>Usuń</button>
                  </li>
                )
              })}
            </ul>
          )}
          <span className="crm-pf-hint">
            Możesz dodać kilka konfiguracji (np. drzwi wejściowe i do garażu) — trafią do jednej oferty.
            {f.konfiguracja_pliki.length > 0 ? ` Plików: ${f.konfiguracja_pliki.length}/${KONFIGURACJA_MAX_PLIKOW}, razem ${mb(rozmiarRazem)} z ${KONFIGURACJA_MAX_MB_RAZEM} MB.` : ''}
          </span>
        </div>
        <label className="crm-pf-field">
          <span className="crm-pf-label">Producent (opcjonalnie)</span>
          <input type="text" list="crm-producenci" value={f.producent} onChange={(e) => set('producent', e.target.value)} placeholder="rozpozna system" disabled={busy} autoComplete="off" />
          <datalist id="crm-producenci">{CRM_PRODUCENCI.map((p) => <option key={p} value={p} />)}</datalist>
        </label>
        <label className="crm-pf-field crm-pf-field--wide">
          <span className="crm-pf-label">Treść konfiguracji (opcjonalnie, razem z plikami)</span>
          <textarea className="crm-fix-textarea" rows={5} value={f.konfiguracja_tekst} onChange={(e) => set('konfiguracja_tekst', e.target.value)} placeholder="Skopiuj z wydruku konfiguratora: pozycje, ilości, ceny. Tekst i pliki liczą się razem — tę samą konfigurację w dwóch postaciach system policzy raz." disabled={busy} />
        </label>
      </div>

      <h5>2. Usługi własne (netto, bez stałych stawek)</h5>
      <div className="crm-uslugi">
        {f.uslugi.map((u, i) => (
          <div key={i} className="crm-usluga-row">
            <input type="text" list="crm-uslugi-podp" value={u.nazwa} onChange={(e) => setUsluga(i, { nazwa: e.target.value })} placeholder="Nazwa usługi" disabled={busy} autoComplete="off" />
            <input type="number" min={0} step={1} value={u.netto || ''} onChange={(e) => setUsluga(i, { netto: Number(e.target.value) || 0 })} placeholder="netto zł" disabled={busy} />
            <button type="button" className="crm-link" disabled={busy} onClick={() => setF((s) => ({ ...s, uslugi: s.uslugi.filter((_, j) => j !== i) }))} title="Usuń usługę">Usuń</button>
          </div>
        ))}
        <datalist id="crm-uslugi-podp">{CRM_USLUGI_PODPOWIEDZI.map((p) => <option key={p} value={p} />)}</datalist>
        <div className="crm-poczta-actions">
          <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setF((s) => ({ ...s, uslugi: [...s.uslugi, { nazwa: '', netto: 0 }] }))}>Dodaj usługę</button>
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
          {busy ? <Spinner inline size={14} /> : null} Zleć ofertę PDF
        </button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={onCancel} disabled={busy}>Anuluj</button>
        {busy && f.konfiguracja_pliki.length > 1 && <span className="crm-muted">Wgrywam {f.konfiguracja_pliki.length} pliki…</span>}
      </div>
    </section>
  )
}
