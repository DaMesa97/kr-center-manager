import { useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquarePlus, X } from 'lucide-react'
import { supabase } from '../supabaseClient'
import type { CurrentUser, ToastVariant } from '../types'
import { imageFilesFromClipboard, mergePendingFiles, removeFeedbackAttachments, uploadFeedbackAttachments } from '../lib/feedbackAttachments'
import { FeedbackAttachmentsInput } from './FeedbackAttachments'

type Props = {
  currentUser: CurrentUser | null
  page?: string
  pushToast: (message: string, variant: ToastVariant) => void
}

const KINDS = [
  { value: 'bug', label: '🐞 Bug' },
  { value: 'pomysl', label: '💡 Pomysł' },
  { value: 'inne', label: '📝 Inne' },
]

export default function FeedbackFab({ currentUser, page, pushToast }: Props) {
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState('')
  const [kind, setKind] = useState('bug')
  const [files, setFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)

  const close = () => {
    if (saving) return
    setOpen(false)
    setFiles([])
  }

  const submit = async () => {
    const text = content.trim()
    if (!text) { pushToast('Wpisz treść', 'error'); return }
    setSaving(true)
    try {
      // #125: zrzuty ekranu — wysyłka do bucketu, potem wpis z listą załączników
      const attachments = await uploadFeedbackAttachments(files, { prefix: 'new', onError: (m) => pushToast(m, 'error') })
      const { error } = await supabase.from('feedback').insert([{
        content: text, kind, page: page ?? null,
        author_name: currentUser?.full_name || currentUser?.initials || null,
        author_id: currentUser?.id ?? null, status: 'nowe', attachments,
      }])
      if (error) {
        await removeFeedbackAttachments(attachments.map((a) => a.path))
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }
      pushToast('Dzięki! Zgłoszenie zapisane', 'success')
      setContent(''); setFiles([]); setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="feedback-fab"
        title="Zgłoś uwagę / bug"
        onClick={() => setOpen(true)}
      >
        <MessageSquarePlus size={18} /> Zgłoś uwagę
      </button>

      {open && createPortal(
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={close}>
          <div className="order-modal order-modal--sta" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="order-modal-header">
              <h2>Zgłoś uwagę</h2>
              <button type="button" className="btn btn-icon btn-ghost" onClick={close} disabled={saving}><X size={18} /></button>
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <select className="day-filter" value={kind} onChange={(e) => setKind(e.target.value)} disabled={saving}>
                {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
              <textarea
                autoFocus
                placeholder="Co nie działa / co poprawić / pomysł… (zrzut ekranu: Ctrl+V)"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onPaste={(e) => {
                  const imgs = imageFilesFromClipboard(e)
                  if (!imgs.length) return
                  e.preventDefault()
                  const { files: next, skipped } = mergePendingFiles(files, imgs)
                  if (skipped) pushToast(skipped, 'error')
                  setFiles(next)
                }}
                rows={5}
                style={{ width: '100%', padding: 10, border: '1px solid #cbd5e1', borderRadius: 6, resize: 'vertical', boxSizing: 'border-box' }}
              />
              <FeedbackAttachmentsInput files={files} onChange={setFiles} onSkipped={(m) => pushToast(m, 'error')} disabled={saving} />
              {page && <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Ekran: {page}</span>}
            </div>
            <div className="order-form-actions">
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void submit()}>
                {saving ? 'Wysyłam…' : 'Wyślij'}
              </button>
              <button type="button" className="btn btn-sm btn-primary" onClick={close} disabled={saving}>Anuluj</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
