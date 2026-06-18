import { useState } from 'react'
import type { LeadTimeRule, ToastVariant } from '../../types'

const CATEGORIES = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne']

type RuleFormState = {
  id?: number
  name: string
  match_category: string       // '' = NULL (wszystkie)
  match_has_glass_extra: string // '' = NULL, 'true', 'false'
  match_bastion_frame_type: string
  warning_days: number
  overdue_days: number
  priority: number
  is_active: boolean
}

const EMPTY_FORM: RuleFormState = {
  name: '',
  match_category: '',
  match_has_glass_extra: '',
  match_bastion_frame_type: '',
  warning_days: 7,
  overdue_days: 14,
  priority: 0,
  is_active: true,
}

type Props = {
  rules: LeadTimeRule[]
  onSave: (payload: Omit<LeadTimeRule, 'id'> & { id?: number }) => Promise<void>
  onDelete: (id: number) => Promise<void>
  onToggleActive: (id: number, isActive: boolean) => Promise<void>
  onRefresh: () => Promise<void>
  pushToast: (message: string, variant: ToastVariant) => void
}

function ruleToForm(rule: LeadTimeRule): RuleFormState {
  return {
    id: rule.id,
    name: rule.name,
    match_category: rule.match_category ?? '',
    match_has_glass_extra:
      rule.match_has_glass_extra === null
        ? ''
        : rule.match_has_glass_extra
          ? 'true'
          : 'false',
    match_bastion_frame_type: rule.match_bastion_frame_type ?? '',
    warning_days: rule.warning_days,
    overdue_days: rule.overdue_days,
    priority: rule.priority,
    is_active: rule.is_active,
  }
}

function formToPayload(form: RuleFormState): Omit<LeadTimeRule, 'id'> & { id?: number } {
  return {
    id: form.id,
    name: form.name.trim(),
    match_category: form.match_category || null,
    match_has_glass_extra:
      form.match_has_glass_extra === ''
        ? null
        : form.match_has_glass_extra === 'true',
    match_bastion_frame_type: form.match_bastion_frame_type.trim() || null,
    warning_days: form.warning_days,
    overdue_days: form.overdue_days,
    priority: form.priority,
    is_active: form.is_active,
  }
}

