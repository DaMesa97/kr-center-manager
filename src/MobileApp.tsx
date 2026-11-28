import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Package, CheckSquare, DoorOpen, Truck, LogOut } from 'lucide-react'
import { supabase } from './supabaseClient'
import MobilePackingView from './components/mobile/MobilePackingView'
import MobileStationView from './components/mobile/MobileStationView'
import MobileOrdersView from './components/mobile/MobileOrdersView'
import MobileShippingView from './components/mobile/MobileShippingView'
import { can, isManagerRole } from './lib/permissions'
import { canPickIntDoor } from './lib/orderPicks'
import { filtrKategoriiNaTelefon, kategorieNaTelefon } from './components/mobile/mobileKategorie'

type SessionUser = { id: string; initials: string; role: string; department: string; categories: string[] }

export default function MobileApp() {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState<'packing' | 'station' | 'orders' | 'shipping'>('packing')
  const mountedRef = useRef(true)
  // Pracownik produkcji ląduje od razu w swoich zadaniach (nie w Pakowaniu) —
  // tylko raz po zalogowaniu, odświeżenie tokenu nie może przerzucać ekranu
  const didDefaultViewRef = useRef(false)
  // runda 10 (tester telefonu): Supabase wysyła SIGNED_IN przy każdym powrocie z tła — jak na komputerze
  // (useAuth) profil wczytujemy tylko dla NOWEGO użytkownika, a błąd odczytu nie podmienia go na „??”
  const loadedUserIdRef = useRef<string | null>(null)

  const loadProfile = async (userId: string) => {
    const { data, error: profErr } = await supabase
      .from('profiles')
      .select('id, initials, full_name, role, department, categories')
      .eq('id', userId)
      .maybeSingle()
    if (!mountedRef.current) return
    if (profErr || !data) {
      console.error('[telefon] profil:', profErr)
      // odświeżenie już wczytanego profilu padło — zostaje poprzedni
      if (loadedUserIdRef.current === userId) return
      // pierwsze wczytanie padło: nie wpuszczamy z pustą rolą i inicjałami „??”
      setUser(null)
      setError(
        profErr
          ? 'Nie udało się wczytać Twojego profilu (sprawdź internet) — zaloguj się ponownie.'
          : 'Twoje konto nie ma profilu w programie — poproś administratora o jego założenie.',
      )
      return
    }
    loadedUserIdRef.current = userId
    if (!didDefaultViewRef.current) {
      didDefaultViewRef.current = true
      if (String(data?.role ?? '') === 'pracownik_produkcji') setView('station')
    }
    setUser({
      id: userId,
      initials: (data?.initials as string) || (data?.full_name as string)?.slice(0, 2)?.toUpperCase() || '??',
      role: String(data?.role ?? ''),
      department: String((data as { department?: string } | null)?.department ?? ''),
      categories: Array.isArray((data as { categories?: string[] } | null)?.categories)
        ? ((data as { categories?: string[] }).categories as string[])
        : [],
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
      if (session?.user) {
        if (session.user.id !== loadedUserIdRef.current) void loadProfile(session.user.id)
      } else {
        loadedUserIdRef.current = null
        setUser(null)
      }
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
    // Ten sam limit prób co na komputerze (5 nieudanych / 15 min) — telefon go
    // omijał: nie sprawdzał blokady i nie zapisywał nieudanych prób
    const { data: rate } = await supabase.rpc('check_login_rate_limit', { p_email: email })
    const rateRow = (rate as Array<{ r_blocked: boolean; r_seconds_until_unlock: number }> | null)?.[0]
    if (rateRow?.r_blocked) {
      if (!mountedRef.current) return
      setSubmitting(false)
      setError(`Zbyt wiele nieudanych prób. Spróbuj za ${Math.ceil((rateRow.r_seconds_until_unlock ?? 0) / 60)} min.`)
      return
    }
    const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password })
    if (!mountedRef.current) return
    if (loginErr?.code === 'user_banned') {
      setSubmitting(false)
      setError('Konto jest zablokowane — skontaktuj się z administratorem.')
      return
    }
    if (loginErr?.status === 429) {
      setSubmitting(false)
      setError('Za dużo prób logowania — odczekaj kilka minut.')
      return
    }
    // 400 = złe dane (liczymy próbę); sieć / 5xx to nie „złe hasło”
    if (!loginErr || loginErr.status === 400) {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : null
      await supabase.rpc('log_login_attempt', { p_email: email, p_success: !loginErr, p_user_agent: ua })
    }
    if (!mountedRef.current) return
    setSubmitting(false)
    if (loginErr) {
      setError(loginErr.status === 400 ? 'Błędny login lub hasło' : 'Błąd połączenia — sprawdź internet i spróbuj ponownie')
      return
    }
  }

  const handleSignOut = async () => {
    // scope:'local' — wyloguj ten telefon, nie wszystkie stanowiska konta
    await supabase.auth.signOut({ scope: 'local' })
    // następna osoba na tym telefonie dostaje swój domyślny ekran
    didDefaultViewRef.current = false
    setView('packing')
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

  // Wysyłka (wydawanie zamówień) tylko dla ról z shipping.view — jak na desktopie.
  // Pusta rola (profil się nie wczytał) = brak dostępu.
  const canShip = can(user.role, 'shipping.view')
  const activeView = view === 'shipping' && !canShip ? 'packing' : view

  return (
    <div className="mshell">
      <header className="mshell-header">
        <span className="mshell-title">
          {activeView === 'packing' ? '📦 Pakowanie'
            : activeView === 'station' ? '✓ Moje zadania'
            : activeView === 'orders' ? '🚪 Zlecenia'
            : '🚛 Wysyłka'}
        </span>
        <span className="mpack-user">{user.initials}</span>
        <button type="button" className="mpack-signout" onClick={() => void handleSignOut()} title="Wyloguj">
          <LogOut size={18} />
        </button>
      </header>

      <main className="mshell-content">
        {activeView === 'packing' ? (
          <MobilePackingView userInitials={user.initials} userId={user.id} kategorie={filtrKategoriiNaTelefon(user.role, user.categories)} />
        ) : activeView === 'station' ? (
          <MobileStationView userId={user.id} />
        ) : activeView === 'orders' ? (
          <MobileOrdersView
            canPickItems={canPickIntDoor({ role: user.role, department: user.department, categories: user.categories }, isManagerRole(user.role))}
            initials={user.initials}
            kategorie={kategorieNaTelefon(user.role, user.categories)}
          />
        ) : (
          <MobileShippingView role={user.role} categories={user.categories} />
        )}
      </main>

      <nav className="mshell-nav">
        <button
          type="button"
          className={`mshell-nav-btn ${activeView === 'packing' ? 'mshell-nav-btn--active' : ''}`}
          onClick={() => setView('packing')}
        >
          <Package size={22} />
          <span>Pakowanie</span>
        </button>
        <button
          type="button"
          className={`mshell-nav-btn ${activeView === 'station' ? 'mshell-nav-btn--active' : ''}`}
          onClick={() => setView('station')}
        >
          <CheckSquare size={22} />
          <span>Zadania</span>
        </button>
        <button
          type="button"
          className={`mshell-nav-btn ${activeView === 'orders' ? 'mshell-nav-btn--active' : ''}`}
          onClick={() => setView('orders')}
        >
          <DoorOpen size={22} />
          <span>Zlecenia</span>
        </button>
        {canShip && (
          <button
            type="button"
            className={`mshell-nav-btn ${view === 'shipping' ? 'mshell-nav-btn--active' : ''}`}
            onClick={() => setView('shipping')}
          >
            <Truck size={22} />
            <span>Wysyłka</span>
          </button>
        )}
      </nav>
    </div>
  )
}
