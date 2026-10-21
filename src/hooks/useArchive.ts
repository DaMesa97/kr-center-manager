import { useCallback, useState } from 'react'
import { supabase } from '../supabaseClient'
import { fetchAllPages } from '../lib/fetchPaged'
import type { ArchivedOrder, ArchiveRunLog } from '../types'
import type { ToastVariant } from '../types'

type UseArchiveParams = {
  pushToast: (msg: string, variant: ToastVariant) => void
  touchSession: () => void
}

/** Ile najnowszych zarchiwizowanych wczytujemy do przeglądania; starsze ArchiveView dociąga szukajką z serwera */
export const ARCHIVE_LOAD_MAX = 5000

export function useArchive({ pushToast, touchSession }: UseArchiveParams) {
  const [archivedOrders, setArchivedOrders] = useState<ArchivedOrder[]>([])
  const [archivedOrdersLoading, setArchivedOrdersLoading] = useState(false)
  const [archiveRunLogs, setArchiveRunLogs] = useState<ArchiveRunLog[]>([])

  const fetchArchivedOrders = useCallback(async () => {
    touchSession()
    setArchivedOrdersLoading(true)
    // Porcjami po 1000 (PostgREST max_rows) — stary .limit(2000) dawał max 1000
    const [{ data: ordersData, error: ordersErr }, { data: logsData }] = await Promise.all([
      fetchAllPages<ArchivedOrder>(
        (from, to) =>
          supabase
            .from('orders_archive')
            .select('*')
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to)
            .overrideTypes<ArchivedOrder[], { merge: false }>(),
        { max: ARCHIVE_LOAD_MAX },
      ),
      supabase.from('archive_run_log').select('*').order('run_at', { ascending: false }).limit(30),
    ])
    setArchivedOrdersLoading(false)

    if (ordersErr) {
      pushToast(`Błąd: ${ordersErr.message}`, 'error')
      return
    }

    setArchivedOrders(ordersData)
    setArchiveRunLogs((logsData ?? []) as ArchiveRunLog[])
  }, [pushToast, touchSession])

  return {
    archivedOrders,
    setArchivedOrders,
    archivedOrdersLoading,
    setArchivedOrdersLoading,
    archiveRunLogs,
    setArchiveRunLogs,
    fetchArchivedOrders,
  }
}
