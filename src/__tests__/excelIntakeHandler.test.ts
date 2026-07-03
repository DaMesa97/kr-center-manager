import { beforeAll, describe, expect, it } from 'vitest'
// Test INTEGRACYJNY handlera HTTP orders-excel-intake: autoryzacja, rate limit,
// deduplikacja i szczęśliwa ścieżka — na podrobionym kliencie Supabase.
// Importujemy prawdziwy moduł Edge Function (URL-e podmienione stubami).
import '../../supabase/functions/orders-excel-intake/index'
import { __handlers } from './stubs/deno-http-server'
import { __setSupabaseClient } from './stubs/esm-supabase'

// Deno.env używane w handlerze — stub globalny
beforeAll(() => {
  ;(globalThis as Record<string, unknown>).Deno = {
    env: { get: () => 'http://stub.local' },
  }
})

const handler = () => __handlers[0]

// ── Fałszywy klient Supabase ────────────────────────────────────────────
// Każde `await supabase.from(...)....` zdejmuje kolejny wynik z kolejki.
// rpc() odpowiada wg nazwy funkcji. Rejestrujemy inserty do asercji.
type Recorded = { rpc: Array<[string, unknown]>; inserted: unknown[][] }

function makeFakeSupabase(
  queryQueue: unknown[],
  rpcResponses: Record<string, unknown>,
): { supabase: unknown; calls: Recorded } {
  const calls: Recorded = { rpc: [], inserted: [] }
  const makeBuilder = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {}
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'limit', 'order', 'range', 'single', 'maybeSingle', 'update']) {
      b[m] = () => b
    }
    b.insert = (rows: unknown[]) => {
      calls.inserted.push(rows as unknown[])
      return b
    }
    b.then = (resolve: (v: unknown) => void) =>
      resolve(queryQueue.shift() ?? { data: null, error: null })
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

const VALID_KEY_RPCS = {
  verify_api_key: { data: [{ is_valid: true, key_id: 1, rate_limit_per_minute: 60 }], error: null },
  check_rate_limit: { data: true, error: null },
  log_api_request: { data: null, error: null },
}

