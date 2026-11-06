import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { countCompletedStages } from '../utils'
import type { Order } from '../types'

/**
 * Synchronizacja wydań z Excela (zgłoszenie #116): backend żyje w chmurze —
 * Make co godzinę czyta pliki „Zamówienia *.xlsm" z OneDrive, edge function
 * `excel-sync` woła RPC `sync_releases_from_excel`, a wynik każdego przebiegu
 * ląduje w `excel_sync_runs` (osobny wiersz per plik/kategoria). Aplikacja
 * NICZEGO tu nie liczy: czyta ostatni przebieg każdej kategorii i pokazuje
 * to, czego automat nie rozstrzygnął (duplikaty, anulowane w Excelu, inne).
 * Zasada przy duplikatach: zostaje zlecenie z BOTA, kopię z Excela anulować.
 */

export type ExcelSyncStatus = 'duplikat' | 'anulowane_w_excelu' | 'inne' | 'do_zamkniecia' | 'w_realizacji' | 'zamknieto'

export type ExcelSyncItem = {
  id: number
  order_number: string
  category: string
  company: string | null
  model: string | null
  order_date: string | null
  /** np. „Center 2493" — arkusz + numer wiersza w Excelu */
  excel_row: string | null
  /** jak dopasowano: „airtable", „nr klienta + model", … */
  how: string | null
  /** data wydania z arkusza, „ANULOWANE", „WSTRZYMANE", … */
  wydanie: string | null
  status: ExcelSyncStatus | string
  powiazane_id: number[] | null
  data_szacunkowa?: boolean
}

export type ExcelSyncRun = {
  id: number
  created_at: string
  source: string | null
  kategoria: string
  summary: Record<string, unknown>
  items: ExcelSyncItem[]
}

/** Skrót zlecenia z bazy do kart w grupie duplikatów */
export type ExcelSyncOrderInfo = {
  id: number
  order_number: string
  category: string
  company: string | null
  model: string | null
  source: string | null
  created_at: string | null
  release_date: string | null
  stock_status: string | null
  cancelled: boolean
  stagesDone: number
  stagesTotal: number
}

export type ExcelSyncDuplicateGroup = {
  key: string
  excel_row: string
  category: string
  company: string | null
  model: string | null
  wydanie: string | null
  /** zlecenia w grupie (z bazy), bez anulowanych */
  orders: ExcelSyncOrderInfo[]
}

export type ExcelSyncState = {
  loading: boolean
  error: string | null
  runs: ExcelSyncRun[]
  /** najnowszy przebieg spośród kategorii */
  lastSyncAt: string | null
  /** true, gdy najnowszy przebieg starszy niż 3 h (Make co godzinę) */
  stale: boolean
  duplicates: ExcelSyncDuplicateGroup[]
  cancelledInExcel: Array<ExcelSyncItem & { order: ExcelSyncOrderInfo | null }>
  other: Array<ExcelSyncItem & { order: ExcelSyncOrderInfo | null }>
  /** liczba rzeczy do decyzji (do plakietki) */
  openCount: number
  refresh: () => Promise<void>
}

const ACTION_STATUSES = new Set(['duplikat', 'anulowane_w_excelu', 'inne'])
const STALE_MS = 3 * 60 * 60 * 1000
const REFRESH_MS = 5 * 60 * 1000

function toInfo(row: Record<string, unknown>): ExcelSyncOrderInfo {
  const ef = (row.extra_fields ?? null) as Record<string, unknown> | null
  const { completed, total } = countCompletedStages(row as unknown as Order)
  return {
    id: Number(row.id),
    order_number: String(row.order_number ?? ''),
    category: String(row.category ?? ''),
    company: (row.company as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    source: (row.source as string | null) ?? null,
    created_at: (row.created_at as string | null) ?? null,
    release_date: (row.release_date as string | null) ?? null,
    stock_status: (row.stock_status as string | null) ?? null,
    cancelled: ef?.cancelled === true || ef?.cancelled === 'true',
    stagesDone: completed,
    stagesTotal: total,
  }
}

export function useExcelSync(enabled: boolean): ExcelSyncState {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runs, setRuns] = useState<ExcelSyncRun[]>([])
  const [ordersById, setOrdersById] = useState<Map<number, ExcelSyncOrderInfo>>(new Map())
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError(null)
    try {
      // ostatnie przebiegi; per kategoria bierzemy najnowszy (Make robi 7 plików naraz)
      const { data, error: runErr } = await supabase
        .from('excel_sync_runs')
        .select('id, created_at, source, summary, details')
        .eq('dry_run', false)
        .order('id', { ascending: false })
        .limit(21)
      if (runErr) throw runErr
      const latest = new Map<string, ExcelSyncRun>()
      for (const r of (data ?? []) as Array<Record<string, unknown>>) {
        const summary = (r.summary ?? {}) as Record<string, unknown>
        const kategoria = String(summary.kategoria ?? '?')
        if (latest.has(kategoria)) continue
        const details = Array.isArray(r.details) ? (r.details as ExcelSyncItem[]) : []
        latest.set(kategoria, {
          id: Number(r.id),
          created_at: String(r.created_at),
          source: (r.source as string | null) ?? null,
          kategoria,
          summary,
          items: details.filter((it) => ACTION_STATUSES.has(String(it.status))),
        })
      }
      const runList = [...latest.values()].sort((a, b) => a.kategoria.localeCompare(b.kategoria, 'pl'))

      // zlecenia z grup — z bazy, żeby pokazać źródło, postęp i czy już anulowane
      const ids = new Set<number>()
      for (const run of runList) {
        for (const it of run.items) {
          ids.add(Number(it.id))
          for (const pid of it.powiazane_id ?? []) ids.add(Number(pid))
        }
      }
      const infos = new Map<number, ExcelSyncOrderInfo>()
      const idList = [...ids]
      for (let i = 0; i < idList.length; i += 200) {
        const chunk = idList.slice(i, i + 200)
        const { data: rows, error: oErr } = await supabase
          .from('orders')
          .select('id, order_number, category, company, model, source, created_at, release_date, stock_status, production_stages, extra_fields')
          .in('id', chunk)
        if (oErr) throw oErr
        for (const row of (rows ?? []) as Array<Record<string, unknown>>) {
          const info = toInfo(row)
          infos.set(info.id, info)
        }
      }
      if (!mounted.current) return
      setRuns(runList)
      setOrdersById(infos)
    } catch (e) {
      if (!mounted.current) return
      setError((e as Error).message)
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    mounted.current = true
    void refresh()
    const t = setInterval(() => void refresh(), REFRESH_MS)
    return () => {
      mounted.current = false
      clearInterval(t)
    }
  }, [refresh])

  const derived = useMemo(() => deriveExcelSync(runs, ordersById), [runs, ordersById])

  return { loading, error, runs, refresh, ...derived }
}

