import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Trash2, RefreshCw } from 'lucide-react'
import { supabase } from '../supabaseClient'
import type { CurrentUser, ToastVariant } from '../types'

type Props = {
  isManager: boolean
  currentUser: CurrentUser | null
  pushToast: (message: string, variant: ToastVariant) => void
}

export type FeedbackItem = {
  id: number
  content: string
  kind: string
  page: string | null
  author_name: string | null
  status: string
  created_at: string
  resolved_at: string | null
}

const KINDS = [
  { value: 'bug', label: '🐞 Bug', color: '#b91c1c' },
  { value: 'pomysl', label: '💡 Pomysł', color: '#1d4ed8' },
  { value: 'inne', label: '📝 Inne', color: '#475569' },
]
const STATUSES = ['nowe', 'w toku', 'zrobione'] as const
const STATUS_COLOR: Record<string, string> = { nowe: '#b45309', 'w toku': '#1d4ed8', zrobione: '#15803d' }

function fmt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function FeedbackView({ isManager, currentUser, pushToast }: Props) {
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('otwarte')
  const [content, setContent] = useState('')
  const [kind, setKind] = useState('bug')
  const [saving, setSaving] = useState(false)
  const mountedRef = useRef(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('feedback').select('*').order('created_at', { ascending: false })
    if (!mountedRef.current) return
    setItems((data ?? []) as FeedbackItem[])
    setLoading(false)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void load()
    const ch = supabase
      .channel('feedback:list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feedback' }, () => void load())
      .subscribe()
    return () => { mountedRef.current = false; void supabase.removeChannel(ch) }
  }, [load])

  const filtered = useMemo(() => {
    if (filter === 'wszystkie') return items
    if (filter === 'otwarte') return items.filter((i) => i.status !== 'zrobione')
    return items.filter((i) => i.status === filter)
  }, [items, filter])

  const counts = useMemo(
    () => ({
      otwarte: items.filter((i) => i.status !== 'zrobione').length,
      nowe: items.filter((i) => i.status === 'nowe').length,
      zrobione: items.filter((i) => i.status === 'zrobione').length,
    }),
    [items],
  )

  const handleAdd = async () => {
    const text = content.trim()
    if (!text) { pushToast('Wpisz treść zgłoszenia', 'error'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('feedback').insert([{
        content: text, kind, author_name: currentUser?.full_name || currentUser?.initials || null,
        author_id: currentUser?.id ?? null, status: 'nowe',
      }])
      if (error) { pushToast(`Błąd: ${error.message}`, 'error'); return }
      pushToast('Zgłoszenie dodane', 'success')
      setContent('')
      await load()
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  const setStatus = async (item: FeedbackItem, status: string) => {
    const { error } = await supabase
      .from('feedback')
      .update({ status, resolved_at: status === 'zrobione' ? new Date().toISOString() : null })
      .eq('id', item.id)
    if (error) { pushToast(`Błąd: ${error.message}`, 'error'); return }
    await load()
  }

  const handleDelete = async (item: FeedbackItem) => {
    if (!window.confirm('Usunąć to zgłoszenie?')) return
    const { error } = await supabase.from('feedback').delete().eq('id', item.id)
    if (error) { pushToast(`Błąd: ${error.message}`, 'error'); return }
    await load()
  }

  return (
    <div className="feedback-view">
      <div className="feedback-add">
        <div className="feedback-add-row">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="day-filter">
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          <input
            type="text"
            placeholder="Opisz bug / pomysł / uwagę…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }}
          />
          <button type="button" className="btn btn-success" disabled={saving} onClick={() => void handleAdd()}>
            {saving ? 'Dodaję…' : 'Dodaj'}
          </button>
        </div>
      </div>

      <div className="feedback-filters">
        {[
          { key: 'otwarte', label: `Otwarte (${counts.otwarte})` },
          { key: 'nowe', label: `Nowe (${counts.nowe})` },
          { key: 'zrobione', label: `Zrobione (${counts.zrobione})` },
          { key: 'wszystkie', label: 'Wszystkie' },
        ].map((f) => (
          <button
            key={f.key}
            type="button"
            className={`alerts-filter-pill ${filter === f.key ? 'alerts-filter-pill--active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void load()} title="Odśwież">
          <RefreshCw size={16} />
        </button>
      </div>

      {loading ? (
        <p className="no-results">Ładowanie…</p>
      ) : filtered.length === 0 ? (
        <p className="no-results">Brak zgłoszeń.</p>
      ) : (
        <div className="feedback-list">
          {filtered.map((item) => {
            const k = KINDS.find((x) => x.value === item.kind) ?? KINDS[2]
            return (
              <div key={item.id} className={`feedback-item ${item.status === 'zrobione' ? 'feedback-item--done' : ''}`}>
                <div className="feedback-item-main">
                  <span className="feedback-kind" style={{ background: k.color }}>{k.label}</span>
                  <span className="feedback-content">{item.content}</span>
                </div>
                <div className="feedback-item-meta">
                  <span className="feedback-author">{item.author_name || '—'} · {fmt(item.created_at)}</span>
                  <select
                    className="feedback-status"
                    style={{ borderColor: STATUS_COLOR[item.status] ?? '#cbd5e1', color: STATUS_COLOR[item.status] }}
                    value={item.status}
                    onChange={(e) => void setStatus(item, e.target.value)}
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {isManager && (
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => void handleDelete(item)}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
