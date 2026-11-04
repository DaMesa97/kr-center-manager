import { useCallback, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { appConfirm } from '../lib/appDialogs'
import { fnErrorMessage } from '../lib/fnError'
import type { ToastVariant } from '../types'

type Params = {
  pushToast: (msg: string, variant: ToastVariant) => void
  enabled: boolean
}

type RetryTarget = { id: number; order_number?: string | null; category?: string | null }

/**
 * „Ponów wysyłkę do Optimy": edge function erp-retry → webhook Make (adres w
 * Ustawienia → Integracje → Make / Optima). Kolumn erp_* nie dotykamy — status wróci od Make.
 * Blokada 30 s na zlecenie, żeby dwuklik nie założył RO dwa razy.
 */
export function useErpRetry({ pushToast, enabled }: Params) {
  const [retryingId, setRetryingId] = useState<number | null>(null)
  const lastSent = useRef<Map<number, number>>(new Map())

  const retryErp = useCallback(
    async (target: RetryTarget): Promise<boolean> => {
      if (!enabled) {
        pushToast('Ponowić wysyłkę do Optimy może kierownik.', 'error')
        return false
      }
      const since = Date.now() - (lastSent.current.get(target.id) ?? 0)
      if (since < 30_000) {
        pushToast(`Wysyłka dla ${target.order_number ?? target.id} poszła ${Math.round(since / 1000)} s temu — poczekaj na odpowiedź Make.`, 'error')
        return false
      }
      const ok = await appConfirm(
        `Wysłać zlecenie ${target.order_number ?? target.id}${target.category ? ` (${target.category})` : ''} ponownie do Optimy?\n\nMake spróbuje założyć RO jeszcze raz. Jeśli przyczyna błędu (np. brak towaru w kartotece Optimy) nie została usunięta, wróci ten sam błąd.`,
        { title: 'Ponów wysyłkę do Optimy', confirmLabel: 'Wyślij ponownie' },
      )
      if (!ok) return false
      setRetryingId(target.id)
      try {
        const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>('erp-retry', {
          body: { order_id: target.id },
        })
        if (error) {
          pushToast(await fnErrorMessage(error, 'Nie udało się ponowić wysyłki'), 'error')
          return false
        }
        if (data && typeof data === 'object' && 'error' in data && data.error) {
          pushToast(String(data.error), 'error')
          return false
        }
        lastSent.current.set(target.id, Date.now())
        pushToast(
          `Wysłano ponownie do Optimy: ${target.order_number ?? target.id}. Status przy zleceniu odświeży się, gdy Make odpowie (zwykle do minuty).`,
          'success',
        )
        return true
      } finally {
        setRetryingId(null)
      }
    },
    [enabled, pushToast],
  )

  return { retryErp, retryingId }
}