/**
 * Czysta część logiki (testowalna): z ostatnich przebiegów i zleceń z bazy
 * buduje listy do decyzji. Zasady:
 *  - grupa duplikatów = jeden wiersz Excela → kilka zleceń; znika, gdy zostało ≤ 1 otwarte;
 *  - w grupie pierwsze jest zlecenie z BOTA (to ono zostaje), potem po dacie utworzenia;
 *  - „anulowane w Excelu" znika, gdy zlecenie jest już anulowane w aplikacji;
 *  - „inne" znika, gdy zlecenie jest anulowane albo wydane.
 */
export function deriveExcelSync(
  runs: ExcelSyncRun[],
  ordersById: Map<number, ExcelSyncOrderInfo>,
  now: number = Date.now(),
): Pick<ExcelSyncState, 'lastSyncAt' | 'stale' | 'duplicates' | 'cancelledInExcel' | 'other' | 'openCount'> {
  {
    const lastSyncAt = runs.reduce<string | null>((acc, r) => (!acc || r.created_at > acc ? r.created_at : acc), null)
    const stale = lastSyncAt ? now - new Date(lastSyncAt).getTime() > STALE_MS : false

    const groups = new Map<string, ExcelSyncDuplicateGroup>()
    const cancelledInExcel: ExcelSyncState['cancelledInExcel'] = []
    const other: ExcelSyncState['other'] = []

    for (const run of runs) {
      for (const it of run.items) {
        const order = ordersById.get(Number(it.id)) ?? null
        if (it.status === 'duplikat') {
          const rowKey = `${run.kategoria}|${it.excel_row ?? `#${it.id}`}`
          let g = groups.get(rowKey)
          if (!g) {
            g = {
              key: rowKey,
              excel_row: it.excel_row ?? '—',
              category: it.category,
              company: it.company,
              model: it.model,
              wydanie: it.wydanie,
              orders: [],
            }
            groups.set(rowKey, g)
          }
          const members = [Number(it.id), ...(it.powiazane_id ?? []).map(Number)]
          for (const id of members) {
            const info = ordersById.get(id)
            if (!info || info.cancelled) continue
            if (!g.orders.some((o) => o.id === id)) g.orders.push(info)
          }
        } else if (it.status === 'anulowane_w_excelu') {
          // już anulowane w aplikacji = załatwione
          if (order && order.cancelled) continue
          cancelledInExcel.push({ ...it, order })
        } else if (it.status === 'inne') {
          if (order && (order.cancelled || order.release_date)) continue
          other.push({ ...it, order })
        }
      }
    }

    // grupa jest problemem tylko dopóki żyje w niej więcej niż jedno zlecenie
    const duplicates = [...groups.values()]
      .filter((g) => g.orders.length > 1)
      .map((g) => ({
        ...g,
        orders: [...g.orders].sort((a, b) => {
          // bot na początek (ten zostaje), potem po dacie utworzenia
          const sa = a.source === 'bot' ? 0 : 1
          const sb = b.source === 'bot' ? 0 : 1
          if (sa !== sb) return sa - sb
          return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
        }),
      }))
      .sort((a, b) => a.category.localeCompare(b.category, 'pl') || a.excel_row.localeCompare(b.excel_row, 'pl'))

    return {
      lastSyncAt,
      stale,
      duplicates,
      cancelledInExcel,
      other,
      openCount: duplicates.length + cancelledInExcel.length + other.length,
    }
  }
}
