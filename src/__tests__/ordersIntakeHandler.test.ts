import { beforeAll, describe, expect, it } from 'vitest'
// Test INTEGRACYJNY handlera orders-intake (konfigurator) — w tym najbardziej
// krucha logika biznesowa: auto-tworzenie pary DISTING PLUS i nóg Titana.
import '../../supabase/functions/orders-intake/index'
import { __handlers } from './stubs/deno-http-server'
import { __setSupabaseClient } from './stubs/esm-supabase'

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).Deno = { env: { get: () => 'http://stub.local' } }
})

const handler = () => __handlers[0]

type Recorded = { rpc: Array<[string, unknown]>; inserted: unknown[][]; updated: unknown[] }

function makeFakeSupabase(
  queryQueue: unknown[],
  rpcResponses: Record<string, unknown>,
): { supabase: unknown; calls: Recorded } {
  const calls: Recorded = { rpc: [], inserted: [], updated: [] }
  const makeBuilder = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {}
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'limit', 'order', 'range', 'single', 'maybeSingle']) {
      b[m] = () => b
    }
    b.insert = (rows: unknown[]) => { calls.inserted.push(rows as unknown[]); return b }
    b.update = (patch: unknown) => { calls.updated.push(patch); return b }
    b.then = (resolve: (v: unknown) => void) => resolve(queryQueue.shift() ?? { data: null, error: null })
    return b
  }
  const supabase = {
    from: () => makeBuilder(),
    rpc: async (name: string, args: unknown) => {
      calls.rpc.push([name, args])
      return rpcResponses[name] ?? { data: null, error: null }
    },
  }
  return { supabase, calls }
}

const RPCS_OK = (orderId: number, orderNumber: string) => ({
  verify_api_key: { data: [{ is_valid: true, key_id: 1, rate_limit_per_minute: 60 }], error: null },
  check_rate_limit: { data: true, error: null },
  create_bot_order: {
    data: [{ order_id: orderId, order_number: orderNumber, needs_review: false, warnings: [] }],
    error: null,
  },
  log_api_request: { data: null, error: null },
})

const post = (body: unknown) =>
  new Request('http://edge.local/', {
    method: 'POST',
    headers: { 'x-api-key': 'k' },
    body: JSON.stringify(body),
  })

describe('orders-intake — autoryzacja i duplikaty', () => {
  it('brak klucza → 401; zły JSON → 400', async () => {
    const { supabase } = makeFakeSupabase([], RPCS_OK(1, '1'))
    __setSupabaseClient(supabase)
    expect((await handler()(new Request('http://x', { method: 'POST', body: '{}' }))).status).toBe(401)
    const bad = new Request('http://x', { method: 'POST', headers: { 'x-api-key': 'k' }, body: 'zepsute{' })
    expect((await handler()(bad)).status).toBe(400)
  })

  it('duplikat recordId (błąd z create_bot_order) → 409', async () => {
    const { supabase } = makeFakeSupabase([], {
      ...RPCS_OK(1, '1'),
      create_bot_order: { data: null, error: { message: 'Zamowienie z recordId rec1 juz istnieje (duplikat)' } },
    })
    __setSupabaseClient(supabase)
    const res = await handler()(post({ category: 'STA', recordId: 'rec1' }))
    expect(res.status).toBe(409)
  })
})

describe('orders-intake — DISTING PLUS: automatyczna para STA↔Disting', () => {
  it('zlecenie Disting z systemem DISTING PLUS tworzy partnera STA z poprawnymi referencjami', async () => {
    const base = {
      id: 10, order_number: '500', category: 'Disting', system: 'DISTING PLUS',
      company: 'TORA', linked_order_id: null, extra_fields: {},
    }
    const { supabase, calls } = makeFakeSupabase(
      [
        { data: base, error: null },                       // odczyt bazowego zlecenia
        { data: [{ order_number: '41' }], error: null },   // nextOrderNumber('STA') → max 41
        { data: { id: 77, order_number: '42' }, error: null }, // insert partnera
        { data: null, error: null },                        // update bazowego (linki)
        { data: base, error: null },                        // createTitanLegs: odczyt (nie Titan → stop)
      ],
      RPCS_OK(10, '500'),
    )
    __setSupabaseClient(supabase)

    const res = await handler()(post({ category: 'Disting', system: 'DISTING PLUS' }))
    expect(res.status).toBe(200)

    // partner: kategoria przeciwna, spięty z bazą, własne czyste etapy STA
    const partner = calls.inserted[0][0] as Record<string, unknown>
    expect(partner.category).toBe('STA')
    expect(partner.linked_order_id).toBe(10)
    expect(partner.order_number).toBe('42')
    expect(partner.disting_sheet).toBe('500')      // referencja na arkusz Disting
    expect(partner.airtable_id).toBe('')           // recordId NIE jest duplikowany (dedup!)
    expect(partner.release_date).toBeNull()
    expect(Object.keys(partner.production_stages as object)).toContain('dist_e1') // mirror STA

    // bazowe zlecenie dostaje link zwrotny + nr arkusza STA
    expect(calls.updated[0]).toMatchObject({ linked_order_id: 77, sta_sheet: '42' })
  })
})

describe('orders-intake — Titan: trójka STA + ST + Bastion', () => {
  it('STA z systemem CORE tworzy nogi ST i Bastion spięte titan_group', async () => {
    const base = {
      id: 10, order_number: '900', category: 'STA', system: 'CORE',
      company: 'X', linked_order_id: null, extra_fields: {},
    }
    const { supabase, calls } = makeFakeSupabase(
      [
        { data: base, error: null },  // DISTING PLUS check (CORE → stop)
        { data: base, error: null },  // createTitanLegs: odczyt bazy
        { data: [], error: null },    // nextOrderNumber('ST') → 1
        { data: { id: 20, order_number: '1' }, error: null }, // insert ST
        { data: [], error: null },    // nextOrderNumber('Bastion') → 1
        { data: null, error: null },  // insert Bastion
        { data: null, error: null },  // update STA (linki + rola)
      ],
      RPCS_OK(10, '900'),
    )
    __setSupabaseClient(supabase)

    const res = await handler()(post({ category: 'STA', system: 'CORE' }))
    expect(res.status).toBe(200)
    expect(calls.inserted).toHaveLength(2)

    const st = calls.inserted[0][0] as Record<string, unknown>
    expect(st.category).toBe('ST')
    expect(st.linked_order_id).toBe(10)
    expect(st.sta_ref).toBe('900')
    expect(st.extra_fields).toMatchObject({ titan_group: 10, titan_role: 'ST' })
    expect(Object.keys(st.production_stages as object)).toContain('osc')

    const bastion = calls.inserted[1][0] as Record<string, unknown>
    expect(bastion.category).toBe('Bastion')
    expect(bastion.linked_order_id).toBeNull()
    expect(bastion.extra_fields).toMatchObject({ titan_group: 10, titan_role: 'Bastion' })

    // STA dopina linki: partner ST + numer arkusza + własna rola w grupie
    expect(calls.updated[0]).toMatchObject({
      linked_order_id: 20,
      st_sheet: '1',
      extra_fields: { titan_group: 10, titan_role: 'STA' },
    })
  })
})
