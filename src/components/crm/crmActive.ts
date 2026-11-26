// =====================================================================
// CRM: ekrany trzymane w pamięci (CrmView). Lista klientów, Do zrobienia,
// Oferty… i karty z historii „Wróć” nie są niszczone przy przejściu — tylko
// ukrywane. Powrót jest natychmiastowy (bez spinnera, z tym samym filtrem
// i przewinięciem), a dane dociągają się po cichu.
// =====================================================================
import { createContext, useContext, useEffect, useRef } from 'react'

/** true = ekran jest teraz widoczny (false = ukryty w pamięci) */
export const CrmActiveContext = createContext(true)

export function useCrmActive(): boolean {
  return useContext(CrmActiveContext)
}

/** Woła `fn`, gdy ukryty ekran znów staje się widoczny (np. „Wróć” do listy) — ciche odświeżenie danych. */
export function useOnCrmReshow(fn: () => void): void {
  const active = useContext(CrmActiveContext)
  const prev = useRef(active)
  const cb = useRef(fn)
  cb.current = fn
  useEffect(() => {
    if (active && !prev.current) cb.current()
    prev.current = active
  }, [active])
}
