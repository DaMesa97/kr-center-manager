import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { fetchAllPages } from '../lib/fetchPaged'
import { openExternalUrl } from './useAluOrders'
import {
  ZKP_DOCUMENTS_BUCKET,
  zkpScanPath,
  type ZkpAssessmentKind,
  type ZkpAssessmentResult,
  type ZkpComponent,
  type ZkpLotDecision,
  type ZkpMaterialLot,
  type ZkpSupplier,
  type ZkpSupplierAssessment,
  type ZkpSupplierQualification,
} from '../lib/zkp'
import type { ZkpCompetency, ZkpOperation, ZkpPerson } from '../lib/zkpCard'
import type { ToastVariant } from '../types'

// Dane etapu F ZKP. Odczyt — tabele (RLS: odczyt dla zalogowanych), zapis — WYŁĄCZNIE
// przez funkcje bazy (zkp_*), które pilnują ról ZKP, kwarantanny i dostawców.

export type ZkpReceiptInput = {
  received_on: string
  supplier_id: number
  delivery_doc: string
  component_id: number
  catalog_no: string
  quantity: number
  lot_no: string
  quality_doc_kind: string
  quality_doc_no: string
  scan: File | null
  conforms_to_order: boolean
  conforms_to_list_6105: boolean
  condition_ok: boolean
  condition_notes: string
  decision: ZkpLotDecision
  decision_reason: string
  pz_reference: string
}

