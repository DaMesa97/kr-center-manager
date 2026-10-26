import { supabase } from '../supabaseClient'
import { fetchAllPages } from './fetchPaged'
import { ALU_CATEGORY } from '../constants'
import type { TraceQuery } from './zkpTrace'
import type {
  AluConstruction, AluDossierItem, AluPosition, AluProductionOrder, Order, OrderDocument,
} from '../types'

// Komplet danych jednego zlecenia aluminium do wyszukiwarki „od tabliczki"
// i eksportu teczki. Same odczyty (RLS: odczyt dla zalogowanych).

export type AluOrderTrace = {
  order: Order
  positions: AluPosition[]
  constructions: AluConstruction[]
  documents: OrderDocument[]
  production: AluProductionOrder | null
  dossier: AluDossierItem[]
  isZkp: boolean
}

export type TraceHit = { orderId: number; constructionId: number | null }
export type TraceOrderChoice = { id: number; order_number: string; company: string }

type Res<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Zapytanie → zlecenie (i ew. konstrukcja). Kilka zleceń o tym samym numerze OF
 * (duplikaty „ (2)") → lista do wyboru.
 */
export async function findTrace(q: TraceQuery): Promise<Res<TraceHit | TraceOrderChoice[] | null>> {
  if (q.kind === 'construction') {
    const { data, error } = await supabase
      .from('alu_constructions')
      .select('id, order_id')
      .eq('year', q.year)
      .eq('zz', q.zz)
      .eq('pp', q.pp)
      .maybeSingle<{ id: number; order_id: number }>()
    if (error) return { ok: false, error: error.message }
    return { ok: true, value: data ? { orderId: data.order_id, constructionId: data.id } : null }
  }
  if (q.kind === 'production') {
    const { data, error } = await supabase
      .from('alu_production_orders')
      .select('order_id')
      .eq('year', q.year)
      .eq('zz', q.zz)
      .maybeSingle<{ order_id: number }>()
    if (error) return { ok: false, error: error.message }
    return { ok: true, value: data ? { orderId: data.order_id, constructionId: null } : null }
  }
  if (q.kind === 'orderId') {
    const { data, error } = await supabase
      .from('orders')
      .select('id')
      .eq('id', q.id)
      .eq('category', ALU_CATEGORY)
      .maybeSingle<{ id: number }>()
    if (error) return { ok: false, error: error.message }
    return { ok: true, value: data ? { orderId: data.id, constructionId: null } : null }
  }
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_number, company')
    .eq('category', ALU_CATEGORY)
    .ilike('order_number', `${q.orderNumber}%`)
    .order('id', { ascending: false })
    .limit(20)
  if (error) return { ok: false, error: error.message }
  // „OF34/2026%" łapie też „OF34/20261…" — zostają tylko ten numer i jego duplikaty
  const rows = ((data ?? []) as TraceOrderChoice[]).filter((r) => {
    const n = String(r.order_number ?? '')
    return n.toUpperCase() === q.orderNumber.toUpperCase() || n.toUpperCase().startsWith(`${q.orderNumber.toUpperCase()} `)
  })
  if (rows.length === 0) return { ok: true, value: null }
  if (rows.length === 1) return { ok: true, value: { orderId: rows[0].id, constructionId: null } }
  return { ok: true, value: rows.map((r) => ({ ...r, company: r.company ?? '' })) }
}

/** Zlecenie, pozycje, konstrukcje, wszystkie wersje dokumentów, stan teczki. */
export async function loadAluOrderTrace(orderId: number): Promise<Res<AluOrderTrace>> {
  const [orderRes, posRes, conRes, docRes, prodRes, dossierRes, zkpRes] = await Promise.all([
    supabase.from('orders').select('*').eq('id', orderId).maybeSingle<Order>(),
    fetchAllPages<AluPosition>((from, to) =>
      supabase.from('order_alu_positions').select('*').eq('order_id', orderId).order('pos_no').order('id').range(from, to),
    ),
    fetchAllPages<AluConstruction>((from, to) =>
      supabase.from('alu_constructions').select('*').eq('order_id', orderId).order('pp').order('id').range(from, to),
    ),
    fetchAllPages<OrderDocument>((from, to) =>
      supabase.from('order_documents').select('*').eq('order_id', orderId).order('id').range(from, to),
    ),
    supabase.from('alu_production_orders').select('*').eq('order_id', orderId).maybeSingle<AluProductionOrder>(),
    supabase.rpc('alu_dossier_status', { p_order_id: orderId }),
    supabase.rpc('alu_order_is_zkp', { p_order_id: orderId }),
  ])
  const err = orderRes.error ?? posRes.error ?? conRes.error ?? docRes.error ?? prodRes.error ?? dossierRes.error ?? zkpRes.error
  if (err) return { ok: false, error: err.message }
  if (!orderRes.data) return { ok: false, error: `Zlecenie ${orderId} nie istnieje` }
  return {
    ok: true,
    value: {
      order: orderRes.data,
      positions: posRes.data,
      constructions: conRes.data,
      documents: docRes.data,
      production: prodRes.data ?? null,
      dossier: (dossierRes.data ?? []) as AluDossierItem[],
      isZkp: zkpRes.data === true,
    },
  }
}
