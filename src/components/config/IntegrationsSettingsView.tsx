import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import type { ToastVariant } from '../../types'
import Spinner from '../Spinner'

type Props = {
  pushToast: (message: string, variant: ToastVariant) => void
}

type SettingRow = { key: string; value: string; description: string; updated_at: string }

const LABELS: Record<string, { title: string; hint: string; placeholder: string }> = {
  erp_retry_webhook_url: {
    title: 'Webhook Make — „Ponów wysyłkę do Optimy"',
    hint:
      'Adres webhooka scenariusza Make, który zakłada RO jeszcze raz na podstawie rekordu Airtable. Aplikacja wysyła POST JSON: ' +
      'action, airtable_id, order_id, order_number, category, company, previous_error, requested_by, requested_at. ' +
      'Pusty adres = przycisk „Ponów wysyłkę" zgłasza brak konfiguracji.',
    placeholder: 'https://hook.eu2.make.com/…',
  },
}

/**
 * Ustawienia → Integracje → Make / Optima (tylko admin, RLS na integration_settings).
 * Na start jeden klucz: adres webhooka ponawiania RO w Optimie. Edge function
 * erp-retry czyta go service_role — adres nie trafia do klienta ani do repo.
 */
export default function IntegrationsSettingsView({ pushToast }: Props) {
  const [rows, setRows] = useState<SettingRow[]>([])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('integration_settings').select('*').order('key')
    setLoading(false)
    if (error) {
      pushToast(`Nie wczytano ustawień integracji: ${error.message}`, 'error')
      return
    }
    const list = (data ?? []) as SettingRow[]
    setRows(list)
    setDraft(Object.fromEntries(list.map((r) => [r.key, r.value ?? ''])))
  }, [pushToast])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (key: string) => {
    const value = (draft[key] ?? '').trim()
    if (value && !/^https:\/\//i.test(value)) {
      pushToast('Adres webhooka musi zaczynać się od https://', 'error')
      return
    }
    setSavingKey(key)
    const { data: userData } = await supabase.auth.getUser()
    const { error } = await supabase
      .from('integration_settings')
      .update({ value, updated_at: new Date().toISOString(), updated_by: userData?.user?.id ?? null })
      .eq('key', key)
    setSavingKey(null)
    if (error) {
      pushToast(`Nie zapisano: ${error.message}`, 'error')
      return
    }
    pushToast(value ? 'Zapisano adres webhooka' : 'Adres usunięty — przycisk „Ponów wysyłkę" będzie zgłaszał brak konfiguracji', 'success')
    await load()
  }

  return (
    <div className="config-main">
      <div className="config-main-header">
        <h2 className="config-main-title">Integracje</h2>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Adresy webhooków Make używane przez aplikację. Widzi i zmienia je tylko administrator; funkcje brzegowe czytają je po
        stronie serwera, więc nie trafiają do programu na stanowiskach.
      </p>
      {loading ? (
        <Spinner center label="Wczytywanie ustawień integracji…" />
      ) : rows.length === 0 ? (
        <p className="no-results">Brak ustawień integracji w bazie (migracja erp_retry_integracje.sql).</p>
      ) : (
        <div className="order-form-grid order-form-grid--sta">
          {rows.map((r) => {
            const meta = LABELS[r.key] ?? { title: r.key, hint: r.description, placeholder: '' }
            const dirty = (draft[r.key] ?? '') !== (r.value ?? '')
            return (
              <label key={r.key} className="order-field-full">
                <span className="order-field-label-text">{meta.title}</span>
                <input
                  type="url"
                  value={draft[r.key] ?? ''}
                  placeholder={meta.placeholder}
                  onChange={(e) => setDraft((p) => ({ ...p, [r.key]: e.target.value }))}
                  disabled={savingKey === r.key}
                  autoComplete="off"
                  spellCheck={false}
                />
                <span className="user-modal-hint">{meta.hint}</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={!dirty || savingKey === r.key}
                    onClick={() => void save(r.key)}
                  >
                    {savingKey === r.key ? 'Zapisywanie…' : 'Zapisz'}
                  </button>
                  <span className="muted" style={{ fontSize: '0.8rem' }}>
                    {r.value ? `Ustawiony · ostatnia zmiana ${new Date(r.updated_at).toLocaleString('pl-PL')}` : 'Nie ustawiony'}
                  </span>
                </div>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