export function useZkp(pushToast: (message: string, variant: ToastVariant) => void, active: boolean) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [components, setComponents] = useState<ZkpComponent[]>([])
  const [suppliers, setSuppliers] = useState<ZkpSupplier[]>([])
  const [qualifications, setQualifications] = useState<ZkpSupplierQualification[]>([])
  const [assessments, setAssessments] = useState<ZkpSupplierAssessment[]>([])
  const [lots, setLots] = useState<ZkpMaterialLot[]>([])
  // zał. 6.1 / 6.27: osoby (profile z inicjałami) i ich uprawnienia do operacji
  const [people, setPeople] = useState<ZkpPerson[]>([])
  const [competencies, setCompetencies] = useState<ZkpCompetency[]>([])
  const mountedRef = useRef(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [compRes, supRes, qualRes, assRes, lotRes, peopleRes, cmpRes] = await Promise.all([
      fetchAllPages<ZkpComponent>((from, to) =>
        supabase
          .from('warehouse_components')
          .select('id, code, name, unit, category, is_active, zkp_critical_kind, zkp_model, zkp_dwu_number')
          .order('name', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAllPages<ZkpSupplier>((from, to) =>
        supabase.from('suppliers').select('id, name, is_active').order('name').order('id').range(from, to),
      ),
      fetchAllPages<ZkpSupplierQualification>((from, to) =>
        supabase.from('zkp_supplier_qualifications').select('*').order('supplier_id').range(from, to),
      ),
      fetchAllPages<ZkpSupplierAssessment>((from, to) =>
        supabase
          .from('zkp_supplier_assessments')
          .select('*')
          .order('assessed_on', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
      ),
      fetchAllPages<ZkpMaterialLot>((from, to) =>
        supabase
          .from('zkp_material_lots')
          .select('*')
          .order('received_on', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
      ),
      fetchAllPages<ZkpPerson>((from, to) =>
        supabase.from('profiles').select('id, initials, full_name, zkp_position').order('initials').range(from, to),
      ),
      fetchAllPages<ZkpCompetency>((from, to) =>
        supabase.from('zkp_competencies').select('*').order('id').range(from, to),
      ),
    ])
    if (!mountedRef.current) return
    const err = compRes.error ?? supRes.error ?? qualRes.error ?? assRes.error ?? lotRes.error ?? peopleRes.error ?? cmpRes.error
    if (err) pushToast(`Nie wczytano danych ZKP: ${err.message}`, 'error')
    setComponents(compRes.data)
    setSuppliers(supRes.data)
    setQualifications(qualRes.data)
    setAssessments(assRes.data)
    setLots(lotRes.data.map((l) => ({ ...l, quantity: Number(l.quantity), qty_issued: Number(l.qty_issued) })))
    setPeople(peopleRes.data.filter((p) => (p.initials ?? '').trim() !== '').map((p) => ({ ...p, full_name: p.full_name ?? '' })))
    setCompetencies(cmpRes.data)
    setLoading(false)
  }, [pushToast])

  useEffect(() => {
    mountedRef.current = true
    if (active) void load()
    return () => {
      mountedRef.current = false
    }
  }, [active, load])

  /** Wgranie skanu dokumentu jakości → ścieżka w buckecie (null = błąd, toast już pokazany). */
  const uploadScan = useCallback(
    async (file: File): Promise<string | null> => {
      const path = zkpScanPath(file.name)
      const { error } = await supabase.storage
        .from(ZKP_DOCUMENTS_BUCKET)
        .upload(path, file, { contentType: file.type || 'application/pdf', upsert: false })
      if (error) {
        pushToast(`Nie wgrano skanu dokumentu jakości: ${error.message}`, 'error')
        return null
      }
      return path
    },
    [pushToast],
  )

  const openScan = useCallback(
    async (path: string) => {
      const { data, error } = await supabase.storage.from(ZKP_DOCUMENTS_BUCKET).createSignedUrl(path, 600)
      if (error || !data?.signedUrl) {
        pushToast(`Nie udało się otworzyć skanu: ${error?.message ?? 'brak adresu'}`, 'error')
        return
      }
      if (!(await openExternalUrl(data.signedUrl))) pushToast('Nie udało się otworzyć przeglądarki ze skanem', 'error')
    },
    [pushToast],
  )

  /** Wspólny wrapper: RPC → toast błędu → odświeżenie. Zwraca dane RPC albo null przy błędzie. */
  const run = useCallback(
    async <T,>(fn: () => PromiseLike<{ data: T | null; error: { message: string } | null }>, okMsg?: string): Promise<T | null | false> => {
      setSaving(true)
      try {
        const { data, error } = await fn()
        if (error) {
          pushToast(error.message, 'error')
          return false
        }
        if (okMsg) pushToast(okMsg, 'success')
        await load()
        return data
      } finally {
        if (mountedRef.current) setSaving(false)
      }
    },
    [pushToast, load],
  )

  const registerReceipt = useCallback(
    async (input: ZkpReceiptInput): Promise<boolean> => {
      let scanPath: string | null = null
      if (input.scan) {
        scanPath = await uploadScan(input.scan)
        if (!scanPath) return false
      }
      const res = await run(() =>
        supabase.rpc('zkp_register_receipt', {
          p_received_on: input.received_on,
          p_supplier_id: input.supplier_id,
          p_delivery_doc: input.delivery_doc,
          p_component_id: input.component_id,
          p_catalog_no: input.catalog_no,
          p_quantity: input.quantity,
          p_lot_no: input.lot_no,
          p_quality_doc_kind: input.quality_doc_kind,
          p_quality_doc_no: input.quality_doc_no,
          p_quality_doc_path: scanPath,
          p_conforms_to_order: input.conforms_to_order,
          p_conforms_to_list_6105: input.conforms_to_list_6105,
          p_condition_ok: input.condition_ok,
          p_condition_notes: input.condition_notes,
          p_decision: input.decision,
          p_decision_reason: input.decision_reason,
          p_pz_reference: input.pz_reference,
        }),
      )
      if (res === false) return false
      const row = (res as Array<{ r_decision: string; r_forced_quarantine: boolean }> | null)?.[0]
      if (row?.r_forced_quarantine) {
        pushToast('Przyjęcie zapisane jako KWARANTANNA — brak nr partii lub dokumentu jakości (zał. 6.24)', 'info')
      } else {
        pushToast(`Przyjęcie zapisane (${row?.r_decision ?? 'zapisano'})`, 'success')
      }
      return true
    },
    [run, uploadScan, pushToast],
  )

  const completeLot = useCallback(
    async (lotId: number, lotNo: string, docKind: string, docNo: string, scan: File | null): Promise<boolean> => {
      let scanPath: string | null = null
      if (scan) {
        scanPath = await uploadScan(scan)
        if (!scanPath) return false
      }
      const res = await run(
        () =>
          supabase.rpc('zkp_complete_lot', {
            p_lot_id: lotId,
            p_lot_no: lotNo,
            p_quality_doc_kind: docKind,
            p_quality_doc_no: docNo,
            p_quality_doc_path: scanPath,
          }),
        'Partia uzupełniona (dalej w kwarantannie — zwalnia Pełnomocnik / Zastępca)',
      )
      return res !== false
    },
    [run, uploadScan],
  )

  const decideLot = useCallback(
    async (lotId: number, decision: 'przyjeto' | 'zwrot', reason: string): Promise<boolean> => {
      const res = await run(
        () => supabase.rpc('zkp_decide_lot', { p_lot_id: lotId, p_decision: decision, p_reason: reason }),
        decision === 'przyjeto' ? 'Partia zwolniona z kwarantanny' : 'Partia oznaczona do zwrotu',
      )
      return res !== false
    },
    [run],
  )

  const upsertQualification = useCallback(
    async (supplierId: number, scope: string, isCritical: boolean, requiredDoc: string): Promise<boolean> => {
      const res = await run(
        () =>
          supabase.rpc('zkp_upsert_supplier_qualification', {
            p_supplier_id: supplierId,
            p_scope: scope,
            p_is_critical: isCritical,
            p_required_quality_doc: requiredDoc,
          }),
        'Wykaz dostawców zapisany',
      )
      return res !== false
    },
    [run],
  )

  const addAssessment = useCallback(
    async (
      supplierId: number,
      kind: ZkpAssessmentKind,
      assessedOn: string,
      result: ZkpAssessmentResult,
      notes: string,
      nextOn: string | null,
    ): Promise<boolean> => {
      const res = await run(
        () =>
          supabase.rpc('zkp_add_supplier_assessment', {
            p_supplier_id: supplierId,
            p_kind: kind,
            p_assessed_on: assessedOn,
            p_result: result,
            p_notes: notes,
            p_next_assessment_on: nextOn,
          }),
        'Ocena dostawcy zapisana',
      )
      return res !== false
    },
    [run],
  )

  const setComponentCritical = useCallback(
    async (componentId: number, kind: string | null, model: string, dwu: string): Promise<boolean> => {
      const res = await run(
        () =>
          supabase.rpc('zkp_set_component_critical', {
            p_component_id: componentId,
            p_kind: kind ?? '',
            p_model: model,
            p_dwu_number: dwu,
          }),
        kind ? 'Komponent na liście krytycznych (6.10.5)' : 'Komponent zdjęty z listy krytycznych',
      )
      return res !== false
    },
    [run],
  )

  /** Matryca kompetencji 6.27 — nadanie uprawnienia (Pełnomocnik / Zastępca). */
  const grantCompetency = useCallback(
    async (profileId: string, operation: ZkpOperation, grantedOn: string, basis: string): Promise<boolean> => {
      const res = await run(
        () => supabase.rpc('zkp_grant_competency', { p_profile_id: profileId, p_operation: operation, p_granted_on: grantedOn, p_basis: basis }),
        'Uprawnienie nadane (zał. 6.27)',
      )
      return res !== false
    },
    [run],
  )

  const withdrawCompetency = useCallback(
    async (id: number, reason: string): Promise<boolean> => {
      const res = await run(() => supabase.rpc('zkp_withdraw_competency', { p_id: id, p_reason: reason }), 'Uprawnienie wycofane')
      return res !== false
    },
    [run],
  )

  return {
    loading,
    saving,
    components,
    suppliers,
    qualifications,
    assessments,
    lots,
    people,
    competencies,
    grantCompetency,
    withdrawCompetency,
    reload: load,
    openScan,
    registerReceipt,
    completeLot,
    decideLot,
    upsertQualification,
    addAssessment,
    setComponentCritical,
  }
}
