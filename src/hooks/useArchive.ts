import { useCallback, useState } from 'react'
import { supabase } from '../supabaseClient'
import type { ArchivedOrder, ArchiveRunLog } from '../types'
import type { ToastVariant } from '../types'

type UseArchiveParams = {
  pushToast: (msg: string, variant: ToastVariant) => void
  touchSession: () => void
}

export function useArchive({ pushToast, touchSession }: UseArchiveParams) {
  const [archivedOrders, setArchivedOrders] = useState<ArchivedOrder[]>([])
  const [archivedOrdersLoading, setArchivedOrdersLoading] = useState(false)
  const [archiveRunLogs, setArchiveRunLogs] = useState<ArchiveRunLog[]>([])

  const fetchArchivedOrders = useCallback(async () => {
    touchSession()
    setArchivedOrdersLoading(true)
    const [{ data: ordersData, error: ordersErr }, { data: logsData }] = await Promise.all([
      supabase.from('orders_archive').select('*').order('created_at', { ascending: false }).limit(2000),
      supabase.from('archive_run_log').select('*').order('run_at', { ascending: false }).limit(30),
    ])
    setArchivedOrdersLoading(false)

    if (ordersErr) {
      pushToast(`Błąd: ${ordersErr.message}`, 'error')
      return
    }

    setArchivedOrders((ordersData ?? []) as ArchivedOrder[])
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
