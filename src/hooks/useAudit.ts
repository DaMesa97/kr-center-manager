import { useCallback, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { fetchAllPages } from '../lib/fetchPaged'
import { localDayEndExclusiveIso, localDayStartIso } from '../lib/localDates'
import type { AuditFilters, AuditLogRow } from '../types'
import type { ToastVariant } from '../types'

type UseAuditParams = {
  pushToast: (msg: string, variant: ToastVariant) => void
  touchSession: () => void
}

/** Filtry audytu + sterowanie widokiem (bez zmian w types/App — to nadzbiór AuditFilters) */
export type AuditQueryFilters = AuditFilters & {
  /** true = pokaż też wpisy systemowe (user_id NULL: triggery, mirrory, Edge Functions) */
  showSystem?: boolean
  /** ile najnowszych wpisów pobrać („Załaduj więcej" zwiększa) */
  limit?: number
}

export const AUDIT_PAGE_SIZE = 500

/** Fraza do filtra `or=(…)` PostgREST — w cudzysłowie, bez znaków składni */
function orValue(q: string): string {
  return `"*${q.replace(/["\\*]/g, '')}*"`
}

export function useAudit({ pushToast, touchSession }: UseAuditParams) {
  const [auditLog, setAuditLog] = useState<AuditLogRow[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditFilters, setAuditFilters] = useState<AuditQueryFilters>({})
  const fetchVersionRef = useRef(0)

  const fetchAuditLog = useCallback(
    async (filters: AuditQueryFilters = {}) => {
      touchSession()
      const version = ++fetchVersionRef.current
      setAuditLoading(true)
      const limit = Math.max(1, filters.limit ?? AUDIT_PAGE_SIZE)
      const q = filters.searchQuery?.trim() ?? ''

      // Wszystko po stronie serwera — wcześniej szukajka i filtry działały
      // tylko na 1000 wczytanych wierszach (z czego ~97% to wpisy systemowe)
      const { data, error } = await fetchAllPages<AuditLogRow>(
        (from, to) => {
          let query = supabase
            .from('audit_log')
            .select('*')
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })

          if (!filters.showSystem) query = query.not('user_id', 'is', null)
          if (filters.table) query = query.eq('table_name', filters.table)
          if (filters.operation) query = query.eq('operation', filters.operation)
          if (filters.userId) query = query.eq('user_id', filters.userId)
          // created_at to timestamptz — granice dnia wg czasu lokalnego
          if (filters.dateFrom) query = query.gte('created_at', localDayStartIso(filters.dateFrom))
          if (filters.dateTo) query = query.lt('created_at', localDayEndExclusiveIso(filters.dateTo))
          if (q) {
            const v = orValue(q)
            const parts = [
              `record_id.ilike.${v}`,
              `user_email.ilike.${v}`,
              `new_data->>order_number.ilike.${v}`,
              `old_data->>order_number.ilike.${v}`,
            ]
            // nazwa pola (np. production_stages) — dokładne trafienie w changed_fields
            if (/^[a-z_]+$/i.test(q)) parts.push(`changed_fields.cs.{${q}}`)
            query = query.or(parts.join(','))
          }
          return query.range(from, to).overrideTypes<AuditLogRow[], { merge: false }>()
        },
        { max: limit },
      )

      // Ignoruj wynik jeśli w międzyczasie poleciało nowsze zapytanie (zmiana filtra)
      if (version !== fetchVersionRef.current) return
      setAuditLoading(false)

      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }

      setAuditLog(data)
    },
    [pushToast, touchSession],
  )

  return {
    auditLog,
    setAuditLog,
    auditLoading,
    setAuditLoading,
    auditFilters,
    setAuditFilters,
    fetchAuditLog,
  }
}
