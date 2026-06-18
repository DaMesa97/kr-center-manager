import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Package, CheckSquare, DoorOpen, Truck, LogOut } from 'lucide-react'
import { supabase } from './supabaseClient'
import MobilePackingView from './components/mobile/MobilePackingView'
import MobileStationView from './components/mobile/MobileStationView'
import MobileOrdersView from './components/mobile/MobileOrdersView'
import MobileShippingView from './components/mobile/MobileShippingView'

type SessionUser = { id: string; initials: string }

export default function MobileApp() {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState<'packing' | 'station' | 'orders' | 'shipping'>('packing')
  const mountedRef = useRef(true)

  const loadProfile = async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('id, initials, full_name')
      .eq('id', userId)
      .maybeSingle()
    if (!mountedRef.current) return
    setUser({
      id: userId,
      initials: (data?.initials as string) || (data?.full_name as string)?.slice(0, 2)?.toUpperCase() || '??',
    })
  }

  useEffect(() => {
    mountedRef.current = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mountedRef.current) return
      if (data.session?.user) {
        void loadProfile(data.session.user.id).finally(() => {
          if (mountedRef.current) setReady(true)
        })
      } else {
        setReady(true)
      }
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!mountedRef.current) return
      if (session?.user) void loadProfile(session.user.id)
      else setUser(null)
    })
    return () => { mountedRef.current = false; sub.subscription.unsubscribe() }
  }, [])

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault()
    const login = username.trim()
    if (!login) { setError('Wpisz login'); return }
    if (!password) { setError('Wpisz hasło'); return }
    const email = login.includes('@') ? login : `${login}@krcenter.pl`
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Niepoprawny login')
      return
    }
    setSubmitting(true)
    setError('')
    const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password })
    if (!mountedRef.current) return
    setSubmitting(false)
    if (loginErr) {
      setError('Błędny login lub hasło')
      return
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setUsername('')
    setPassword('')
  }

  if (!ready) {
    return (
      <div className="mlogin-boot">
        <div className="mlogin-spinner" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="mlogin">
        <div className="mlogin-card">
          <h1 className="mlogin-title">KR Center</h1>
          <p className="mlogin-sub">Pakowanie — wersja mobilna</p>
          <form className="mlogin-form" onSubmit={handleLogin}>
            <label className="mlogin-field">
              <span>Login</span>
              <input
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={submitting}
              />
            </label>
            <label className="mlogin-field">
              <span>Hasło</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
            </label>
            {error && <div className="mlogin-error">{error}</div>}
            <button type="submit" className="mlogin-btn" disabled={submitting}>
              {submitting ? 'Logowanie…' : 'Zaloguj'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="mshell">
      <header className="mshell-header">
        <span className="mshell-title">
          {view === 'packing' ? '📦 Pakowanie'
            : view === 'station' ? '✓ Moje zadania'
            : view === 'orders' ? '🚪 Zlecenia'
            : '🚛 Wysyłka'}
        </span>
        <span className="mpack-user">{user.initials}</span>
        <button type="button" className="mpack-signout" onClick={() => void handleSignOut()} title="Wyloguj">
          <LogOut size={18} />
        </button>
      </header>

      <main className="mshell-content">
        {view === 'packing' ? (
          <MobilePackingView userInitials={user.initials} userId={user.id} />
        ) : view === 'station' ? (
          <MobileStationView userId={user.id} />
        ) : view === 'orders' ? (
          <MobileOrdersView />
        ) : (
          <MobileShippingView />
        )}
      </main>

      <nav className="mshell-nav">
        <button
          type="button"
          className={`mshell-nav-btn ${view === 'packing' ? 'mshell-nav-btn--active' : ''}`}
          onClick={() => setView('packing')}
        >
          <Package size={22} />
          <span>Pakowanie</span>
        </button>
        <button
          type="button"
          className={`mshell-nav-btn ${view === 'station' ? 'mshell-nav-btn--active' : ''}`}
          onClick={() => setView('station')}
        >
          <CheckSquare size={22} />
          <span>Zadania</span>
        </button>
        <button
          type="button"
          className={`mshell-nav-btn ${view === 'orders' ? 'mshell-nav-btn--active' : ''}`}
          onClick={() => setView('orders')}
        >
          <DoorOpen size={22} />
          <span>Zlecenia</span>
        </button>
        <button
          type="button"
          className={`mshell-nav-btn ${view === 'shipping' ? 'mshell-nav-btn--active' : ''}`}
          onClick={() => setView('shipping')}
        >
          <Truck size={22} />
          <span>Wysyłka</span>
        </button>
      </nav>
    </div>
  )
}
