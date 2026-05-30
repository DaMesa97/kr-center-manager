import { useCallback, useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import { supabase } from '../../supabaseClient'

type SeasonalFactor = {
  id: number
  month: number
  factor: number
  note: string | null
}

type Props = {
  isManager: boolean
  onSaved?: () => void
}

const MONTH_NAMES = [
  'Styczeń',
  'Luty',
  'Marzec',
  'Kwiecień',
  'Maj',
  'Czerwiec',
  'Lipiec',
  'Sierpień',
  'Wrzesień',
  'Październik',
  'Listopad',
  'Grudzień',
]

function SeasonalFactorsEditor({ isManager, onSaved }: Props) {
  const [factors, setFactors] = useState<SeasonalFactor[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)

  const fetchFactors = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('seasonal_factors').select('*').order('month')
    setLoading(false)
    if (error) {
      console.error(error)
      return
    }
    setFactors((data ?? []) as SeasonalFactor[])
  }, [])

  useEffect(() => {
    if (expanded) void fetchFactors()
  }, [expanded, fetchFactors])

  const handleUpdate = async (month: number, factor: number, note: string | null) => {
    setSaving(month)
    const { error } = await supabase.from('seasonal_factors').update({ factor, note }).eq('month', month)
    setSaving(null)

    if (error) {
      alert(`Błąd: ${error.message}`)
      return
    }

    await fetchFactors()
    onSaved?.()
  }

  if (!expanded) {
    return (
      <div className="seasonal-factors-collapsed" style={{ position: 'relative', zIndex: 1 }}>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setExpanded(true)}>
          <Settings size={14} strokeWidth={2} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          Mnożniki sezonowe
        </button>
      </div>
    )
  }

  return (
    <div className="seasonal-factors-editor" style={{ position: 'relative', zIndex: 1 }}>
      <div className="seasonal-factors-header">
        <h4>Mnożniki sezonowe</h4>
        <button type="button" className="btn btn-icon btn-ghost" onClick={() => setExpanded(false)}>
          ×
        </button>
      </div>

      <p className="seasonal-factors-hint">
        Mnożniki wpływają na prognozę. Wartość 1.0 = brak zmian, 0.7 = -30%, 1.2 = +20%.
      </p>

      {loading ? (
        <div>Ładowanie...</div>
      ) : (
        <table className="seasonal-factors-table">
          <thead>
            <tr>
              <th>Miesiąc</th>
              <th>Mnożnik</th>
              <th>Notatka</th>
              {isManager && <th></th>}
            </tr>
          </thead>
          <tbody>
            {factors.map((f) => (
              <SeasonalFactorRow
                key={f.month}
                factor={f}
                isManager={isManager}
                saving={saving === f.month}
                onUpdate={handleUpdate}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function SeasonalFactorRow({
  factor,
  isManager,
  saving,
  onUpdate,
}: {
  factor: SeasonalFactor
  isManager: boolean
  saving: boolean
  onUpdate: (month: number, factor: number, note: string | null) => Promise<void>
}) {
  const [localFactor, setLocalFactor] = useState(factor.factor.toString())
  const [localNote, setLocalNote] = useState(factor.note ?? '')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setLocalFactor(factor.factor.toString())
    setLocalNote(factor.note ?? '')
    setDirty(false)
  }, [factor.factor, factor.note])

  const handleSave = async () => {
    const num = parseFloat(localFactor)
    if (Number.isNaN(num) || num < 0) {
      alert('Mnożnik musi być liczbą ≥ 0')
      return
    }
    await onUpdate(factor.month, num, localNote.trim() || null)
    setDirty(false)
  }

  return (
    <tr>
      <td>{MONTH_NAMES[factor.month - 1]}</td>
      <td>
        {isManager ? (
          <input
            type="number"
            step="0.05"
            min="0"
            value={localFactor}
            onChange={(e) => {
              setLocalFactor(e.target.value)
              setDirty(true)
            }}
            disabled={saving}
            style={{ width: 80 }}
          />
        ) : (
          <span>{factor.factor}</span>
        )}
      </td>
      <td>
        {isManager ? (
          <input
            type="text"
            value={localNote}
            onChange={(e) => {
              setLocalNote(e.target.value)
              setDirty(true)
            }}
            disabled={saving}
            placeholder="(opcjonalne)"
          />
        ) : (
          <span>{factor.note ?? '—'}</span>
        )}
      </td>
      {isManager && (
        <td>
          {dirty && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
              style={{ fontSize: '0.75rem', padding: '4px 8px', minWidth: 'auto' }}
            >
              {saving ? '...' : 'Zapisz'}
            </button>
          )}
        </td>
      )}
    </tr>
  )
}

export default SeasonalFactorsEditor
