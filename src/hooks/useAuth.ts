import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../supabaseClient'
import { clearSentryUserContext, setSentryUserFromProfile } from '../utils/auth'
import { normalizeProfileDepartment } from '../utils'
import type { CurrentUser, ToastVariant } from '../types'

const SESSION_TIMEOUT_MS = 60 * 60 * 1000
const SESSION_WARNING_MS = 59 * 60 * 1000

interface RateLimitRow {
  r_blocked: boolean
  r_seconds_until_unlock: number
  r_failed_attempts: number
}

type UseAuthParams = {
  pushToast: (message: string, variant: ToastVariant) => void
  onLogout: () => void
}

export function useAuth({ pushToast, onLogout }: UseAuthParams) {
  const [authSession, setAuthSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  // błąd PIERWSZEGO wczytania profilu (App pokazuje ekran z „Spróbuj ponownie”)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginSubmitting, setLoginSubmitting] = useState(false)
  // Błąd logowania NA STAŁE pod formularzem (toast znikał po 10 s i formularz
  // wyglądał „czysto" — senior nie wiedział, co poprawić)
  const [loginError, setLoginError] = useState<string | null>(null)
  // Aktywność w REF, nie w stanie — touchSession woła się na początku niemal
  // każdego fetcha i każdy setState przerysowywał całe App (3+ tys. linii)
  const sessionLastActivityRef = useRef<number>(Date.now())
  const [sessionWarningOpen, setSessionWarningOpen] = useState(false)
  // Supabase odpala onAuthStateChange (SIGNED_IN) przy KAŻDYM powrocie focusu na okno.
  // Bez tych guardów każdy taki event przeładowywał profil i sesję → ciężki re-render
  // całego App → gubione kliknięcia/focus w inputach. Reagujemy tylko na realne zmiany.
  const loadedUserIdRef = useRef<string | null>(null)
  const authTokenRef = useRef<string | null>(null)

  const touchSession = useCallback(() => {
    sessionLastActivityRef.current = Date.now()
    // setState tylko gdy realnie zamykamy ostrzeżenie (ta sama wartość = brak renderu)
    setSessionWarningOpen((open) => (open ? false : open))
  }, [])

  const loadProfile = useCallback(async (user: User) => {
    setProfileError(null)
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
    if (error) {
      console.error(error)
      // Odświeżenie już wczytanego profilu padło (np. po edycji w Użytkownikach) —
      // zostaje poprzedni, nic nie blokujemy
      if (loadedUserIdRef.current === user.id) return
      // Pierwsze wczytanie padło: NIE wpuszczamy z pustą rolą — „zastępczy” profil
      // z role='' był traktowany jak stara rola i pokazywał pracownikowi hali
      // całe menu i ceny. App pokazuje ekran z „Spróbuj ponownie”.
      setCurrentUser(null)
      setProfileError(
        error.code === 'PGRST116'
          ? 'Twoje konto nie ma profilu w programie — poproś administratora o jego założenie.'
          : 'Nie udało się wczytać Twojego profilu (sprawdź internet).',
      )
      return
    }
    const role = String((data as { role?: string }).role ?? '')
    const profile: CurrentUser = {
      id: user.id,
      email: user.email ?? String((data as { email?: string }).email ?? ''),
      initials: String((data as { initials?: string }).initials ?? '').trim(),
      full_name:
        String((data as { full_name?: string }).full_name ?? '').trim() ||
        (user.email ?? 'Użytkownik'),
      role,
      department: normalizeProfileDepartment(role, (data as { department?: string }).department),
      categories: Array.isArray((data as { categories?: string[] }).categories)
        ? ((data as { categories?: string[] }).categories as string[])
        : [],
      zkp_roles: Array.isArray((data as { zkp_roles?: string[] }).zkp_roles)
        ? ((data as { zkp_roles?: string[] }).zkp_roles as string[])
        : [],
    }
    setCurrentUser(profile)
    setSentryUserFromProfile(profile)
    loadedUserIdRef.current = user.id
  }, [])

  // Inicjalizacja sesji + nasłuch zmian
  useEffect(() => {
    let cancelled = false
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      authTokenRef.current = session?.access_token ?? null
      setAuthSession(session)
      if (session) {
        touchSession()
        void loadProfile(session.user)
      } else {
        setCurrentUser(null)
      }
      setAuthReady(true)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      // Reaguj tylko gdy realnie zmienił się token (pomija eventy przy focusie okna,
      // które inaczej wywoływały re-render całego App i gubiły focus/klik w inputach)
      const token = session?.access_token ?? null
      const tokenChanged = token !== authTokenRef.current
      if (tokenChanged) {
        authTokenRef.current = token
        setAuthSession(session)
      }
      if (session) {
        if (tokenChanged) touchSession()
        // Przeładuj profil tylko dla NOWEGO usera (nie przy każdym SIGNED_IN z focusu)
        if (session.user.id !== loadedUserIdRef.current) {
          void loadProfile(session.user)
        }
      } else {
        loadedUserIdRef.current = null
        clearSentryUserContext()
        setCurrentUser(null)
        setProfileError(null)
        setLoginPassword('')
        // Wspólny PC: login poprzedniej osoby zostawał w polu → kolega wpisywał
        // swoje hasło pod cudzym loginem i po 5 próbach blokował CUDZE konto
        setLoginUsername('')
        setLoginError(null)
        onLogout()
      }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Licznik bezczynności widzi KLIKANIE, nie tylko fetche: oznaczanie etapów na
  // „Moim stanowisku" nie woła touchSession i pracownik był wylogowywany w
  // środku pracy (zwiad #7). Throttle 30 s — bez re-renderów.
  useEffect(() => {
    if (!authSession) return
    let last = 0
    const onActivity = () => {
      const now = Date.now()
      if (now - last < 30_000) return
      last = now
      sessionLastActivityRef.current = now
    }
    window.addEventListener('pointerdown', onActivity, { passive: true })
    window.addEventListener('keydown', onActivity, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', onActivity)
      window.removeEventListener('keydown', onActivity)
    }
  }, [authSession])

  // Auto-logout po braku aktywności — interwał stabilny (czyta ref),
  // nie odtwarza się przy każdym fetchu/aktywności
  useEffect(() => {
    if (!authSession) return
    const interval = setInterval(() => {
      const elapsed = Date.now() - sessionLastActivityRef.current
      if (elapsed >= SESSION_TIMEOUT_MS) {
        void (async () => {
          // scope:'local' — stanowiska WSPÓŁDZIELĄ konta; globalny signOut
          // unieważniał refresh tokeny i wylogowywał wszystkie komputery
          await supabase.auth.signOut({ scope: 'local' })
          setSessionWarningOpen(false)
          pushToast('Zostałeś automatycznie wylogowany z powodu braku aktywności', 'error')
        })()
      } else if (elapsed >= SESSION_WARNING_MS) {
        setSessionWarningOpen((open) => (open ? open : true))
      }
    }, 10_000)
    return () => clearInterval(interval)
  }, [authSession, pushToast])

  const handleLoginSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      const username = loginUsername.trim()
      setLoginError(null)
      if (!username) {
        setLoginError('Wpisz swoją nazwę użytkownika.')
        return
      }
      if (!loginPassword) {
        setLoginError('Wpisz hasło.')
        return
      }
      const email = username.toLowerCase().endsWith('@krcenter.pl')
        ? username.toLowerCase()
        : `${username.toLowerCase()}@krcenter.pl`
      touchSession()
      setLoginSubmitting(true)
      try {
        const { data: rateCheck, error: rateErr } = await supabase.rpc('check_login_rate_limit', {
          p_email: email,
        })
        if (rateErr) {
          console.error('Rate limit check error:', rateErr)
        } else if ((rateCheck as RateLimitRow[])?.[0]?.r_blocked) {
          const seconds = (rateCheck as RateLimitRow[])[0].r_seconds_until_unlock ?? 0
          const minutes = Math.ceil(seconds / 60)
          setLoginError(`Za dużo nieudanych prób. Poczekaj ${minutes} min i spróbuj ponownie.`)
          return
        }

        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: loginPassword,
        })

        // Konto wyłączone przez admina (ban) / limit Supabase na IP — to nie
        // "złe hasło", więc bez liczenia próby i z własnym komunikatem
        if (error?.code === 'user_banned') {
          setLoginError('To konto jest zablokowane. Zgłoś to kierownikowi.')
          return
        }
        if (error?.status === 429) {
          setLoginError('Za dużo prób logowania z tego komputera. Poczekaj kilka minut.')
          return
        }

        // Błąd SIECI (brak neta, 5xx) to NIE nieudane logowanie — 5 prób na
        // słabym WiFi blokowało konto na 15 min mimo dobrego hasła
        const isCredentialError = !!error && error.status === 400
        const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null
        if (!error || isCredentialError) {
          await supabase.rpc('log_login_attempt', {
            p_email: email,
            p_success: !error,
            p_user_agent: userAgent ? userAgent.slice(0, 300) : null,
          })
        }

        if (error && !isCredentialError) {
          setLoginError('Brak połączenia z internetem. Sprawdź sieć i spróbuj ponownie.')
          return
        }
        if (error) {
          const { data: postCheck } = await supabase.rpc('check_login_rate_limit', {
            p_email: email,
          })
          const failedAttempts = (postCheck as RateLimitRow[])?.[0]?.r_failed_attempts ?? 0
          const remainingAttempts = Math.max(0, 5 - failedAttempts)
          if ((postCheck as RateLimitRow[])?.[0]?.r_blocked) {
            const minutes = Math.ceil(
              ((postCheck as RateLimitRow[])[0].r_seconds_until_unlock ?? 0) / 60,
            )
            setLoginError(`Za dużo nieudanych prób. Konto „${username}" jest zablokowane na ${minutes} min.`)
          } else if (remainingAttempts > 0 && remainingAttempts <= 3) {
            setLoginError(
              `Zła nazwa użytkownika albo hasło (sprawdź, czy to na pewno TWÓJ login: „${username}"). Pozostało prób: ${remainingAttempts}.`,
            )
          } else {
            setLoginError(`Zła nazwa użytkownika albo hasło. Sprawdź, czy to na pewno TWÓJ login: „${username}".`)
          }
          return
        }

        setLoginPassword('')
      } finally {
        setLoginSubmitting(false)
      }
    },
    [loginUsername, loginPassword, touchSession],
  )

  const handleSignOut = useCallback(async () => {
    touchSession()
    // scope:'local' — wyloguj TEN komputer, nie wszystkie stanowiska konta
    await supabase.auth.signOut({ scope: 'local' })
  }, [touchSession])

  const handleExtendSession = useCallback(() => {
    touchSession()
    void supabase.auth.getSession()
  }, [touchSession])

  const handleAutoLogout = useCallback(async () => {
    await supabase.auth.signOut({ scope: 'local' })
    setSessionWarningOpen(false)
    pushToast('Zostałeś automatycznie wylogowany z powodu braku aktywności', 'error')
  }, [pushToast])

  return {
    authSession,
    authReady,
    currentUser,
    loginUsername,
    setLoginUsername,
    loginPassword,
    setLoginPassword,
    loginSubmitting,
    loginError,
    clearLoginError: () => setLoginError(null),
    sessionWarningOpen,
    touchSession,
    handleLoginSubmit,
    handleSignOut,
    handleExtendSession,
    handleAutoLogout,
    reloadProfile: loadProfile,
    profileError,
  }
}
