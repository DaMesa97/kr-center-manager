// =====================================================================
// Firma klienta w CRM (27.11.2026): NIP + „Pobierz z GUS” i pola firmy
// (nazwa, ulica, kod, miasto; REGON / KRS / status VAT z rejestru).
// Używane w „Dodaj klienta” i „Edytuj dane klienta”; pola wstawiane do
// istniejącej siatki .crm-pf-grid (fragment).
// =====================================================================
import { useState } from 'react'
import { firmaZRejestru, pobierzFirmeNip, type CrmFirmaPola, type CrmFirmaRejestr } from '../../hooks/useCrm'
import { ZRODLO_FIRMY, nipPoprawny, normalizujNip } from '../../lib/nip'
import Spinner from '../Spinner'

type Props = {
  value: CrmFirmaPola
  onChange: (f: CrmFirmaPola) => void
  disabled?: boolean
  /** po pobraniu z rejestru (np. podpowiedź nazwy klienta i miejscowości, gdy puste) */
  onPobrano?: (r: CrmFirmaRejestr) => void
  pushToast: (msg: string, variant: 'success' | 'error' | 'info') => void
}

export default function CrmFirmaPolaForm({ value, onChange, disabled, onPobrano, pushToast }: Props) {
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<CrmFirmaPola>) => onChange({ ...value, ...patch, ...(patch.firma_zrodlo === undefined && ('firma_nazwa' in patch || 'firma_ulica' in patch || 'firma_kod' in patch || 'firma_miasto' in patch) ? { firma_zrodlo: 'reczne' } : {}) })
  const nipOk = nipPoprawny(value.nip)
  const nipZly = value.nip.trim() !== '' && normalizujNip(value.nip).length >= 10 && !nipOk

  const pobierz = async () => {
    setBusy(true)
    const { firma, error } = await pobierzFirmeNip(value.nip)
    setBusy(false)
    if (!firma) {
      pushToast(error ?? 'Nie znaleziono firmy', 'error')
      return
    }
    onChange(firmaZRejestru(firma))
    onPobrano?.(firma)
    pushToast(`Pobrano: ${firma.nazwa} (${ZRODLO_FIRMY[firma.zrodlo]})`, 'success')
  }

  return (
    <>
      <label className="crm-pf-field">
        <span className="crm-pf-label">NIP firmy <span className="crm-muted">(jeśli klient to firma)</span></span>
        <span className="crm-nip-row">
          <input
            type="text"
            inputMode="numeric"
            value={value.nip}
            onChange={(e) => onChange({ ...value, nip: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter' && nipOk) { e.preventDefault(); void pobierz() } }}
            placeholder="np. 647-000-00-00"
            autoComplete="off"
            disabled={disabled || busy}
            aria-invalid={nipZly || undefined}
          />
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => void pobierz()} disabled={disabled || busy || !nipOk} title={nipOk ? 'Pobierz nazwę i adres firmy z rejestru' : 'Wpisz poprawny NIP (10 cyfr)'}>
            {busy ? <Spinner inline size={14} /> : null} Pobierz z GUS
          </button>
        </span>
        {nipZly && <span className="crm-pf-hint" style={{ color: '#b3261e' }}>NIP ma złą sumę kontrolną — sprawdź cyfry.</span>}
        {value.firma_zrodlo && value.firma_zrodlo !== 'reczne' && (
          <span className="crm-pf-hint">
            {[value.regon && `REGON ${value.regon}`, value.krs && `KRS ${value.krs}`, value.vat_status && `VAT: ${value.vat_status}`].filter(Boolean).join(' · ')}
            {' · '}źródło: {ZRODLO_FIRMY[value.firma_zrodlo] ?? value.firma_zrodlo}
            {value.firma_sprawdzono_at ? `, ${new Date(value.firma_sprawdzono_at).toLocaleDateString('pl-PL')}` : ''}
          </span>
        )}
      </label>
      <label className="crm-pf-field">
        <span className="crm-pf-label">Nazwa firmy</span>
        <input type="text" value={value.firma_nazwa} onChange={(e) => set({ firma_nazwa: e.target.value })} disabled={disabled || busy} autoComplete="off" />
      </label>
      <label className="crm-pf-field">
        <span className="crm-pf-label">Adres firmy — ulica i numer</span>
        <input type="text" value={value.firma_ulica} onChange={(e) => set({ firma_ulica: e.target.value })} disabled={disabled || busy} autoComplete="off" />
      </label>
      <label className="crm-pf-field crm-pf-field--short">
        <span className="crm-pf-label">Kod pocztowy</span>
        <input type="text" value={value.firma_kod} onChange={(e) => set({ firma_kod: e.target.value })} disabled={disabled || busy} autoComplete="off" placeholder="44-200" />
      </label>
      <label className="crm-pf-field crm-pf-field--short">
        <span className="crm-pf-label">Miejscowość firmy</span>
        <input type="text" value={value.firma_miasto} onChange={(e) => set({ firma_miasto: e.target.value })} disabled={disabled || busy} autoComplete="off" />
      </label>
    </>
  )
}
