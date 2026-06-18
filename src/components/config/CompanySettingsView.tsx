import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabaseClient'
import type { CompanySettings, ToastVariant } from '../../types'
import Spinner from '../Spinner'

type Props = {
  companySettings: CompanySettings | null
  loading: boolean
  isManager: boolean
  onSaved: () => void
  pushToast: (message: string, variant: ToastVariant) => void
}

type FormState = {
  company_name: string
  address_line1: string
  address_line2: string
  city: string
  postal_code: string
  country: string
  nip: string
  regon: string
  phone: string
  email: string
  bank_account: string
  notes: string
}

function mapToForm(settings: CompanySettings | null): FormState {
  return {
    company_name: settings?.company_name ?? '',
    address_line1: settings?.address_line1 ?? '',
    address_line2: settings?.address_line2 ?? '',
    city: settings?.city ?? '',
    postal_code: settings?.postal_code ?? '',
    country: settings?.country ?? 'Polska',
    nip: settings?.nip ?? '',
    regon: settings?.regon ?? '',
    phone: settings?.phone ?? '',
    email: settings?.email ?? '',
    bank_account: settings?.bank_account ?? '',
    notes: settings?.notes ?? '',
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function CompanySettingsView({
  companySettings,
  loading,
  isManager,
  onSaved,
  pushToast,
}: Props) {
  const [form, setForm] = useState<FormState>(() => mapToForm(companySettings))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setForm(mapToForm(companySettings))
  }, [companySettings])

  const nipError = useMemo(() => {
    const nip = form.nip.trim()
    if (!nip) return ''
    return /^\d{10}$/.test(nip) ? '' : 'NIP powinien mieć 10 cyfr.'
  }, [form.nip])
  const emailError = useMemo(() => {
    const email = form.email.trim()
    if (!email) return ''
    return EMAIL_REGEX.test(email) ? '' : 'Niepoprawny adres e-mail.'
  }, [form.email])

  const handleSave = async () => {
    if (!isManager) return
    if (!form.company_name.trim()) {
      pushToast('Nazwa firmy jest wymagana.', 'error')
      return
    }
    if (nipError) {
      pushToast(nipError, 'error')
      return
    }
    if (emailError) {
      pushToast(emailError, 'error')
      return
    }
    setSaving(true)
    const { error } = await supabase
      .from('company_settings')
      .update({
        company_name: form.company_name.trim(),
        address_line1: form.address_line1.trim() || null,
        address_line2: form.address_line2.trim() || null,
        city: form.city.trim() || null,
        postal_code: form.postal_code.trim() || null,
        country: form.country.trim() || null,
        nip: form.nip.trim() || null,
        regon: form.regon.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        bank_account: form.bank_account.trim() || null,
        notes: form.notes.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)
    setSaving(false)
    if (error) {
      pushToast(`Błąd zapisu danych firmy: ${error.message}`, 'error')
      return
    }
    pushToast('Dane firmy zapisane', 'success')
    onSaved()
  }

  if (loading) return <Spinner center label="Ładowanie danych firmy…" />
  if (!companySettings) return <p className="no-results">Brak danych firmy do edycji.</p>

  return (
    <div className="config-main">
      <div className="config-main-header">
        <h2 className="config-main-title">Dane firmy</h2>
      </div>
      <div className="order-form-grid order-form-grid--sta">
        <label className="order-field-full">
          <span className="order-field-label-text">Nazwa firmy *</span>
          <input
            type="text"
            value={form.company_name}
            onChange={(e) => setForm((p) => ({ ...p, company_name: e.target.value }))}
            disabled={!isManager || saving}
          />
        </label>
        <label>
          <span className="order-field-label-text">Adres linia 1</span>
          <input
            type="text"
            value={form.address_line1}
            onChange={(e) => setForm((p) => ({ ...p, address_line1: e.target.value }))}
            disabled={!isManager || saving}
          />
        </label>
        <label>
          <span className="order-field-label-text">Adres linia 2</span>
          <input
            type="text"
            value={form.address_line2}
            onChange={(e) => setForm((p) => ({ ...p, address_line2: e.target.value }))}
            disabled={!isManager || saving}
          />
        </label>
        <label>
          <span className="order-field-label-text">Kod pocztowy</span>
          <input
            type="text"
            value={form.postal_code}
            onChange={(e) => setForm((p) => ({ ...p, postal_code: e.target.value }))}
            disabled={!isManager || saving}
          />
        </label>
        <label>
          <span className="order-field-label-text">Miejscowość</span>
          <input
            type="text"
            value={form.city}
            onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))}
            disabled={!isManager || saving}
          />
        </label>
        <label>
          <span className="order-field-label-text">Kraj</span>
          <input
            type="text"
            value={form.country}
            onChange={(e) => setForm((p) => ({ ...p, country: e.target.value }))}
            disabled={!isManager || saving}
          />
        </label>
        <label>
          <span className="order-field-label-text">NIP</span>
          <input
            type="text"
            value={form.nip}
            onChange={(e) => setForm((p) => ({ ...p, nip: e.target.value }))}
            disabled={!isManager || saving}
          />
          {nipError && <small style={{ color: '#b91c1c' }}>{nipError}</small>}
        </label>
        <label>
          <span className="order-field-label-text">REGON</span>
          <input
            type="text"
            value={form.regon}
            onChange={(e) => setForm((p) => ({ ...p, regon: e.target.value }))}
            disabled={!isManager || saving}
          />
        </label>
        <label>
          <span className="order-field-label-text">Telefon</span>
          <input
            type="text"
            value={form.phone}
            onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
            disabled={!isManager || saving}
          />
        </label>
        <label>
          <span className="order-field-label-text">Email</span>
          <input
            type="text"
            value={form.email}
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            disabled={!isManager || saving}
          />
          {emailError && <small style={{ color: '#b91c1c' }}>{emailError}</small>}
        </label>
        <label className="order-field-full">
          <span className="order-field-label-text">Numer konta bankowego</span>
          <input
            type="text"
            value={form.bank_account}
            onChange={(e) => setForm((p) => ({ ...p, bank_account: e.target.value }))}
            disabled={!isManager || saving}
          />
        </label>
        <label className="order-field-full">
          <span className="order-field-label-text">Notatki</span>
          <textarea
            rows={3}
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            disabled={!isManager || saving}
          />
        </label>
      </div>
      {isManager && (
        <div className="order-form-actions">
          <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      )}
    </div>
  )
}
