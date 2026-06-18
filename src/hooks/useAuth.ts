import { useCallback, useEffect, useState } from 'react'
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
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginSubmitting, setLoginSubmitting] = useState(false)
  const [sessionLastActivity, setSessionLastActivity] = useState<number>(Date.now())
  const [sessionWarningOpen, setSessionWarningOpen] = useState(false)

  const touchSession = useCallback(() => {
    setSessionLastActivity(Date.now())
    setSessionWarningOpen(false)
  }, [])

  const loadProfile = useCallback(async (user: User) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
    if (error) {
      console.error(error)
      const fallbackProfile: CurrentUser = {
        id: user.id,
        email: user.email ?? '',
        initials: '',
        full_name: user.email ?? 'Użytkownik',
        role: '',
        department: 'all',
      }
      setCurrentUser(fallbackProfile)
      setSentryUserFromProfile(fallbackProfile)
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
    }
    setCurrentUser(profile)
    setSentryUserFromProfile(profile)
  }, [])

  // Inicjalizacja sesji + nasłuch zmian
  useEffect(() => {
    let cancelled = false
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
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
      setAuthSession(session)
      if (session) {
        touchSession()
        void loadProfile(session.user)
      } else {
        clearSentryUserContext()
        setCurrentUser(null)
        setLoginPassword('')
        onLogout()
      }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-logout po braku aktywności
  useEffect(() => {
    if (!authSession) return
    const interval = setInterval(() => {
      const now = Date.now()
      const elapsed = now - sessionLastActivity
      if (elapsed >= SESSION_TIMEOUT_MS) {
        void (async () => {
          await supabase.auth.signOut()
          setSessionWarningOpen(false)
          pushToast('Zostałeś automatycznie wylogowany z powodu braku aktywności', 'error')
        })()
      } else if (elapsed >= SESSION_WARNING_MS && !sessionWarningOpen) {
        setSessionWarningOpen(true)
      }
    }, 10_000)
    return () => clearInterval(interval)
  }, [authSession, sessionLastActivity, sessionWarningOpen, pushToast])

  const handleLoginSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      const username = loginUsername.trim()
      if (!username) {
        pushToast('Podaj nazwę użytkownika', 'error')
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
          pushToast(
            `Zbyt wiele nieudanych prób logowania. Spróbuj ponownie za ${minutes} min.`,
            'error',
          )
          return
        }

        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: loginPassword,
        })

        const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null
        await supabase.rpc('log_login_attempt', {
          p_email: email,
          p_success: !error,
          p_user_agent: userAgent,
        })

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
            pushToast(
              `Zbyt wiele nieudanych prób. Konto zablokowane na ${minutes} min.`,
              'error',
            )
          } else if (remainingAttempts > 0 && remainingAttempts <= 3) {
            pushToast(
              `Nieprawidłowe dane logowania. Pozostało prób: ${remainingAttempts}.`,
              'error',
            )
          } else {
            pushToast('Nieprawidłowe dane logowania.', 'error')
          }
          return
        }

        setLoginPassword('')
      } finally {
        setLoginSubmitting(false)
      }
    },
    [loginUsername, loginPassword, pushToast, touchSession],
  )

  const handleSignOut = useCallback(async () => {
    touchSession()
    await supabase.auth.signOut()
  }, [touchSession])

  const handleExtendSession = useCallback(() => {
    touchSession()
    void supabase.auth.getSession()
  }, [touchSession])

  const handleAutoLogout = useCallback(async () => {
    await supabase.auth.signOut()
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
    sessionWarningOpen,
    touchSession,
    handleLoginSubmit,
    handleSignOut,
    handleExtendSession,
    handleAutoLogout,
    reloadProfile: loadProfile,
  }
}
