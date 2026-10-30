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
import type {
  ZkpDeclaration,
  ZkpDeclarationCandidate,
  ZkpProtocolForm,
  ZkpSetting,
  ZkpTestProtocol,
} from '../lib/zkpProtocol'
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
  /** protokoły 6.17.5 karty — otwarty (decision null) + zamknięte, po attempt */
  protocols: ZkpTestProtocol[]
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
      if (mounted.current) setData({ card: null, checks: [], stages: [], hardware: [], fillings: [], problems: [], protocols: [] })
      return
    }
    const [chk, st, hw, fl, pr, pt] = await Promise.all([
      supabase.rpc('zkp_card_checks', { p_card_id: card.id }),
      supabase.from('zkp_card_stage_records').select('*').eq('card_id', card.id).order('id'),
      supabase.from('zkp_card_hardware').select('*').eq('card_id', card.id).order('id'),
      supabase.from('zkp_card_fillings').select('*').eq('card_id', card.id).order('id'),
      supabase.rpc('zkp_card_release_problems', { p_card_id: card.id }),
      supabase.from('zkp_test_protocols').select('*').eq('card_id', card.id).order('attempt'),
    ])
    const err = chk.error ?? st.error ?? hw.error ?? fl.error ?? pr.error ?? pt.error
    if (err) pushToast(`Nie wczytano całej karty: ${err.message}`, 'error')
    if (!mounted.current) return
    setData({
      card,
      checks: (chk.data ?? []) as ZkpCardCheck[],
      stages: (st.data ?? []) as ZkpStageRecord[],
      hardware: (hw.data ?? []) as ZkpHardwareRecord[],
      fillings: (fl.data ?? []) as ZkpFillingRecord[],
      problems: ((pr.data ?? []) as Array<{ r_problem: string }>).map((p) => p.r_problem),
      protocols: (pt.data ?? []) as ZkpTestProtocol[],
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
    // protokół 6.17.5: zapis otwartego (kontroler z matrycy), zamknięcie (PJ / Zastępca)
    saveProtocol: (form: ZkpProtocolForm) =>
      run(
        () =>
          supabase.rpc('zkp_save_test_protocol', {
            p_card_id: cardId,
            p_data: {
              inspector: form.inspector,
              produced_on: form.produced_on,
              inspected_on: form.inspected_on,
              instruments: form.instruments,
              notes: form.notes,
              checks: Object.fromEntries(Object.entries(form.checks).filter(([, v]) => v)),
              measurements: form.measurements,
            },
          }),
        'Protokół zapisany — wyniki pomiarów przeliczone',
      ),
    closeProtocol: (protocolId: number, assessment: 'zgodny' | 'niezgodny', decision: 'zwolniony' | 'wstrzymany', ncRef: string, notes: string) =>
      run(
        () =>
          supabase.rpc('zkp_close_test_protocol', {
            p_protocol_id: protocolId,
            p_assessment: assessment,
            p_decision: decision,
            p_nonconformity_ref: ncRef,
            p_notes: notes,
          }),
        decision === 'zwolniony' ? 'Protokół zamknięty — konstrukcja ZWOLNIONA' : 'Protokół zamknięty — WSTRZYMANY',
      ),
  }
}

/** Deklaracje KDWU / DWU (zał. 6.9): wykaz, konstrukcje gotowe do deklaracji, ustawienia (certyfikaty, podpisujący). */
export function useZkpDeclarations(pushToast: Toast, active: boolean) {
  const [declarations, setDeclarations] = useState<ZkpDeclaration[]>([])
  const [candidates, setCandidates] = useState<ZkpDeclarationCandidate[]>([])
  const [settings, setSettings] = useState<ZkpSetting[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const mounted = useRef(true)

  const reload = useCallback(async () => {
    setLoading(true)
    const [d, c, s] = await Promise.all([
      fetchAllPages<ZkpDeclaration>((from, to) =>
        supabase.from('zkp_declarations').select('*').order('id', { ascending: false }).range(from, to),
      ),
      supabase.rpc('zkp_declaration_candidates'),
      supabase.from('zkp_settings').select('*').order('key'),
    ])
    if (!mounted.current) return
    setLoading(false)
    const err = d.error ?? c.error ?? s.error
    if (err) {
      pushToast(`Nie wczytano deklaracji: ${err.message}`, 'error')
      return
    }
    setDeclarations(d.data)
    setCandidates((c.data ?? []) as ZkpDeclarationCandidate[])
    setSettings((s.data ?? []) as ZkpSetting[])
  }, [pushToast])

  useEffect(() => {
    mounted.current = true
    if (active) void reload()
    return () => {
      mounted.current = false
    }
  }, [active, reload])

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
        await reload()
        return data
      } finally {
        if (mounted.current) setSaving(false)
      }
    },
    [pushToast, reload],
  )

  return {
    declarations,
    candidates,
    settings,
    loading,
    saving,
    reload,
    setting: (key: string) => settings.find((s) => s.key === key)?.value ?? '',
    issue: async (orderId: number, constructionIds: number[], data: Record<string, string>): Promise<ZkpDeclaration | null> => {
      const res = await run(() => supabase.rpc('zkp_issue_declaration', { p_order_id: orderId, p_construction_ids: constructionIds, p_data: data }))
      if (!res) return null
      const row = (res as Array<{ r_id: number; r_number: string }>)[0]
      if (!row) return null
      const { data: d } = await supabase.from('zkp_declarations').select('*').eq('id', row.r_id).maybeSingle<ZkpDeclaration>()
      pushToast(`Wystawiono deklarację ${row.r_number}`, 'success')
      return d ?? null
    },
    withdraw: (id: number, reason: string) =>
      run(() => supabase.rpc('zkp_withdraw_declaration', { p_id: id, p_reason: reason }), 'Deklaracja wycofana — konstrukcje wolne pod nową'),
    setSetting: (key: string, value: string) => run(() => supabase.rpc('zkp_set_setting', { p_key: key, p_value: value }), 'Ustawienie zapisane'),
  }
}

export type ZkpDeclarationsApi = ReturnType<typeof useZkpDeclarations>

export type ZkpCardApi = ReturnType<typeof useZkpCard>
