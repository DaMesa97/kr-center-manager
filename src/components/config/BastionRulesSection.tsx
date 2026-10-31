import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import type { ToastVariant } from '../../types'

type Rule = {
  id: number
  priority: number
  name: string
  is_active: boolean
  when_system: string[] | null
  when_frame_prefix: string | null
  when_frame: string[] | null
  when_width: string[] | null
  when_target_not_in: string[] | null
  target: string
  mode: string
  value: string
}

const TARGET_LABEL: Record<string, string> = {
  system: 'System',
  width: 'Szerokość',
  height: 'Wysokość',
  peephole: 'Wizjer',
  notes: 'Uwagi',
  hardware: 'Okucia',
  threshold_color: 'Kolor progu',
}
const MODE_LABEL: Record<string, string> = {
  set: 'ustaw',
  set_if_empty: 'ustaw, gdy puste',
  append: 'dopisz na końcu',
  prepend: 'dopisz na początku',
}

type Props = {
  isManager: boolean
  pushToast: (message: string, variant: ToastVariant) => void
}

/**
 * Konfiguracja → Reguły Bastion: reguły domyślne przeniesione z makra Excela,
 * stosowane w bazie przy każdym nowym zleceniu Bastion (bot, formularz, Excel).
 * Tu tylko podgląd i włącz/wyłącz — treść reguł zmienia się w bazie (bastion_rules).
 */
export default function BastionRulesSection({ isManager, pushToast }: Props) {
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('bastion_rules').select('*').order('priority').order('id')
    setLoading(false)
    if (error) {
      pushToast(`Błąd pobierania reguł: ${error.message}`, 'error')
      return
    }
    setRules((data ?? []) as Rule[])
  }, [pushToast])

  useEffect(() => {
    void reload()
  }, [reload])

  const toggle = async (r: Rule) => {
    setBusyId(r.id)
    const { error } = await supabase.rpc('bastion_rule_set_active', { p_rule_id: r.id, p_active: !r.is_active })
    setBusyId(null)
    if (error) {
      pushToast(`Nie zmieniono reguły: ${error.message}`, 'error')
      return
    }
    setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, is_active: !r.is_active } : x)))
  }

  const cond = (r: Rule): string => {
    const parts: string[] = []
    if (r.when_system?.length) parts.push(`system: ${r.when_system.join(' / ')}`)
    if (r.when_frame_prefix) parts.push(`ościeżnica zaczyna się od „${r.when_frame_prefix}"`)
    if (r.when_frame?.length) parts.push(`ościeżnica: ${r.when_frame.join(' / ')}`)
    if (r.when_width?.length) parts.push(`szerokość: ${r.when_width.join(' / ')}`)
    if (r.when_target_not_in?.length) parts.push(`${TARGET_LABEL[r.target] ?? r.target} nie jest: ${r.when_target_not_in.map((v) => v || '(puste)').join(' / ')}`)
    return parts.length ? parts.join(' · ') : 'zawsze'
  }

  return (
    <div className="exclusions-section">
      <h3 className="exclusions-title">Reguły domyślne Bastion</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Przeniesione z makra Excela. Baza stosuje je po kolei przy każdym nowym zleceniu Bastion, niezależnie od źródła
        (konfigurator, formularz, Excel). Wyłączona reguła nie działa dla nowych zleceń; istniejących nie cofa.
      </p>
      {loading && rules.length === 0 ? (
        <p className="muted">Wczytywanie…</p>
      ) : (
        <div className="table-wrapper">
          <table className="orders-table dt-table">
            <thead>
              <tr>
                <th>#</th>
                <th>REGUŁA</th>
                <th>KIEDY</th>
                <th>POLE</th>
                <th>TRYB</th>
                <th>WARTOŚĆ</th>
                <th>AKTYWNA</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} style={r.is_active ? undefined : { opacity: 0.55 }}>
                  <td>{r.priority}</td>
                  <td>{r.name}</td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 420 }}>{cond(r)}</td>
                  <td>{TARGET_LABEL[r.target] ?? r.target}</td>
                  <td>{MODE_LABEL[r.mode] ?? r.mode}</td>
                  <td><strong>{r.value}</strong></td>
                  <td>
                    <input
                      type="checkbox"
                      checked={r.is_active}
                      disabled={!isManager || busyId === r.id}
                      onChange={() => void toggle(r)}
                      title={isManager ? 'Włącz / wyłącz regułę' : 'Tylko kierownik'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
