import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { fetchAllPages } from '../lib/fetchPaged'
import {
  formToPayload,
  type ZkpCardCheck,
  type ZkpCardDecision,
  type ZkpCardForm,
  type ZkpFillingField,
  type ZkpFillingRecord,
  type ZkpGaps,
  type ZkpHardwareRecord,
  type ZkpHardwareSlot,
  type ZkpProductCard,
  type ZkpRange,
  type ZkpRegisterRow,
  type ZkpStageKey,
  type ZkpStageRecord,
  type ZkpStageResult,
} from '../lib/zkpCard'
import type { ToastVariant } from '../types'

// Karta wyrobu (zał. 6.25) i rejestr wyrobów (6.33). Odczyt — tabele i funkcje
// raportowe; zapis WYŁĄCZNIE funkcjami zkp_* (tabela K, lista 6.10.5, partie,
// role ZKP — wszystko pilnowane w bazie).

type Toast = (message: string, variant: ToastVariant) => void
type RpcResult = PromiseLike<{ data: unknown; error: { message: string } | null }>

/** Rejestr wyrobów: wszystkie konstrukcje zleceń ZKP z danymi kart. */
export function useZkpRegister(pushToast: Toast, active: boolean) {
  const [rows, setRows] = useState<ZkpRegisterRow[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('zkp_product_register')
    setLoading(false)
    if (error) {
      pushToast(`Nie wczytano rejestru wyrobów: ${error.message}`, 'error')
      return
    }
    setRows((data ?? []) as ZkpRegisterRow[])
  }, [pushToast])

  useEffect(() => {
    if (active) void reload()
  }, [active, reload])

  return { rows, loading, reload }
}

export type ZkpCardData = {
  card: ZkpProductCard | null
  checks: ZkpCardCheck[]
  stages: ZkpStageRecord[]
  hardware: ZkpHardwareRecord[]
  fillings: ZkpFillingRecord[]
  problems: string[]
}

