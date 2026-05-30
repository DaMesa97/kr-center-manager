import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../supabaseClient'
import type { Supplier, ToastVariant } from '../../types'

type Props = {
  open: boolean
  mode: 'add' | 'edit'
  initialSupplier?: Supplier | null
  onClose: () => void
  onSaved: () => void
  pushToast: (message: string, variant: ToastVariant) => void
}

type FormState = {
  name: string
  email: string
  phone: string
  contact_person: string
  lead_time_days: number
  requires_full_tir: boolean
  notes: string
  is_active: boolean
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function mapSupplierToForm(supplier: Supplier | null | undefined): FormState {
  return {
    name: supplier?.name ?? '',
    email: supplier?.email ?? '',
    phone: supplier?.phone ?? '',
    contact_person: supplier?.contact_person ?? '',
    lead_time_days: supplier?.lead_time_days ?? 42,
    requires_full_tir: supplier?.requires_full_tir ?? false,
    notes: supplier?.notes ?? '',
    is_active: supplier?.is_active ?? true,
  }
}

export default function SupplierFormModal({
  open,
  mode,
  initialSupplier,
  onClose,
  onSaved,
  pushToast,
}: Props) {
  const [form, setForm] = useState<FormState>(() => mapSupplierToForm(initialSupplier))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm(mapSupplierToForm(initialSupplier))
    }
  }, [open, initialSupplier, mode])

  const weeks = useMemo(() => Math.round((Number(form.lead_time_days) || 0) / 7), [form.lead_time_days])

  const validate = (): string | null => {
    const name = form.name.trim()
    if (name.length < 2 || name.length > 100) return 'Nazwa musi mieć od 2 do 100 znaków.'
    if (form.email.trim() && !EMAIL_REGEX.test(form.email.trim())) return 'Podaj poprawny adres e-mail.'
    if (!Number.isFinite(Number(form.lead_time_days))) return 'Czas realizacji jest wymagany.'
    const lead = Number(form.lead_time_days)
    if (lead < 1 || lead > 365) return 'Czas realizacji musi być w zakresie 1-365 dni.'
    return null
  }

  const handleSave = async () => {
    const validationError = validate()
    if (validationError) {
      pushToast(validationError, 'error')
      return
    }
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      contact_person: form.contact_person.trim() || null,
      lead_time_days: Number(form.lead_time_days),
      requires_full_tir: form.requires_full_tir,
      notes: form.notes.trim() || null,
      is_active: mode === 'add' ? true : form.is_active,
      updated_at: new Date().toISOString(),
    }

    let error: { message: string; code?: string } | null = null
    if (mode === 'add') {
      const res = await supabase.from('suppliers').insert(payload)
      error = res.error
    } else {
      const res = await supabase.from('suppliers').update(payload).eq('id', initialSupplier?.id ?? -1)
      error = res.error
    }
    setSaving(false)

    if (error) {
      if (error.code === '23505' || /duplicate|unique/i.test(error.message)) {
        pushToast('Dostawca o tej nazwie już istnieje', 'error')
        return
      }
      pushToast(`Błąd: ${error.message}`, 'error')
      return
    }
    pushToast('Dostawca zapisany', 'success')
    onSaved()
    onClose()
  }

  if (!open) return null

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => !saving && onClose()}>
      <div className="order-modal order-modal--sta" onClick={(e) => e.stopPropagation()}>
        <div className="order-modal-header">
          <h2>{mode === 'add' ? 'Dodaj dostawcę' : 'Edytuj dostawcę'}</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={saving}>
            X
          </button>
        </div>
        <div className="order-form-grid order-form-grid--sta">
          <label className="order-field-full">
            <span className="order-field-label-text">Nazwa *</span>
            <input
              type="text"
              value={form.name}
              maxLength={100}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              disabled={saving}
            />
          </label>
          <label>
            <span className="order-field-label-text">Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              disabled={saving}
            />
          </label>
          <label>
            <span className="order-field-label-text">Telefon</span>
            <input
              type="text"
              value={form.phone}
              onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
              disabled={saving}
            />
          </label>
          <label>
            <span className="order-field-label-text">Osoba kontaktowa</span>
            <input
              type="text"
              value={form.contact_person}
              onChange={(e) => setForm((p) => ({ ...p, contact_person: e.target.value }))}
              disabled={saving}
            />
          </label>
          <label>
            <span className="order-field-label-text">Czas realizacji (dni) *</span>
            <input
              type="number"
              min={1}
              max={365}
              value={form.lead_time_days}
              onChange={(e) => setForm((p) => ({ ...p, lead_time_days: Number(e.target.value) || 0 }))}
              disabled={saving}
            />
            <small style={{ color: '#6b7280' }}>≈ {weeks} tygodni</small>
          </label>
          <label className="order-field-full">
            <span className="order-field-label-text">
              <input
                type="checkbox"
                checked={form.requires_full_tir}
                onChange={(e) => setForm((p) => ({ ...p, requires_full_tir: e.target.checked }))}
                disabled={saving}
                style={{ marginRight: 8 }}
              />
              Wymaga pełnego TIRa
            </span>
          </label>
          <label className="order-field-full">
            <span className="order-field-label-text">Notatki</span>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              disabled={saving}
            />
          </label>
          {mode === 'edit' && (
            <label className="order-field-full">
              <span className="order-field-label-text">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
                  disabled={saving}
                  style={{ marginRight: 8 }}
                />
                Aktywny
              </span>
            </label>
          )}
        </div>
        <div className="order-form-actions">
          <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
