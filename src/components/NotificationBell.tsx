import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, Check, ClipboardCheck, AlertTriangle, MessageSquare, Package } from 'lucide-react'
import { supabase } from '../supabaseClient'
import type { AppNotification } from '../types'

type Props = {
  currentUserId: string
  onNavigate: (tab: string) => void
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  review: <ClipboardCheck size={15} />,
  stock: <AlertTriangle size={15} />,
  complaint: <MessageSquare size={15} />,
  overdue: <Package size={15} />,
}

function timeAgo(iso: string): string {
  if (!iso || !iso.trim()) return 'niedawno'
  const then = new Date(iso).getTime()
  if (isNaN(then)) return 'niedawno'
  const now = Date.now()
  const diff = Math.max(0, now - then)
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'teraz'
  if (min < 60) return `${min} min temu`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} godz. temu`
  const d = Math.floor(h / 24)
  return `${d} dni temu`
}

export default function NotificationBell({ currentUserId, onNavigate }: Props) {
  const [items, setItems] = useState<AppNotification[]>([])
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const unread = items.filter((n) => !n.is_read).length

  const fetchNotifications = useCallback(async () => {
    if (!currentUserId) return
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', currentUserId)
      .order('created_at', { ascending: false })
      .limit(30)
    if (error) {
      // Tabela może jeszcze nie istnieć — nie spamuj
      return
    }
    setItems((data ?? []) as AppNotification[])
  }, [currentUserId])

  useEffect(() => { void fetchNotifications() }, [fetchNotifications])

  // Realtime — nowe powiadomienia
  useEffect(() => {
    if (!currentUserId) return
    const channel = supabase
      .channel(`notifications:realtime:${currentUserId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUserId}` },
        (payload) => {
          setItems((prev) => [payload.new as AppNotification, ...prev].slice(0, 30))
        },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [currentUserId])

  // Zamknij panel po kliknięciu poza
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const markAllRead = async () => {
    const unreadIds = items.filter((n) => !n.is_read).map((n) => n.id)
    if (unreadIds.length === 0) return
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })))
    await supabase.from('notifications').update({ is_read: true }).in('id', unreadIds)
  }

  const handleClick = async (n: AppNotification) => {
    if (!n.is_read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)))
      await supabase.from('notifications').update({ is_read: true }).eq('id', n.id)
    }
    if (n.link_tab) onNavigate(n.link_tab)
    setOpen(false)
  }

  return (
    <div className="notif-bell-wrap" ref={panelRef}>
      <button
        type="button"
        className="notif-bell-btn"
        onClick={() => setOpen((v) => !v)}
        title="Powiadomienia"
      >
        <Bell size={17} />
        {unread > 0 && <span className="notif-bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-panel-header">
            <span>Powiadomienia</span>
            {unread > 0 && (
              <button type="button" className="notif-mark-all" onClick={() => void markAllRead()}>
                <Check size={13} /> Oznacz wszystkie
              </button>
            )}
          </div>
          <div className="notif-panel-list">
            {items.length === 0 ? (
              <div className="notif-empty">Brak powiadomień</div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`notif-item ${n.is_read ? '' : 'notif-item--unread'}`}
                  onClick={() => void handleClick(n)}
                >
                  <span className="notif-item-icon">{TYPE_ICON[n.type] ?? <Bell size={15} />}</span>
                  <span className="notif-item-body">
                    <span className="notif-item-title">{n.title}</span>
                    {n.body && <span className="notif-item-text">{n.body}</span>}
                    <span className="notif-item-time">{timeAgo(n.created_at)}</span>
                  </span>
                  {!n.is_read && <span className="notif-item-dot" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
