// =====================================================================
// Dostęp do modułu „CRM Po Drzwi” (brief 14.11.2026).
// JEDYNE źródło prawdy: rpc current_user_has_crm() — true dla superadmina albo
// osoby z wpisem w crm.dostep. Celowo NIE patrzymy na role === 'admin':
// zwykły admin bez wpisu nie widzi zakładki w ogóle (decyzja właściciela).
// Brak funkcji w bazie (migracja nie weszła) albo brak uprawnień = false, bez
// komunikatów — aplikacja ma działać także przed migracją.
// =====================================================================
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

const QUIET_CODES = new Set(['PGRST202', '42501', '42883'])

export async function fetchHasCrmAccess(): Promise<boolean> {
  const { data, error } = await supabase.rpc('current_user_has_crm')
  if (error) {
    if (!QUIET_CODES.has(String(error.code ?? ''))) console.warn('current_user_has_crm:', error.message)
    return false
  }
  return data === true
}

/** true = pokazać zakładkę CRM Po Drzwi. Odpytuje raz na zalogowanego użytkownika. */
export function useCrmAccess(userId: string | null | undefined): { hasCrm: boolean; refreshCrmAccess: () => Promise<void> } {
  const [hasCrm, setHasCrm] = useState(false)

  const refreshCrmAccess = useCallback(async () => {
    if (!userId) {
      setHasCrm(false)
      return
    }
    setHasCrm(await fetchHasCrmAccess())
  }, [userId])

  useEffect(() => {
    let cancelled = false
    if (!userId) {
      setHasCrm(false)
      return
    }
    void fetchHasCrmAccess().then((v) => {
      if (!cancelled) setHasCrm(v)
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  return { hasCrm, refreshCrmAccess }
}
