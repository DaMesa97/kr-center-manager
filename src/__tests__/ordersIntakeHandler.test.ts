import { beforeAll, describe, expect, it } from 'vitest'
// Test INTEGRACYJNY handlera orders-intake (konfigurator) — w tym najbardziej
// krucha logika biznesowa: auto-tworzenie pary DISTING PLUS i nóg Titana.
import { wykonawcaFromPayload } from '../../supabase/functions/orders-intake/index'
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
        { data: { id: 77, order_number: '42' }, error: null }, // insert partnera
        { data: null, error: null },                        // update bazowego (linki)
        { data: base, error: null },                        // createTitanLegs: odczyt (nie Titan → stop)
      ],
      {
        ...RPCS_OK(10, '500'),
        // nextOrderNumber idzie teraz przez RPC (fix limitu 1000 wierszy)
        get_next_order_number: { data: '42', error: null },
      },
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

describe('orders-intake — firma realizująca (firmaRealizujaca → extra_fields.wykonawca)', () => {
  it('mapuje KR→Center, MR→Profil; śmieci/brak → null', () => {
    expect(wykonawcaFromPayload({ firmaRealizujaca: 'KR' })).toBe('Center')
    expect(wykonawcaFromPayload({ firmaRealizujaca: ' mr ' })).toBe('Profil')
    expect(wykonawcaFromPayload({ firmaRealizujaca: 'XX' })).toBeNull()
    expect(wykonawcaFromPayload({})).toBeNull()
    expect(wykonawcaFromPayload(null)).toBeNull()
  })

  it('zapisuje wykonawcę do extra_fields zlecenia przed parą/nogami', async () => {
    const base = {
      id: 10, order_number: '900', category: 'STA', system: 'ZWYKŁY',
      company: 'X', linked_order_id: null, extra_fields: {},
    }
    const { supabase, calls } = makeFakeSupabase(
      [
        { data: { id: 10, extra_fields: {} }, error: null }, // applyWykonawca: odczyt
        { data: null, error: null },                          // applyWykonawca: update
        { data: base, error: null },                          // DISTING PLUS check (nie DP → stop)
        { data: base, error: null },                          // createTitanLegs check (nie Titan → stop)
      ],
      RPCS_OK(10, '900'),
    )
    __setSupabaseClient(supabase)

    const res = await handler()(post({ category: 'STA', system: 'ZWYKŁY', firmaRealizujaca: 'MR' }))
    expect(res.status).toBe(200)
    expect(calls.updated[0]).toMatchObject({ extra_fields: { wykonawca: 'Profil' } })
  })

  it('nie nadpisuje już ustawionego wykonawcy', async () => {
    const base = {
      id: 10, order_number: '900', category: 'STA', system: 'ZWYKŁY',
      company: 'X', linked_order_id: null, extra_fields: { wykonawca: 'WZ' },
    }
    const { supabase, calls } = makeFakeSupabase(
      [
        { data: { id: 10, extra_fields: { wykonawca: 'WZ' } }, error: null }, // applyWykonawca: odczyt → stop
        { data: base, error: null }, // DISTING PLUS check
        { data: base, error: null }, // createTitanLegs check
      ],
      RPCS_OK(10, '900'),
    )
    __setSupabaseClient(supabase)

    const res = await handler()(post({ category: 'STA', system: 'ZWYKŁY', firmaRealizujaca: 'KR' }))
    expect(res.status).toBe(200)
    expect(calls.updated).toHaveLength(0)
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
        { data: [], error: null },    // istniejące nogi grupy (brak)
        { data: { id: 20, order_number: '1' }, error: null }, // insert ST
        { data: { id: 21, order_number: '2' }, error: null }, // insert Bastion
        { data: null, error: null },  // update STA (linki + rola)
      ],
      {
        ...RPCS_OK(10, '900'),
        // nextOrderNumber idzie teraz przez RPC (fix limitu 1000 wierszy)
        get_next_order_number: { data: '1', error: null },
      },
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

  // testy 27.11 (runda 3): błąd nogi nie może przejść po cichu, a STA bez kompletu nóg nie dostaje titan_group
  const titanBase = { id: 10, order_number: '900', category: 'STA', system: 'CORE', company: 'X', linked_order_id: null, extra_fields: { warnings: ['stare'] } }

  it('błąd nogi Bastion: STA bez titan_group, needs_review + ostrzeżenie, link do ST zostaje', async () => {
    const { supabase, calls } = makeFakeSupabase(
      [
        { data: titanBase, error: null },
        { data: titanBase, error: null },
        { data: [], error: null },
        { data: { id: 20, order_number: '1' }, error: null },              // insert ST
        { data: null, error: { code: '23502', message: 'null value' } },   // insert Bastion — błąd (nie kolizja)
        { data: null, error: null },                                       // update STA
      ],
      { ...RPCS_OK(10, '900'), get_next_order_number: { data: '1', error: null } },
    )
    __setSupabaseClient(supabase)
    const res = await handler()(post({ category: 'STA', system: 'CORE' }))
    expect(res.status).toBe(200)
    const upd = calls.updated[0] as Record<string, unknown>
    const ef = upd.extra_fields as Record<string, unknown>
    expect(ef.titan_group).toBeUndefined()
    expect(ef.needs_review).toBe(true)
    expect(ef.warnings).toEqual(['stare', 'nie powstała noga Bastion: null value'])
    expect(upd).toMatchObject({ linked_order_id: 20, st_sheet: '1' })
  })

  it('kolizja numeru nogi ST (23505): nowy numer i ponowny insert', async () => {
    const { supabase, calls } = makeFakeSupabase(
      [
        { data: titanBase, error: null },
        { data: titanBase, error: null },
        { data: [], error: null },
        { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "orders_unique_number_per_category"' } },
        { data: { id: 20, order_number: '1' }, error: null },  // ST — druga próba
        { data: { id: 21, order_number: '1' }, error: null },  // Bastion
        { data: null, error: null },
      ],
      { ...RPCS_OK(10, '900'), get_next_order_number: { data: '1', error: null } },
    )
    __setSupabaseClient(supabase)
    await handler()(post({ category: 'STA', system: 'CORE' }))
    expect(calls.inserted).toHaveLength(3)
    expect(calls.rpc.filter(([n]) => n === 'get_next_order_number')).toHaveLength(3)
    expect((calls.updated[0] as { extra_fields: Record<string, unknown> }).extra_fields).toMatchObject({ titan_group: 10, titan_role: 'STA' })
  })

  it('istniejąca noga ST (po wcześniejszym błędzie) nie jest dublowana', async () => {
    const { supabase, calls } = makeFakeSupabase(
      [
        { data: titanBase, error: null },
        { data: titanBase, error: null },
        { data: [{ id: 20, order_number: '1', category: 'ST' }], error: null },
        { data: { id: 21, order_number: '2' }, error: null },  // tylko Bastion
        { data: null, error: null },
      ],
      { ...RPCS_OK(10, '900'), get_next_order_number: { data: '2', error: null } },
    )
    __setSupabaseClient(supabase)
    await handler()(post({ category: 'STA', system: 'CORE' }))
    expect(calls.inserted).toHaveLength(1)
    expect((calls.inserted[0][0] as Record<string, unknown>).category).toBe('Bastion')
    expect(calls.updated[0]).toMatchObject({ linked_order_id: 20, extra_fields: { titan_group: 10, titan_role: 'STA' } })
  })
})

describe('orders-intake — DISTING PLUS: błąd partnera', () => {
  it('nieudany insert partnera → bazowe zlecenie needs_review + ostrzeżenie, bez powiązania', async () => {
    const base = { id: 10, order_number: '500', category: 'Disting', system: 'DISTING PLUS', company: 'TORA', linked_order_id: null, extra_fields: {} }
    const { supabase, calls } = makeFakeSupabase(
      [
        { data: base, error: null },
        { data: null, error: { code: '42501', message: 'brak uprawnień' } },  // insert partnera
        { data: null, error: null },                                          // update: oznaczenie do weryfikacji
        { data: base, error: null },                                          // createTitanLegs (nie Titan)
      ],
      { ...RPCS_OK(10, '500'), get_next_order_number: { data: '42', error: null } },
    )
    __setSupabaseClient(supabase)
    const res = await handler()(post({ category: 'Disting', system: 'DISTING PLUS' }))
    expect(res.status).toBe(200)
    expect(calls.updated).toHaveLength(1)
    const upd = calls.updated[0] as Record<string, unknown>
    expect(upd.linked_order_id).toBeUndefined()
    expect(upd.extra_fields).toEqual({ needs_review: true, warnings: ['nie powstała para DISTING PLUS (STA): brak uprawnień'] })
  })
})