export default function LeadTimeRulesView({ rules, onSave, onDelete, onToggleActive, onRefresh, pushToast }: Props) {
  const [form, setForm] = useState<RuleFormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    try { await onRefresh() } finally { setRefreshing(false) }
  }

  const openAdd = () => setForm({ ...EMPTY_FORM })
  const openEdit = (rule: LeadTimeRule) => setForm(ruleToForm(rule))
  const closeForm = () => setForm(null)

  const patch = (patch: Partial<RuleFormState>) =>
    setForm((prev) => (prev ? { ...prev, ...patch } : prev))

  const handleSave = async () => {
    if (!form) return
    if (!form.name.trim()) {
      pushToast('Podaj nazwę reguły', 'error')
      return
    }
    if (!Number.isFinite(form.warning_days) || !Number.isFinite(form.overdue_days) || form.warning_days <= 0 || form.overdue_days <= 0) {
      pushToast('Dni muszą być liczbami większymi od 0', 'error')
      return
    }
    if (form.warning_days >= form.overdue_days) {
      pushToast('Dni ostrzeżenia muszą być mniejsze niż dni przeterminowania', 'error')
      return
    }
    setSaving(true)
    try {
      await onSave(formToPayload(form))
      closeForm()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Usunąć regułę "${name}"?`)) return
    setDeletingId(id)
    try {
      await onDelete(id)
    } finally {
      setDeletingId(null)
    }
  }

  const glassExtraLabel = (v: boolean | null) => {
    if (v === null) return '—'
    return v ? 'TAK (ma naświetle/dostawkę)' : 'NIE (bez naświetla/dostawki)'
  }

  return (
    <div className="lead-time-rules-view">
      <div className="lead-time-rules-header">
        <div>
          <h3 className="lead-time-rules-title">Reguły terminów realizacji</h3>
          <p className="lead-time-rules-desc">
            Określ ile dni może minąć od złożenia zamówienia zanim pojawi się ostrzeżenie (żółty kolor)
            lub alert przeterminowania (czerwony kolor). Reguły są sprawdzane malejąco według priorytetu.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            title="Odśwież listę reguł z bazy"
          >
            {refreshing ? 'Ładowanie…' : '↻ Odśwież'}
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={openAdd}>
            + Dodaj regułę
          </button>
        </div>
      </div>

      {/* Formularz */}
      {form && (
        <div className="lead-time-rule-form">
          <h4 className="lead-time-rule-form-title">
            {form.id ? 'Edytuj regułę' : 'Nowa reguła'}
          </h4>
          <div className="lead-time-rule-form-grid">
            {/* Nazwa */}
            <label className="lead-time-rule-form-field lead-time-rule-form-field--wide">
              <span>Nazwa reguły</span>
              <input
                type="text"
                className="search-input"
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="np. STA z naświetlem"
              />
            </label>

            {/* Kategoria */}
            <label className="lead-time-rule-form-field">
              <span>Kategoria</span>
              <select
                className="day-filter"
                value={form.match_category}
                onChange={(e) => patch({ match_category: e.target.value })}
              >
                <option value="">Wszystkie kategorie</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>

            {/* Naświetle/dostawka */}
            <label className="lead-time-rule-form-field">
              <span>Naświetle / dostawka</span>
              <select
                className="day-filter"
                value={form.match_has_glass_extra}
                onChange={(e) => patch({ match_has_glass_extra: e.target.value })}
              >
                <option value="">Nieistotne</option>
                <option value="true">Ma naświetle lub dostawkę</option>
                <option value="false">Bez naświetla i dostawki</option>
              </select>
            </label>

            {/* Typ ościeżnicy (Bastion) */}
            <label className="lead-time-rule-form-field">
              <span>Typ ościeżnicy (fragment)</span>
              <input
                type="text"
                className="search-input"
                value={form.match_bastion_frame_type}
                onChange={(e) => patch({ match_bastion_frame_type: e.target.value })}
                placeholder="np. regulowan, opaskow"
              />
            </label>

            {/* Warning days */}
            <label className="lead-time-rule-form-field">
              <span>Ostrzeżenie po (dni) 🟡</span>
              <input
                type="number"
                className="search-input"
                min={1}
                value={form.warning_days}
                onChange={(e) => patch({ warning_days: parseInt(e.target.value) || 1 })}
              />
            </label>

            {/* Overdue days */}
            <label className="lead-time-rule-form-field">
              <span>Przeterminowane po (dni) 🔴</span>
              <input
                type="number"
                className="search-input"
                min={1}
                value={form.overdue_days}
                onChange={(e) => patch({ overdue_days: parseInt(e.target.value) || 1 })}
              />
            </label>

            {/* Priority */}
            <label className="lead-time-rule-form-field">
              <span>Priorytet (wyższy = ważniejszy)</span>
              <input
                type="number"
                className="search-input"
                value={form.priority}
                onChange={(e) => patch({ priority: parseInt(e.target.value) || 0 })}
              />
            </label>

            {/* Aktywna */}
            <label className="lead-time-rule-form-field" style={{ justifyContent: 'center' }}>
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => patch({ is_active: e.target.checked })}
              />
              <span>Aktywna</span>
            </label>
          </div>

          <div className="lead-time-rule-form-actions">
            <button
              type="button"
              className="btn btn-success btn-sm"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? 'Zapisywanie…' : 'Zapisz'}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={closeForm} disabled={saving}>
              Anuluj
            </button>
          </div>
        </div>
      )}

      {/* Tabela reguł */}
      <div className="table-wrapper">
        <table className="orders-table" style={{ fontSize: '0.8125rem' }}>
          <thead>
            <tr>
              <th>Nazwa</th>
              <th>Kategoria</th>
              <th>Naświetle/dostawka</th>
              <th>Typ ościeżnicy</th>
              <th style={{ textAlign: 'center' }}>Ostrzeżenie<br />(dni) 🟡</th>
              <th style={{ textAlign: 'center' }}>Przeter.<br />(dni) 🔴</th>
              <th style={{ textAlign: 'center' }}>Priorytet</th>
              <th style={{ textAlign: 'center' }}>Aktywna</th>
              <th>Akcje</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: '2rem' }}>
                  <div style={{ textAlign: 'center', color: '#6b7280', lineHeight: 1.7 }}>
                    <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Brak reguł w bazie danych</div>
                    <div style={{ fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                      Uruchom migrację SQL w Supabase (SQL Editor), aby dodać domyślne reguły.<br />
                      Do tego czasu obowiązuje fallback: <strong>ostrzeżenie po 7 dniach</strong>, <strong>przeterminowane po 14 dniach</strong> od złożenia zamówienia.
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      Możesz też dodać reguły ręcznie przyciskiem „+ Dodaj regułę" powyżej.
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              rules.map((rule) => (
                <tr key={rule.id} style={{ opacity: rule.is_active ? 1 : 0.5 }}>
                  <td>{rule.name}</td>
                  <td>{rule.match_category ?? <span style={{ color: '#9ca3af' }}>Wszystkie</span>}</td>
                  <td style={{ fontSize: '0.75rem' }}>{glassExtraLabel(rule.match_has_glass_extra)}</td>
                  <td>
                    {rule.match_bastion_frame_type ? (
                      <code style={{ fontSize: '0.75rem', background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>
                        *{rule.match_bastion_frame_type}*
                      </code>
                    ) : (
                      <span style={{ color: '#9ca3af' }}>—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span className="lead-time-badge lead-time-badge--warning">{rule.warning_days}d</span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span className="lead-time-badge lead-time-badge--overdue">{rule.overdue_days}d</span>
                  </td>
                  <td style={{ textAlign: 'center' }}>{rule.priority}</td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={rule.is_active}
                      onChange={(e) => void onToggleActive(rule.id, e.target.checked)}
                      title={rule.is_active ? 'Kliknij by dezaktywować' : 'Kliknij by aktywować'}
                    />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => openEdit(rule)}
                      >
                        Edytuj
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => void handleDelete(rule.id, rule.name)}
                        disabled={deletingId === rule.id}
                      >
                        Usuń
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