/** Jedna karta (po konstrukcji) + słownik zakresów i lista 6.10.5 dla zakresu karty. */
export function useZkpCard(constructionId: number, pushToast: Toast) {
  const [data, setData] = useState<ZkpCardData | null>(null)
  const [ranges, setRanges] = useState<ZkpRange[]>([])
  const [allowed, setAllowed] = useState<{ range: string; codes: Set<string> } | null>(null)
  const [saving, setSaving] = useState(false)
  const mounted = useRef(true)

  const reload = useCallback(async () => {
    const { data: card, error } = await supabase
      .from('zkp_product_cards')
      .select('*')
      .eq('construction_id', constructionId)
      .maybeSingle<ZkpProductCard>()
    if (error) {
      pushToast(`Nie wczytano karty wyrobu: ${error.message}`, 'error')
      return
    }
    if (!card) {
      if (mounted.current) setData({ card: null, checks: [], stages: [], hardware: [], fillings: [], problems: [] })
      return
    }
    const [chk, st, hw, fl, pr] = await Promise.all([
      supabase.rpc('zkp_card_checks', { p_card_id: card.id }),
      supabase.from('zkp_card_stage_records').select('*').eq('card_id', card.id).order('id'),
      supabase.from('zkp_card_hardware').select('*').eq('card_id', card.id).order('id'),
      supabase.from('zkp_card_fillings').select('*').eq('card_id', card.id).order('id'),
      supabase.rpc('zkp_card_release_problems', { p_card_id: card.id }),
    ])
    const err = chk.error ?? st.error ?? hw.error ?? fl.error ?? pr.error
    if (err) pushToast(`Nie wczytano całej karty: ${err.message}`, 'error')
    if (!mounted.current) return
    setData({
      card,
      checks: (chk.data ?? []) as ZkpCardCheck[],
      stages: (st.data ?? []) as ZkpStageRecord[],
      hardware: (hw.data ?? []) as ZkpHardwareRecord[],
      fillings: (fl.data ?? []) as ZkpFillingRecord[],
      problems: ((pr.data ?? []) as Array<{ r_problem: string }>).map((p) => p.r_problem),
    })
  }, [constructionId, pushToast])

  useEffect(() => {
    mounted.current = true
    void reload()
    void supabase
      .from('zkp_ranges')
      .select('*')
      .order('sort')
      .then(({ data: r, error }) => {
        if (error) pushToast(`Nie wczytano zakresów: ${error.message}`, 'error')
        else if (mounted.current) setRanges((r ?? []) as ZkpRange[])
      })
    return () => {
      mounted.current = false
    }
  }, [reload, pushToast])

  // lista 6.10.5 dla zakresu karty — do filtrowania partii w oknie
  const rangeCode = data?.card?.range_code ?? null
  useEffect(() => {
    if (!rangeCode || allowed?.range === rangeCode) return
    void fetchAllPages<{ code: string }>((from, to) =>
      supabase.from('zkp_range_components').select('code').eq('range_code', rangeCode).order('code').range(from, to),
    ).then(({ data: rows, error }) => {
      if (error) pushToast(`Nie wczytano listy 6.10.5: ${error.message}`, 'error')
      else if (mounted.current) setAllowed({ range: rangeCode, codes: new Set(rows.map((r) => r.code)) })
    })
  }, [rangeCode, allowed?.range, pushToast])

  const run = useCallback(
    async (fn: () => RpcResult, okMsg?: string): Promise<boolean> => {
      setSaving(true)
      try {
        const { error } = await fn()
        if (error) {
          pushToast(error.message, 'error')
          return false
        }
        if (okMsg) pushToast(okMsg, 'success')
        await reload()
        return true
      } finally {
        if (mounted.current) setSaving(false)
      }
    },
    [pushToast, reload],
  )

  const cardId = data?.card?.id ?? null

  return {
    data,
    ranges,
    allowedCodes: rangeCode && allowed?.range === rangeCode ? allowed.codes : null,
    saving,
    reload,
    saveAB: (form: ZkpCardForm) =>
      run(() => supabase.rpc('zkp_save_card', { p_construction_id: constructionId, p_data: formToPayload(form) }), 'Karta zapisana — sprawdzenie zakresu przeliczone'),
    confirmRange: () => run(() => supabase.rpc('zkp_confirm_card_range', { p_card_id: cardId }), 'Zakres potwierdzony — można produkować'),
    reopenRange: (reason: string) =>
      run(() => supabase.rpc('zkp_reopen_card_range', { p_card_id: cardId, p_reason: reason }), 'Potwierdzenie zakresu cofnięte'),
    recordStage: (stage: ZkpStageKey, catalogNo: string, lotId: number | null, result: ZkpStageResult, gaps: ZkpGaps | null, notes: string, operator: string) =>
      run(
        () =>
          supabase.rpc('zkp_record_card_stage', {
            p_card_id: cardId,
            p_stage_key: stage,
            p_catalog_no: catalogNo,
            p_lot_id: lotId,
            p_result: result,
            p_gaps: gaps,
            p_notes: notes,
            p_operator: operator,
          }),
        'Etap zapisany',
      ),
    saveHardware: (slot: ZkpHardwareSlot, producerModel: string, dwuNo: string, count: number, conditionRef: string, lotId: number | null) =>
      run(
        () =>
          supabase.rpc('zkp_save_card_hardware', {
            p_card_id: cardId,
            p_slot: slot,
            p_producer_model: producerModel,
            p_dwu_no: dwuNo,
            p_count: count,
            p_condition_ref: conditionRef,
            p_lot_id: lotId,
          }),
        'Okucie zapisane',
      ),
    saveFilling: (field: ZkpFillingField, tableRow: string, product: string, thickness: number | null, dims: string, lotId: number | null) =>
      run(
        () =>
          supabase.rpc('zkp_save_card_filling', {
            p_card_id: cardId,
            p_field: field,
            p_table_row: tableRow,
            p_product: product,
            p_thickness: thickness,
            p_dims: dims,
            p_lot_id: lotId,
          }),
        'Wypełnienie zapisane',
      ),
    decide: (decision: ZkpCardDecision, protocolNo: string, declarationNo: string, releasedOn: string | null, ncRef: string, notes: string) =>
      run(
        () =>
          supabase.rpc('zkp_decide_card', {
            p_card_id: cardId,
            p_decision: decision,
            p_test_protocol_no: protocolNo,
            p_declaration_no: declarationNo,
            p_released_on: releasedOn,
            p_nonconformity_ref: ncRef,
            p_notes: notes,
          }),
        decision === 'zwolniony' ? 'Konstrukcja zwolniona' : 'Konstrukcja oznaczona jako niezgodna',
      ),
  }
}

export type ZkpCardApi = ReturnType<typeof useZkpCard>
