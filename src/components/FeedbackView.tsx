import { appConfirm } from '../lib/appDialogs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Trash2, RefreshCw, Pencil } from 'lucide-react'
import { supabase } from '../supabaseClient'
import type { CurrentUser, ToastVariant } from '../types'
import {
  imageFilesFromClipboard,
  mergePendingFiles,
  parseAttachments,
  removeFeedbackAttachments,
  uploadFeedbackAttachments,
  type FeedbackAttachment,
} from '../lib/feedbackAttachments'
import { FeedbackAttachmentList, FeedbackAttachmentsInput } from './FeedbackAttachments'

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
  author_id: string | null
  status: string
  created_at: string
  resolved_at: string | null
  /** #125: [{path,url,name,size}] */
  attachments?: unknown
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
  const [pending, setPending] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  // #125: edycja własnego zgłoszenia (autor do zamknięcia, kierownik zawsze)
  const [editing, setEditing] = useState<{ id: number; content: string; attachments: FeedbackAttachment[]; removed: string[]; files: File[] } | null>(null)
  const [editSaving, setEditSaving] = useState(false)
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

  const addPending = (incoming: File[]) => {
    if (incoming.length === 0) return
    const { files, skipped } = mergePendingFiles(pending, incoming)
    if (skipped) pushToast(skipped, 'error')
    setPending(files)
  }

  const handleAdd = async () => {
    const text = content.trim()
    if (!text) { pushToast('Wpisz treść zgłoszenia', 'error'); return }
    setSaving(true)
    try {
      const attachments = await uploadFeedbackAttachments(pending, { prefix: 'new', onError: (m) => pushToast(m, 'error') })
      const { error } = await supabase.from('feedback').insert([{
        content: text, kind, author_name: currentUser?.full_name || currentUser?.initials || null,
        author_id: currentUser?.id ?? null, status: 'nowe', attachments,
      }])
      if (error) {
        await removeFeedbackAttachments(attachments.map((a) => a.path))
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }
      pushToast(attachments.length ? `Zgłoszenie dodane (${attachments.length} zrzut.)` : 'Zgłoszenie dodane', 'success')
      setContent('')
      setPending([])
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
    if (!(await appConfirm('Usunąć to zgłoszenie?'))) return
    const { error } = await supabase.from('feedback').delete().eq('id', item.id)
    if (error) { pushToast(`Błąd: ${error.message}`, 'error'); return }
    await removeFeedbackAttachments(parseAttachments(item.attachments).map((a) => a.path))
    await load()
  }

  const canEdit = (item: FeedbackItem) =>
    isManager || (!!currentUser?.id && item.author_id === currentUser.id && item.status !== 'zrobione')

  const startEdit = (item: FeedbackItem) =>
    setEditing({ id: item.id, content: item.content, attachments: parseAttachments(item.attachments), removed: [], files: [] })

  const saveEdit = async () => {
    if (!editing) return
    const text = editing.content.trim()
    if (!text) { pushToast('Treść nie może być pusta', 'error'); return }
    setEditSaving(true)
    try {
      const uploaded = await uploadFeedbackAttachments(editing.files, { prefix: String(editing.id), onError: (m) => pushToast(m, 'error') })
      const attachments = [...editing.attachments, ...uploaded]
      const { error } = await supabase.rpc('feedback_update_own', { p_id: editing.id, p_content: text, p_attachments: attachments })
      if (error) {
        await removeFeedbackAttachments(uploaded.map((a) => a.path))
        pushToast(`Nie zapisano: ${error.message}`, 'error')
        return
      }
      await removeFeedbackAttachments(editing.removed)
      pushToast('Zgłoszenie zapisane', 'success')
      setEditing(null)
      await load()
    } finally {
      if (mountedRef.current) setEditSaving(false)
    }
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
            placeholder="Opisz bug / pomysł / uwagę… (zrzut ekranu: Ctrl+V)"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onPaste={(e) => { const imgs = imageFilesFromClipboard(e); if (imgs.length) { e.preventDefault(); addPending(imgs) } }}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }}
          />
          <button type="button" className="btn btn-success" disabled={saving} onClick={() => void handleAdd()}>
            {saving ? 'Dodaję…' : 'Dodaj'}
          </button>
        </div>
        <div style={{ marginTop: 8 }}>
          <FeedbackAttachmentsInput files={pending} onChange={setPending} onSkipped={(m) => pushToast(m, 'error')} disabled={saving} compact />
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
            const isEditing = editing?.id === item.id
            const attachments = parseAttachments(item.attachments)
            return (
              <div key={item.id} className={`feedback-item ${item.status === 'zrobione' ? 'feedback-item--done' : ''}`}>
                <div className="feedback-item-main">
                  <span className="feedback-kind" style={{ background: k.color }}>{k.label}</span>
                  {isEditing && editing ? (
                    <div style={{ flex: 1 }}>
                      <textarea
                        className="feedback-edit-textarea"
                        value={editing.content}
                        autoFocus
                        disabled={editSaving}
                        onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                        onPaste={(e) => {
                          const imgs = imageFilesFromClipboard(e)
                          if (!imgs.length) return
                          e.preventDefault()
                          const { files, skipped } = mergePendingFiles(editing.files, imgs)
                          if (skipped) pushToast(skipped, 'error')
                          setEditing({ ...editing, files })
                        }}
                        onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null) }}
                      />
                      <FeedbackAttachmentList
                        items={editing.attachments}
                        onRemove={(a) => setEditing({ ...editing, attachments: editing.attachments.filter((x) => x.path !== a.path), removed: [...editing.removed, a.path] })}
                      />
                      <div style={{ marginTop: 6 }}>
                        <FeedbackAttachmentsInput
                          files={editing.files}
                          onChange={(files) => setEditing({ ...editing, files })}
                          onSkipped={(m) => pushToast(m, 'error')}
                          disabled={editSaving}
                          compact
                        />
                      </div>
                      <div className="feedback-edit-actions">
                        <button type="button" className="btn btn-sm btn-primary" disabled={editSaving} onClick={() => void saveEdit()}>
                          {editSaving ? 'Zapisuję…' : 'Zapisz'}
                        </button>
                        <button type="button" className="btn btn-sm btn-secondary" disabled={editSaving} onClick={() => setEditing(null)}>
                          Anuluj
                        </button>
                      </div>
                    </div>
                  ) : (
                    <span className="feedback-content">
                      {item.content}
                      <FeedbackAttachmentList items={attachments} />
                    </span>
                  )}
                </div>
                <div className="feedback-item-meta">
                  <span className="feedback-author">#{item.id} · {item.author_name || '—'} · {fmt(item.created_at)}{item.page ? ` · ${item.page}` : ''}</span>
                  {!isEditing && canEdit(item) && (
                    <button type="button" className="btn btn-sm btn-ghost" title={isManager ? 'Edytuj treść / zrzuty' : 'Popraw swoje zgłoszenie (do czasu zamknięcia)'} onClick={() => startEdit(item)}>
                      <Pencil size={14} />
                    </button>
                  )}
                  <select
                    className="feedback-status"
                    style={{ borderColor: STATUS_COLOR[item.status] ?? '#cbd5e1', color: STATUS_COLOR[item.status] }}
                    value={item.status}
                    disabled={!isManager}
                    title={isManager ? undefined : 'Status zgłoszeń zmienia kierownik'}
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