const post = (body: unknown, headers: Record<string, string> = { 'x-api-key': 'k' }) =>
  new Request('http://edge.local/', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const BASTION_ROW = {
  'Nazwa firmy': 'ADAM KOŚCIELNY', 'System': 'BASIC LOCK PLUS', 'Ilość': '1',
  'Numer zlecenia': '4145', 'Typ': 'KR', 'Wpisał': 'Dawid',
  'Kolor skrzydła cał.': 'AKACJA', 'Panel boczny klamkowy': '370×2080',
}

describe('orders-excel-intake — handler HTTP', () => {
  it('handler został zarejestrowany przez serve()', () => {
    expect(handler()).toBeTypeOf('function')
  })

  it('OPTIONS → 200 (CORS preflight); GET → 405', async () => {
    const { supabase } = makeFakeSupabase([], VALID_KEY_RPCS)
    __setSupabaseClient(supabase)
    expect((await handler()(new Request('http://x', { method: 'OPTIONS' }))).status).toBe(200)
    expect((await handler()(new Request('http://x', { method: 'GET' }))).status).toBe(405)
  })

  it('brak nagłówka X-API-Key → 401', async () => {
    const res = await handler()(post([BASTION_ROW], {}))
    expect(res.status).toBe(401)
  })

  it('niepoprawny JSON → 400', async () => {
    const { supabase } = makeFakeSupabase([], VALID_KEY_RPCS)
    __setSupabaseClient(supabase)
    const res = await handler()(post('to nie json{{'))
    expect(res.status).toBe(400)
  })

  it('nieważny klucz API → 401', async () => {
    const { supabase } = makeFakeSupabase([], {
      ...VALID_KEY_RPCS,
      verify_api_key: { data: [{ is_valid: false }], error: null },
    })
    __setSupabaseClient(supabase)
    const res = await handler()(post([BASTION_ROW]))
    expect(res.status).toBe(401)
  })

  it('przekroczony rate limit → 429', async () => {
    const { supabase } = makeFakeSupabase([], {
      ...VALID_KEY_RPCS,
      check_rate_limit: { data: false, error: null },
    })
    __setSupabaseClient(supabase)
    const res = await handler()(post([BASTION_ROW]))
    expect(res.status).toBe(429)
  })

  it('szczęśliwa ścieżka: wiersz Bastiona wstawiony ze zmapowanym payloadem', async () => {
    const base = { id: 10, order_number: '4145', category: 'Bastion', system: 'BASIC LOCK PLUS', extra_fields: {}, linked_order_id: null }
    const { supabase, calls } = makeFakeSupabase(
      [
        { data: [], error: null }, // dedup: brak istniejącego
        { data: base, error: null }, // insert → zwrot rekordu
        { data: base, error: null }, // createDistingPlusPartner: odczyt bazy (nie DISTING PLUS → stop)
        { data: base, error: null }, // createTitanLegs: odczyt bazy (nie Titan → stop)
      ],
      VALID_KEY_RPCS,
    )
    __setSupabaseClient(supabase)

    const res = await handler()(post([BASTION_ROW]))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; summary: Record<string, number> }
    expect(body.success).toBe(true)
    expect(body.summary).toMatchObject({ received: 1, created: 1, duplicates: 0, errors: 0 })

    // payload, który poszedł do bazy
    const payload = (calls.inserted[0][0]) as Record<string, unknown>
    expect(payload.category).toBe('Bastion')
    expect(payload.order_number).toBe('4145')
    expect(payload.entered_by).toBe('Dawid')
    expect(payload.bastion_side_panel_k).toBe('370×2080')
    expect(payload.source).toBe('excel')
    // log żądania zawsze wywołany (finally)
    expect(calls.rpc.map(([n]) => n)).toContain('log_api_request')
  })

  it('duplikat (kategoria + numer istnieje) → pominięty, zero insertów', async () => {
    const { supabase, calls } = makeFakeSupabase(
      [{ data: [{ id: 1 }], error: null }], // dedup: istnieje
      VALID_KEY_RPCS,
    )
    __setSupabaseClient(supabase)

    const res = await handler()(post([BASTION_ROW]))
    const body = (await res.json()) as { summary: Record<string, number> }
    expect(body.summary).toMatchObject({ received: 1, created: 0, duplicates: 1 })
    expect(calls.inserted).toHaveLength(0)
  })

  it('wiersz bez firmy i systemu → skipped (nie wywala całej paczki)', async () => {
    const { supabase, calls } = makeFakeSupabase([], VALID_KEY_RPCS)
    __setSupabaseClient(supabase)
    const res = await handler()(post([{ Uwagi: 'samotna notatka' }]))
    const body = (await res.json()) as { results: Array<{ status: string }> }
    expect(body.results[0].status).toBe('skipped')
    expect(calls.inserted).toHaveLength(0)
  })

  it('paczka mieszana: created + duplicate + skipped w jednym wywołaniu', async () => {
    const base = { id: 11, order_number: '1', category: 'STA', system: 'NORMAL', extra_fields: {}, linked_order_id: null }
    const { supabase, calls } = makeFakeSupabase(
      [
        { data: [], error: null },          // wiersz 1: dedup pusty
        { data: base, error: null },        // wiersz 1: insert
        { data: base, error: null },        // wiersz 1: partner check (stop)
        { data: base, error: null },        // wiersz 1: titan check (stop)
        { data: [{ id: 9 }], error: null }, // wiersz 2: duplikat
      ],
      VALID_KEY_RPCS,
    )
    __setSupabaseClient(supabase)

    const rows = [
      { 'Nazwa firmy': 'A', System: 'NORMAL', 'Numer zlecenia': '1' },
      { 'Nazwa firmy': 'B', System: 'NORMAL', 'Numer zlecenia': '2' },
      { Uwagi: 'pusty wiersz' },
    ]
    const res = await handler()(post(rows))
    const body = (await res.json()) as { summary: Record<string, number>; results: Array<{ status: string }> }
    expect(body.summary).toMatchObject({ received: 3, created: 1, duplicates: 1, errors: 0 })
    expect(body.results.map((r) => r.status)).toEqual(['created', 'duplicate', 'skipped'])
    expect(calls.inserted).toHaveLength(1)
  })

  it('akceptuje też pojedynczy obiekt (nie tylko tablicę)', async () => {
    const base = { id: 12, order_number: '3', category: 'STA', system: 'NORMAL', extra_fields: {}, linked_order_id: null }
    const { supabase } = makeFakeSupabase(
      [
        { data: [], error: null },
        { data: base, error: null },
        { data: base, error: null },
        { data: base, error: null },
      ],
      VALID_KEY_RPCS,
    )
    __setSupabaseClient(supabase)
    const res = await handler()(post({ 'Nazwa firmy': 'C', System: 'NORMAL', 'Numer zlecenia': '3' }))
    const body = (await res.json()) as { summary: Record<string, number> }
    expect(body.summary).toMatchObject({ received: 1, created: 1 })
  })
})
