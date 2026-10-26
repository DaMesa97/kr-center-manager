import { useCallback, useState } from 'react'
import { supabase } from '../supabaseClient'
import { fetchAllPages } from '../lib/fetchPaged'
import { ORDER_DOCUMENTS_BUCKET } from '../constants'
import type { AluMaterialListParseResult } from '../lib/aluMaterialListParser'
import type {
  AluConstruction,
  AluDossierItem,
  AluMaterialList,
  AluMaterialListItemRow,
  AluLpParseResult,
  AluLpPosition,
  AluPosition,
  AluProductionOrder,
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
  // ZKP 5.9: numery konstrukcji (sztuki) i uruchomienie zlecenia (rok + ZZ)
  const [constructionsByOrder, setConstructionsByOrder] = useState<Record<number, AluConstruction[]>>({})
  const [productionByOrder, setProductionByOrder] = useState<Record<number, AluProductionOrder | null>>({})
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

      // Numery konstrukcji osobno i „miękko": błąd (np. migracja ZKP jeszcze
      // nieuruchomiona) nie może zablokować pozycji i dokumentów.
      const constructions: AluConstruction[] = []
      const production: AluProductionOrder[] = []
      if (!errMsg) {
        for (const part of chunk(ids, ORDER_ID_CHUNK)) {
          const [conRes, prodRes] = await Promise.all([
            fetchAllPages<AluConstruction>((from, to) =>
              supabase
                .from('alu_constructions')
                .select('*')
                .in('order_id', part)
                .order('pp', { ascending: true })
                .range(from, to)
                .overrideTypes<AluConstruction[], { merge: false }>(),
            ),
            supabase.from('alu_production_orders').select('*').in('order_id', part),
          ])
          if (conRes.error || prodRes.error) {
            console.warn('Numery konstrukcji niedostępne:', conRes.error?.message ?? prodRes.error?.message)
            break
          }
          constructions.push(...conRes.data)
          production.push(...((prodRes.data ?? []) as AluProductionOrder[]))
        }
      }

      setAluLoading(false)
      if (errMsg) {
        pushToast(`Błąd wczytywania pozycji aluminium: ${errMsg}`, 'error')
        return
      }

      setConstructionsByOrder((prev) => {
        const next = { ...prev }
        for (const id of ids) next[id] = []
        for (const c of constructions) (next[c.order_id] ?? (next[c.order_id] = [])).push(c)
        return next
      })
      setProductionByOrder((prev) => {
        const next = { ...prev }
        for (const id of ids) next[id] = null
        for (const p of production) next[p.order_id] = p
        return next
      })

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
   * attach_order_document — dopisuje KOLEJNĄ WERSJĘ; poprzednie zostają
   * (ZKP 5.1.6, teczka 5.9). Zwraca wiersz order_documents albo null.
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
        // plik bez wpisu w teczce zostaje w storage (usuwanie plików zablokowane, zał. 6.34)
        pushToast(`Nie udało się dopiąć dokumentu do zlecenia: ${error?.message ?? 'brak wyniku'}`, 'error')
        return null
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
        version: 0,
      }
      if (docErr || !docs) {
        setDocumentsByOrder((prev) => {
          const list = prev[orderId] ?? []
          const version = Math.max(0, ...list.filter((d) => d.kind === kind).map((d) => d.version ?? 1)) + 1
          return { ...prev, [orderId]: [...list, { ...fallback, version }] }
        })
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

  /** Wycofanie dokumentu z powodem (zamiast usunięcia, zał. 6.34). */
  const withdrawOrderDocument = useCallback(
    async (doc: OrderDocument, reason: string): Promise<boolean> => {
      touchSession()
      const { error } = await supabase.rpc('withdraw_order_document', { p_document_id: doc.id, p_reason: reason })
      if (error) {
        pushToast(`Nie udało się wycofać dokumentu: ${error.message}`, 'error')
        return false
      }
      pushToast(`Wycofano ${doc.file_name}`, 'success')
      await fetchAluData([doc.order_id])
      return true
    },
    [pushToast, touchSession, fetchAluData],
  )

  /**
   * Stan teczki (ZKP 5.9) + czy zlecenie podlega ZKP (AS 75EI) i czy to ręczne
   * oznaczenie. null = błąd (toast) — np. migracja teczki nieuruchomiona.
   */
  const fetchAluDossier = useCallback(
    async (orderId: number): Promise<{ items: AluDossierItem[]; isZkp: boolean; zkpOverride: boolean | null } | null> => {
      touchSession()
      const [stRes, zkpRes, ovRes] = await Promise.all([
        supabase.rpc('alu_dossier_status', { p_order_id: orderId }),
        supabase.rpc('alu_order_is_zkp', { p_order_id: orderId }),
        supabase.from('alu_zkp_override').select('is_zkp').eq('order_id', orderId).maybeSingle(),
      ])
      const err = stRes.error ?? zkpRes.error ?? ovRes.error
      if (err) {
        pushToast(`Nie udało się wczytać teczki zlecenia: ${err.message}`, 'error')
        return null
      }
      return {
        items: (stRes.data ?? []) as AluDossierItem[],
        isZkp: zkpRes.data === true,
        zkpOverride: (ovRes.data as { is_zkp: boolean } | null)?.is_zkp ?? null,
      }
    },
    [pushToast, touchSession],
  )

  /**
   * Lista materiałowa Aluron (.xls) → plik do storage + RPC zkp_import_material_list:
   * w jednej transakcji nowa wersja dokumentu LM i jej pozycje (ZKP 5.9).
   */
  const importMaterialList = useCallback(
    async (orderId: number, file: File, parsed: AluMaterialListParseResult): Promise<boolean> => {
      touchSession()
      const xlsx = /\.xlsx$/i.test(file.name)
      const path = `aluminium/${orderId}/LM_${Date.now()}.${xlsx ? 'xlsx' : 'xls'}`
      const contentType = xlsx
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/vnd.ms-excel'
      const { error: upErr } = await supabase.storage
        .from(ORDER_DOCUMENTS_BUCKET)
        .upload(path, file, { contentType, upsert: false })
      if (upErr) {
        pushToast(`Nie udało się wgrać pliku ${file.name}: ${upErr.message}`, 'error')
        return false
      }
      const { data, error } = await supabase.rpc('zkp_import_material_list', {
        p_order_id: orderId,
        p_storage_path: path,
        p_file_name: file.name,
        p_header: {
          order_number: parsed.order_number,
          created_at: parsed.created_at,
          total_value: parsed.total_value,
          total_need_value: parsed.total_need_value,
        },
        p_items: parsed.items,
      })
      const row = (data as { r_version: number; r_item_count: number }[] | null)?.[0]
      if (error || !row) {
        pushToast(`Nie udało się zapisać listy materiałowej: ${error?.message ?? 'brak wyniku'}`, 'error')
        return false
      }
      pushToast(`Lista materiałowa v${row.r_version}: ${row.r_item_count} pozycji`, 'success')
      await fetchAluData([orderId])
      return true
    },
    [pushToast, touchSession, fetchAluData],
  )

  /** Nagłówek i pozycje listy materiałowej danej wersji dokumentu LM; null = błąd/brak. */
  const fetchMaterialList = useCallback(
    async (documentId: number): Promise<{ list: AluMaterialList; items: AluMaterialListItemRow[] } | null> => {
      const { data: list, error } = await supabase
        .from('zkp_material_lists')
        .select('*')
        .eq('document_id', documentId)
        .maybeSingle<AluMaterialList>()
      if (error) {
        pushToast(`Nie udało się wczytać listy materiałowej: ${error.message}`, 'error')
        return null
      }
      if (!list) return null
      const { data: items, error: itemsErr } = await supabase
        .from('zkp_material_list_items')
        .select('*')
        .eq('list_id', list.id)
        .order('line_no', { ascending: true })
        .overrideTypes<AluMaterialListItemRow[], { merge: false }>()
      if (itemsErr) {
        pushToast(`Nie udało się wczytać pozycji listy materiałowej: ${itemsErr.message}`, 'error')
        return null
      }
      return { list, items: items ?? [] }
    },
    [pushToast],
  )

  /** Ręczne oznaczenie zlecenia jako ZKP / nie-ZKP; null = rozpoznanie automatyczne. */
  const setAluOrderZkp = useCallback(
    async (orderId: number, value: boolean | null): Promise<boolean> => {
      touchSession()
      const { error } = await supabase.rpc('set_alu_order_zkp', { p_order_id: orderId, p_is_zkp: value })
      if (error) {
        pushToast(`Nie udało się zmienić oznaczenia ZKP: ${error.message}`, 'error')
        return false
      }
      return true
    },
    [pushToast, touchSession],
  )

  /** „Nie dotyczy" w teczce (PJ / Zastępca / KP, ZKP 5.3.2) — z powodem. */
  const setDossierNa = useCallback(
    async (orderId: number, itemKey: string, reason: string): Promise<boolean> => {
      touchSession()
      const { error } = await supabase.rpc('set_dossier_na', { p_order_id: orderId, p_item_key: itemKey, p_reason: reason })
      if (error) {
        pushToast(`Nie udało się oznaczyć „nie dotyczy": ${error.message}`, 'error')
        return false
      }
      return true
    },
    [pushToast, touchSession],
  )

  const revokeDossierNa = useCallback(
    async (naId: number, reason: string): Promise<boolean> => {
      touchSession()
      const { error } = await supabase.rpc('revoke_dossier_na', { p_na_id: naId, p_reason: reason })
      if (error) {
        pushToast(`Nie udało się cofnąć „nie dotyczy": ${error.message}`, 'error')
        return false
      }
      return true
    },
    [pushToast, touchSession],
  )

  /**
   * Uruchomienie zlecenia do produkcji (ZKP 5.9): RPC nadaje kolejny ZZ w roku
   * i numery RRRR/ZZ/PP każdej sztuce. Ponowne wywołanie zwraca istniejący numer.
   */
  const startAluProduction = useCallback(
    async (orderId: number): Promise<boolean> => {
      touchSession()
      const { data, error } = await supabase.rpc('start_alu_production', { p_order_id: orderId })
      if (error) {
        pushToast(`Nie udało się uruchomić zlecenia: ${error.message}`, 'error')
        return false
      }
      const row = (data as { r_year: number; r_zz: number; r_count: number; r_already_started: boolean }[] | null)?.[0]
      if (row) {
        const zz = row.r_zz < 10 ? `0${row.r_zz}` : String(row.r_zz)
        pushToast(
          row.r_already_started
            ? `Zlecenie było już uruchomione (${row.r_year}/${zz})`
            : `Uruchomiono do produkcji: ${row.r_year}/${zz} — nadano ${row.r_count} numerów konstrukcji`,
          'success',
        )
      }
      await fetchAluData([orderId])
      return true
    },
    [pushToast, touchSession, fetchAluData],
  )

  return {
    aluPositionsByOrder,
    setAluPositionsByOrder,
    documentsByOrder,
    setDocumentsByOrder,
    constructionsByOrder,
    productionByOrder,
    startAluProduction,
    withdrawOrderDocument,
    fetchAluDossier,
    importMaterialList,
    fetchMaterialList,
    setAluOrderZkp,
    setDossierNa,
    revokeDossierNa,
    aluLoading,
    fetchAluData,
    importAluOrder,
    uploadOrderDocument,
    openOrderDocument,
    findAluOrderByNumber,
  }
}
