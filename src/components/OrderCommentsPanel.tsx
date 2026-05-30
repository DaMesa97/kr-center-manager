import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../supabaseClient'
import type { DbProfileRow, OrderComment } from '../types'

type Props = {
  open: boolean
  orderId: number | null
  orderNumber: string
  currentUserId: string
  currentUserRole: string
  onClose: () => void
  onCountChange?: (orderId: number, total: number) => void
}

function OrderCommentsPanel({
  open,
  orderId,
  orderNumber,
  currentUserId,
  currentUserRole,
  onClose,
  onCountChange,
}: Props) {
  const [comments, setComments] = useState<OrderComment[]>([])
  const [loading, setLoading] = useState(false)
  const [newText, setNewText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')

  const fetchComments = useCallback(async () => {
    if (!orderId) return
    setLoading(true)

    const { data, error } = await supabase
      .from('order_comments')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true })

    console.log('[OrderCommentsPanel] fetch result:', { data, error, orderId })

    setLoading(false)

    if (error) {
      console.error('[OrderCommentsPanel] error:', error)
      return
    }

    const rows = data ?? []
    const authorIds = [...new Set(rows.map((r) => r.author_id).filter((id): id is string => Boolean(id)))]

    const profileMap = new Map<string, { full_name: string | null; role: string | null }>()
    if (authorIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .in('id', authorIds)

      console.log('[OrderCommentsPanel] profiles fetch:', { profiles, profilesError, authorIds })

      if (!profilesError && profiles) {
        for (const p of profiles as DbProfileRow[]) {
          profileMap.set(p.id, { full_name: p.full_name, role: p.role })
        }
      } else if (profilesError) {
        console.error('[OrderCommentsPanel] profiles error:', profilesError)
      }
    }

    const mapped = rows.map((row) => {
      const prof = profileMap.get(row.author_id)
      return {
        ...row,
        author_name: prof?.full_name?.trim() ? prof.full_name : 'Nieznany',
        author_role: prof?.role ?? '',
      }
    }) as OrderComment[]

    setComments(mapped)
    onCountChange?.(orderId, mapped.length)

    await supabase.rpc('mark_order_comments_read', { p_order_id: orderId })
  }, [orderId, onCountChange])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    if (open && orderId) void fetchComments()
  }, [open, orderId, fetchComments])

  if (!open || !orderId) return null

  const handleAdd = async () => {
    const content = newText.trim()
    if (!content) return

    setSubmitting(true)
    const { error } = await supabase.from('order_comments').insert({
      order_id: orderId,
      author_id: currentUserId,
      content,
    })
    setSubmitting(false)

    if (error) {
      alert(`Błąd: ${error.message}`)
      return
    }

    setNewText('')
    await fetchComments()
  }

  const handleStartEdit = (c: OrderComment) => {
    setEditingId(c.id)
    setEditText(c.content)
  }

  const handleSaveEdit = async () => {
    if (!editingId) return
    const content = editText.trim()
    if (!content) return

    const { error } = await supabase.from('order_comments').update({ content }).eq('id', editingId)

    if (error) {
      alert(`Błąd: ${error.message}`)
      return
    }

    setEditingId(null)
    setEditText('')
    await fetchComments()
  }

  const handleDelete = async (c: OrderComment) => {
    const canDelete = c.author_id === currentUserId || currentUserRole === 'manager'
    if (!canDelete) return
    if (!window.confirm('Czy na pewno usunąć ten komentarz?')) return

    const { error } = await supabase.from('order_comments').delete().eq('id', c.id)

    if (error) {
      alert(`Błąd: ${error.message}`)
      return
    }

    await fetchComments()
  }

  return createPortal(
    <>
      <div className="order-comments-overlay" onClick={onClose} />
      <aside className="order-comments-panel">
        <header className="order-comments-header">
          <h3>💬 Komentarze — zlecenie {orderNumber}</h3>
          <button className="btn btn-icon btn-ghost" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="order-comments-list">
          {loading && <div className="order-comments-empty">Ładowanie...</div>}
          {!loading && comments.length === 0 && (
            <div className="order-comments-empty">Brak komentarzy. Dodaj pierwszy!</div>
          )}
          {!loading &&
            comments.map((c) => {
              const isOwn = c.author_id === currentUserId
              const canDelete = isOwn || currentUserRole === 'manager'
              const isEditing = editingId === c.id
              return (
                <div key={c.id} className={`order-comment ${isOwn ? 'order-comment--own' : ''}`}>
                  <div className="order-comment-header">
                    <strong>{c.author_name}</strong>
                    <span className="order-comment-date">
                      {new Date(c.created_at).toLocaleString('pl-PL')}
                      {c.edited && <span className="order-comment-edited"> · edytowane</span>}
                    </span>
                  </div>
                  {isEditing ? (
                    <>
                      <textarea
                        className="order-comment-edit-textarea"
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={3}
                      />
                      <div className="order-comment-edit-actions">
                        <button
                          className="btn btn-primary"
                          onClick={handleSaveEdit}
                        >
                          Zapisz
                        </button>
                        <button
                          className="btn btn-secondary"
                          onClick={() => {
                            setEditingId(null)
                            setEditText('')
                          }}
                        >
                          Anuluj
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="order-comment-content">{c.content}</div>
                      {(isOwn || canDelete) && (
                        <div className="order-comment-actions">
                          {isOwn && (
                            <button className="order-comment-action-btn" onClick={() => handleStartEdit(c)}>
                              Edytuj
                            </button>
                          )}
                          {canDelete && (
                            <button
                              className="btn btn-sm btn-danger order-comment-action-btn--danger"
                              onClick={() => handleDelete(c)}
                            >
                              Usuń
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
        </div>

        <footer className="order-comments-footer">
          <textarea
            className="order-comments-textarea"
            placeholder="Napisz komentarz..."
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            rows={3}
            disabled={submitting}
          />
          <button
            className="btn btn-primary"
            onClick={handleAdd}
            disabled={submitting || !newText.trim()}
          >
            Dodaj komentarz
          </button>
        </footer>
      </aside>
    </>,
    document.body,
  )
}

export default OrderCommentsPanel
