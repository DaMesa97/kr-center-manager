import { useState, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import type { ApiKey, ToastVariant } from '../types'

type UseApiKeysParams = {
  pushToast: (msg: string, variant: ToastVariant) => void
  touchSession: () => void
}

type GenerateModalState = {
  open: boolean
  name: string
  rateLimit: number
  saving: boolean
  generatedKey: string | null
}

const INITIAL_GENERATE_MODAL: GenerateModalState = {
  open: false,
  name: '',
  rateLimit: 60,
  saving: false,
  generatedKey: null,
}

type ApiKeyFilter = 'all' | 'active' | 'inactive'

export function useApiKeys({ pushToast, touchSession }: UseApiKeysParams) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<ApiKeyFilter>('all')
  const [generateModal, setGenerateModal] = useState<GenerateModalState>(INITIAL_GENERATE_MODAL)
  const [deactivatingId, setDeactivatingId] = useState<number | null>(null)

  const fetchApiKeys = useCallback(async () => {
    touchSession()
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('integration_api_keys')
        .select('id, name, key_prefix, is_active, rate_limit_per_minute, total_requests, total_orders_created, last_used_at, created_at')
        .order('created_at', { ascending: false })

      if (error) {
        pushToast(`Błąd pobierania kluczy API: ${error.message}`, 'error')
        return
      }
      setApiKeys((data as ApiKey[]) ?? [])
    } finally {
      setLoading(false)
    }
  }, [touchSession, pushToast])

  const handleGenerateKey = useCallback(async () => {
    if (generateModal.saving) return // guard double-submit
    if (!generateModal.name.trim()) {
      pushToast('Podaj nazwę klucza', 'error')
      return
    }
    touchSession()
    setGenerateModal((p) => ({ ...p, saving: true }))
    try {
      const { data, error } = await supabase.rpc('generate_api_key', {
        p_name: generateModal.name.trim(),
        p_rate_limit: generateModal.rateLimit,
      })

      if (error) {
        pushToast(`Błąd generowania klucza: ${error.message}`, 'error')
        return
      }

      const rawKey = typeof data === 'string' ? data : (data as { raw_key?: string })?.raw_key ?? null
      if (!rawKey) {
        pushToast('Klucz wygenerowany, ale serwer nie zwrócił wartości. Sprawdź bazę.', 'info')
        setGenerateModal(INITIAL_GENERATE_MODAL)
        await fetchApiKeys()
        return
      }

      setGenerateModal((p) => ({ ...p, saving: false, generatedKey: rawKey }))
      await fetchApiKeys()
      pushToast('Klucz API wygenerowany — skopiuj go teraz, nie zostanie pokazany ponownie!', 'success')
    } catch (err) {
      pushToast(`Nieoczekiwany błąd: ${String(err)}`, 'error')
      setGenerateModal((p) => ({ ...p, saving: false }))
    }
  }, [generateModal.name, generateModal.rateLimit, touchSession, pushToast, fetchApiKeys])

  const handleSetActive = useCallback(
    async (id: number, active: boolean) => {
      touchSession()
      setDeactivatingId(id)
      try {
        const { error } = await supabase
          .from('integration_api_keys')
          .update({ is_active: active })
          .eq('id', id)

        if (error) {
          pushToast(`Błąd: ${error.message}`, 'error')
          return
        }
        pushToast(active ? 'Klucz reaktywowany' : 'Klucz dezaktywowany', 'success')
        await fetchApiKeys()
      } finally {
        setDeactivatingId(null)
      }
    },
    [touchSession, pushToast, fetchApiKeys],
  )

  const filteredApiKeys = apiKeys.filter((k) => {
    if (filter === 'active') return k.is_active
    if (filter === 'inactive') return !k.is_active
    return true
  })

  const openGenerateModal = useCallback(() => {
    setGenerateModal({ ...INITIAL_GENERATE_MODAL, open: true })
  }, [])

  const closeGenerateModal = useCallback(() => {
    setGenerateModal(INITIAL_GENERATE_MODAL)
  }, [])

  return {
    apiKeys,
    filteredApiKeys,
    loading,
    filter,
    setFilter,
    generateModal,
    setGenerateModal,
    deactivatingId,
    fetchApiKeys,
    handleGenerateKey,
    handleSetActive,
    openGenerateModal,
    closeGenerateModal,
  }
}
