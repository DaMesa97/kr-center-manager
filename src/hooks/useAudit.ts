import { useCallback, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import type { AuditFilters, AuditLogRow } from '../types'
import type { ToastVariant } from '../types'

type UseAuditParams = {
  pushToast: (msg: string, variant: ToastVariant) => void
  touchSession: () => void
}

export function useAudit({ pushToast, touchSession }: UseAuditParams) {
  const [auditLog, setAuditLog] = useState<AuditLogRow[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditFilters, setAuditFilters] = useState<AuditFilters>({})
  const fetchVersionRef = useRef(0)

  const fetchAuditLog = useCallback(
    async (filters: AuditFilters = {}) => {
      touchSession()
      const version = ++fetchVersionRef.current
      setAuditLoading(true)
      let query = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(1000)

      if (filters.table) query = query.eq('table_name', filters.table)
      if (filters.operation) query = query.eq('operation', filters.operation)
      if (filters.userId) query = query.eq('user_id', filters.userId)
      if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom)
      // dateTo: created_at to timestamp — dopełnij do końca dnia, inaczej cały dzień wypada
      if (filters.dateTo) query = query.lte('created_at', `${filters.dateTo}T23:59:59.999`)

      const { data, error } = await query
      // Ignoruj wynik jeśli w międzyczasie poleciało nowsze zapytanie (zmiana filtra)
      if (version !== fetchVersionRef.current) return
      setAuditLoading(false)

      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }

      let filtered = (data ?? []) as AuditLogRow[]
      if (filters.searchQuery) {
        const q = filters.searchQuery.toLowerCase()
        filtered = filtered.filter(
          (r) =>
            r.record_id?.toLowerCase().includes(q) ||
            r.user_email?.toLowerCase().includes(q) ||
            r.changed_fields?.some((f) => f.toLowerCase().includes(q)),
        )
      }

      setAuditLog(filtered)
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
