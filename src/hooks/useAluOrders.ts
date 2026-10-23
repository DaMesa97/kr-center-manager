import { useCallback, useState } from 'react'
import { supabase } from '../supabaseClient'
import { fetchAllPages } from '../lib/fetchPaged'
import { ORDER_DOCUMENTS_BUCKET } from '../constants'
import type {
  AluLpParseResult,
  AluLpPosition,
  AluPosition,
  AluRealizacja,
  OrderDocument,
  OrderDocumentKind,
  ToastVariant,
} from '../types'

// Stolarka aluminiowa: pozycje LP (order_alu_positions) + PDF-y LP/LC
// (order_documents, prywatny bucket order-documents). Zapisy idą przez RPC
// z guardem kierownika (import_alu_order, attach_order_document) — RLS tabel
// wpuszcza zalogowanych tylko do odczytu.

type UseAluOrdersParams = {
  pushToast: (msg: string, variant: ToastVariant) => void
  touchSession: () => void
}

export type AluImportMode = 'check' | 'overwrite' | 'duplicate'
export type AluImportResultKind = 'created' | 'overwritten' | 'exists'

export type AluImportOptions = {
  company: string
  /** YYYY-MM-DD */
  deadline: string
  realizacja: AluRealizacja
  mode: AluImportMode
}

export type AluImportResult = {
  orderId: number
  result: AluImportResultKind
  orderNumber: string
}

/** Wiersz z find_alu_order — do dopinania listy cięcia do zlecenia */
export type AluFoundOrder = {
  id: number
  order_number: string
  company: string
  /** YYYY-MM-DD albo null (nie wydane) */
  release_date: string | null
}

type ImportRpcRow = { r_order_id: number; r_result: string; r_order_number: string }
type AttachRpcRow = { r_document_id: number; r_replaced_storage_path: string | null }
type FindRpcRow = { r_order_id: number; r_order_number: string; r_company: string | null; r_release_date: string | null }

/** Ile id zleceń na jedno zapytanie `.in('order_id', …)` (długość URL PostgREST) */
const ORDER_ID_CHUNK = 200

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function isImportResultKind(v: string): v is AluImportResultKind {
  return v === 'created' || v === 'overwritten' || v === 'exists'
}

/** Pozycja LP bez `warnings` parsera — dokładnie to, co bierze import_alu_order */
function toRpcPosition(p: AluLpPosition): Omit<AluLpPosition, 'warnings'> {
  return {
    pos_no: p.pos_no,
    description: p.description,
    construction_type: p.construction_type,
    system: p.system,
    profile_color: p.profile_color,
    hardware_color: p.hardware_color,
    fillings: p.fillings,
    width_mm: p.width_mm,
    height_mm: p.height_mm,
    quantity: p.quantity,
    weight_kg: p.weight_kg,
    u_value: p.u_value,
    notes: p.notes,
    glass: p.glass,
  }
}

type ShellIpc = { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }

