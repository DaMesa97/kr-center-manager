import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { summarizePreview, type StockPreviewRow, type StockPreviewSummary } from '../lib/stockPreview'

const DEBOUNCE_MS = 700

/**
 * Podgląd braków magazynowych dla payloadu formularza (tryb TWORZENIA).
 * Debounce, ignoruje spóźnione odpowiedzi. payload=null → wyłączony.
 * NIGDY nie blokuje zapisu — tylko informuje (decyzja z briefu).
 */
export function useStockPreview(payload: Record<string, unknown> | null): {
  summary: StockPreviewSummary | null
  loading: boolean
} {
  const [summary, setSummary] = useState<StockPreviewSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const requestSeq = useRef(0)

  // stringify jako klucz zależności — payload to nowy obiekt co render
  const payloadKey = payload ? JSON.stringify(payload) : null

  useEffect(() => {
    if (!payloadKey) {
      setSummary(null)
      setLoading(false)
      return
    }
    const seq = ++requestSeq.current
    setLoading(true)
    const timer = window.setTimeout(async () => {
      const { data, error } = await supabase.rpc('preview_order_stock', {
        p_payload: JSON.parse(payloadKey),
      })
      if (seq !== requestSeq.current) return // spóźniona odpowiedź
      setLoading(false)
      if (error || !data) {
        // podgląd to bonus — błąd nie może przeszkadzać w pracy
        console.error('preview_order_stock error:', error)
        setSummary(null)
        return
      }
      setSummary(summarizePreview(data as StockPreviewRow[]))
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [payloadKey])

  return { summary, loading }
}