/**
 * Otwiera https-URL w systemowej przeglądarce. W Electronie przez IPC
 * `shell:open-external` (main.ts: shell.openExternal, tylko https://);
 * w przeglądarce / dev bez preloadu — window.open. Zwraca false, gdy się nie udało.
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  const ipc = (window as Window & { ipcRenderer?: ShellIpc }).ipcRenderer
  if (ipc) {
    try {
      const ok = await ipc.invoke('shell:open-external', url)
      if (ok === true) return true
      if (ok === false) return false
    } catch {
      // brak handlera (stary main) — spadamy do window.open
    }
  }
  const win = window.open(url, '_blank', 'noopener,noreferrer')
  return win !== null
}

export function useAluOrders({ pushToast, touchSession }: UseAluOrdersParams) {
  const [aluPositionsByOrder, setAluPositionsByOrder] = useState<Record<number, AluPosition[]>>({})
  const [documentsByOrder, setDocumentsByOrder] = useState<Record<number, OrderDocument[]>>({})
  const [aluLoading, setAluLoading] = useState(false)

  /**
   * Pozycje i dokumenty podanych zleceń. Porcjami po 200 id, a w porcji
   * stronami `.range()` — PostgREST ucina do 1000 wierszy, a 200 zleceń × do
   * 100 konstrukcji to więcej. Zlecenia bez wierszy dostają puste listy
   * (żeby po nadpisaniu/usunięciu nie zostały stare dane).
   */
  const fetchAluData = useCallback(
    async (orderIds: number[]) => {
      const ids = Array.from(new Set(orderIds.filter((id) => Number.isFinite(id))))
      if (ids.length === 0) return
      touchSession()
      setAluLoading(true)

      const positions: AluPosition[] = []
      const documents: OrderDocument[] = []
      let errMsg: string | null = null

      for (const part of chunk(ids, ORDER_ID_CHUNK)) {
        const [posRes, docRes] = await Promise.all([
          fetchAllPages<AluPosition>((from, to) =>
            supabase
              .from('order_alu_positions')
              .select('*')
              .in('order_id', part)
              .order('order_id', { ascending: true })
              .order('pos_no', { ascending: true })
              .range(from, to)
              .overrideTypes<AluPosition[], { merge: false }>(),
          ),
          fetchAllPages<OrderDocument>((from, to) =>
            supabase
              .from('order_documents')
              .select('*')
              .in('order_id', part)
              .order('id', { ascending: true })
              .range(from, to)
              .overrideTypes<OrderDocument[], { merge: false }>(),
          ),
        ])
        if (posRes.error) {
          errMsg = posRes.error.message
          break
        }
        if (docRes.error) {
          errMsg = docRes.error.message
          break
        }
        positions.push(...posRes.data)
        documents.push(...docRes.data)
      }

      setAluLoading(false)
      if (errMsg) {
        pushToast(`Błąd wczytywania pozycji aluminium: ${errMsg}`, 'error')
        return
      }

      setAluPositionsByOrder((prev) => {
        const next = { ...prev }
        for (const id of ids) next[id] = []
        for (const p of positions) {
          const list = next[p.order_id] ?? (next[p.order_id] = [])
          list.push(p)
        }
        return next
      })
      setDocumentsByOrder((prev) => {
        const next = { ...prev }
        for (const id of ids) next[id] = []
        for (const d of documents) {
          // order_id bywa null (zlecenie skasowane → ON DELETE SET NULL) mimo typu number
          const oid = d.order_id as number | null
          if (oid === null) continue
          const list = next[oid] ?? (next[oid] = [])
          list.push(d)
        }
        return next
      })
    },
    [pushToast, touchSession],
  )

  /**
   * Import LP → RPC import_alu_order (zlecenie + pozycje w jednej transakcji).
   * mode 'check': istnieje → { result: 'exists' } i nic nie zmienia; nie → tworzy.
   * Błąd → toast + null.
   */
  const importAluOrder = useCallback(
    async (parsed: AluLpParseResult, opts: AluImportOptions): Promise<AluImportResult | null> => {
      touchSession()
      const header = {
        order_number: parsed.header.order_number,
        company: opts.company,
        lp_number: parsed.header.lp_number,
        lp_created_at: parsed.header.created_at,
        deadline: opts.deadline,
        realizacja: opts.realizacja,
        positions_count: parsed.header.positions_count,
        area_m2: parsed.header.area_m2,
        weight_kg: parsed.header.weight_kg,
        deadline_text: parsed.header.deadline_text,
      }
      const { data, error } = await supabase.rpc('import_alu_order', {
        p_header: header,
        p_positions: parsed.positions.map(toRpcPosition),
        p_mode: opts.mode,
      })
      if (error) {
        pushToast(`Import listy produkcyjnej nie powiódł się: ${error.message}`, 'error')
        return null
      }
      const row = (data as ImportRpcRow[] | null)?.[0]
      if (!row || !isImportResultKind(row.r_result)) {
        pushToast('Import listy produkcyjnej: baza nie zwróciła wyniku', 'error')
        return null
      }
      return { orderId: row.r_order_id, result: row.r_result, orderNumber: row.r_order_number }
    },
    [pushToast, touchSession],
  )

  /**
   * PDF do storage (`aluminium/<orderId>/<kind>_<timestamp>.pdf`), potem RPC
   * attach_order_document (upsert po order_id+kind). Poprzedni plik tego
   * rodzaju kasowany ze storage. Zwraca wiersz order_documents albo null.
   */
  const uploadOrderDocument = useCallback(
    async (
      orderId: number,
      kind: OrderDocumentKind,
      number: string | null,
      file: File | Blob,
      fileName: string,
    ): Promise<OrderDocument | null> => {
      touchSession()
      const bucket = supabase.storage.from(ORDER_DOCUMENTS_BUCKET)
      const path = `aluminium/${orderId}/${kind}_${Date.now()}.pdf`

      const { error: upErr } = await bucket.upload(path, file, { contentType: 'application/pdf', upsert: false })
      if (upErr) {
        pushToast(`Nie udało się wgrać pliku ${fileName}: ${upErr.message}`, 'error')
        return null
      }

      const { data, error } = await supabase.rpc('attach_order_document', {
        p_order_id: orderId,
        p_kind: kind,
        p_number: number,
        p_storage_path: path,
        p_file_name: fileName,
      })
      const row = (data as AttachRpcRow[] | null)?.[0]
      if (error || !row) {
        // plik już w storage, a wpisu brak — sprzątamy, żeby nie zostawiać sierot
        void bucket.remove([path])
        pushToast(`Nie udało się dopiąć dokumentu do zlecenia: ${error?.message ?? 'brak wyniku'}`, 'error')
        return null
      }

      if (row.r_replaced_storage_path) {
        const { error: rmErr } = await bucket.remove([row.r_replaced_storage_path])
        if (rmErr) pushToast(`Nowy plik zapisany, ale poprzedni nie został usunięty ze storage: ${rmErr.message}`, 'info')
      }

      const { data: docs, error: docErr } = await supabase
        .from('order_documents')
        .select('*')
        .eq('order_id', orderId)
        .order('id', { ascending: true })
        .overrideTypes<OrderDocument[], { merge: false }>()

      const fallback: OrderDocument = {
        id: row.r_document_id,
        order_id: orderId,
        kind,
        number,
        storage_path: path,
        file_name: fileName,
        uploaded_by: null,
        uploaded_at: new Date().toISOString(),
      }
      if (docErr || !docs) {
        setDocumentsByOrder((prev) => ({
          ...prev,
          [orderId]: [...(prev[orderId] ?? []).filter((d) => d.kind !== kind), fallback],
        }))
        return fallback
      }
      setDocumentsByOrder((prev) => ({ ...prev, [orderId]: docs }))
      return docs.find((d) => d.id === row.r_document_id) ?? fallback
    },
    [pushToast, touchSession],
  )

  /** Podpisany URL (10 min) i otwarcie PDF-u w systemowej przeglądarce */
  const openOrderDocument = useCallback(
    async (doc: OrderDocument) => {
      touchSession()
      const { data, error } = await supabase.storage
        .from(ORDER_DOCUMENTS_BUCKET)
        .createSignedUrl(doc.storage_path, 600)
      if (error || !data?.signedUrl) {
        pushToast(`Nie udało się otworzyć dokumentu ${doc.file_name}: ${error?.message ?? 'brak adresu'}`, 'error')
        return
      }
      const ok = await openExternalUrl(data.signedUrl)
      if (!ok) pushToast(`Nie udało się otworzyć przeglądarki z dokumentem ${doc.file_name}`, 'error')
    },
    [pushToast, touchSession],
  )

  /** Nieanulowane zlecenia Aluminium o tym numerze OF (także „ (2)”), najnowsze pierwsze */
  const findAluOrderByNumber = useCallback(
    async (orderNumber: string): Promise<AluFoundOrder[]> => {
      const { data, error } = await supabase.rpc('find_alu_order', { p_order_number: orderNumber })
      if (error) {
        pushToast(`Błąd szukania zlecenia ${orderNumber}: ${error.message}`, 'error')
        return []
      }
      return ((data as FindRpcRow[] | null) ?? []).map((r) => ({
        id: r.r_order_id,
        order_number: r.r_order_number,
        company: r.r_company ?? '',
        release_date: r.r_release_date,
      }))
    },
    [pushToast],
  )

  return {
    aluPositionsByOrder,
    setAluPositionsByOrder,
    documentsByOrder,
    setDocumentsByOrder,
    aluLoading,
    fetchAluData,
    importAluOrder,
    uploadOrderDocument,
    openOrderDocument,
    findAluOrderByNumber,
  }
}
