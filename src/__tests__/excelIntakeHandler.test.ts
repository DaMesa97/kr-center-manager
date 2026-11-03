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
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'gte', 'limit', 'order', 'range', 'single', 'maybeSingle', 'update']) {
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
        { data: [], error: null }, // findBotTwin po treści (numer klienta pusty/'-'): brak botów
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

  it('duplikat (kategoria + numer + TA SAMA treść) → pominięty, zero insertów', async () => {
    const { supabase, calls } = makeFakeSupabase(
      [
        // dedup: istnieje zamówienie o tym numerze i zgodnej treści
        // (model/szerokość/firma) — dopiero wtedy to duplikat
        { data: [{ id: 1, model: '', width: '', company: 'ADAM KOŚCIELNY', client_order_number: '' }], error: null },
      ],
      VALID_KEY_RPCS,
    )
    __setSupabaseClient(supabase)

    const res = await handler()(post([BASTION_ROW]))
    const body = (await res.json()) as { summary: Record<string, number> }
    expect(body.summary).toMatchObject({ received: 1, created: 0, duplicates: 1 })
    expect(calls.inserted).toHaveLength(0)
  })

  it('kolizja numeru z INNYM zamówieniem → nowy numer z RPC + flaga do weryfikacji (nie gubimy wiersza)', async () => {
    const base = { id: 21, order_number: '999', category: 'Bastion', system: 'BASIC LOCK PLUS', extra_fields: {}, linked_order_id: null }
    const { supabase, calls } = makeFakeSupabase(
      [
        // dedup: numer zajęty przez INNE zamówienie (inny model/firma)
        { data: [{ id: 1, model: 'TORINO 13B', width: '90', company: 'ROJAR Tuchów', client_order_number: 'X/1' }], error: null },
        { data: [], error: null }, // findExcelTwin: brak identycznego wiersza z ostatnich godzin
        { data: [], error: null }, // findBotTwin po treści (numer klienta pusty/'-'): brak botów
        { data: base, error: null }, // insert
        { data: base, error: null }, // partner check (stop)
        { data: base, error: null }, // titan check (stop — BASIC nie jest Titanem)
      ],
      { ...VALID_KEY_RPCS, get_next_order_number: { data: '999', error: null } },
    )
    __setSupabaseClient(supabase)

    const res = await handler()(post([BASTION_ROW]))
    const body = (await res.json()) as { results: Array<{ status: string }> }
    expect(body.results[0].status).toBe('created')
    expect(calls.inserted).toHaveLength(1)
    const payload = calls.inserted[0][0] as Record<string, unknown>
    expect(payload.order_number).toBe('999')
    const ef = payload.extra_fields as Record<string, unknown>
    expect(ef.needs_review).toBe(true)
    expect(ef.sheet_number_conflict).toBe('4145')
  })

  it('kolizja numeru W CHWILI ZAPISU (równoległy wiersz) → ponowienie z nowym numerem + flaga (19.10 gubiło)', async () => {
    const base = { id: 31, order_number: '7001', category: 'Bastion', system: 'BASIC LOCK PLUS', extra_fields: {}, linked_order_id: null }
    const collision = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "orders_unique_number_per_category_new"' } }
    const { supabase, calls } = makeFakeSupabase(
      [
        { data: [], error: null }, // dedup: numer wolny przy sprawdzeniu…
        { data: [], error: null }, // findBotTwin po treści (numer klienta pusty/'-'): brak botów
        collision, // …ale równoległy wiersz zajął go przed zapisem
        { data: base, error: null }, // ponowiony insert z nowym numerem
        { data: base, error: null }, // partner check (stop)
        { data: base, error: null }, // titan check (stop)
      ],
      { ...VALID_KEY_RPCS, get_next_order_number: { data: '7001', error: null } },
    )
    __setSupabaseClient(supabase)

    const res = await handler()(post([BASTION_ROW]))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; results: Array<{ status: string }> }
    expect(body.success).toBe(true)
    expect(body.results[0].status).toBe('created')
    expect(calls.inserted).toHaveLength(2)
    const payload = calls.inserted[1][0] as Record<string, unknown>
    expect(payload.order_number).toBe('7001')
    const ef = payload.extra_fields as Record<string, unknown>
    expect(ef.needs_review).toBe(true)
    expect(ef.sheet_number_conflict).toBe('4145')
  })

  it('błąd zapisu (nie kolizja) → 500 + success:false, żeby Make ponowił zamiast uznać za sukces', async () => {
    const { supabase } = makeFakeSupabase(
      [
        { data: [], error: null }, // dedup: brak
        { data: [], error: null }, // findBotTwin po treści (numer klienta pusty/'-'): brak botów
        { data: null, error: { code: '23502', message: 'null value in column "company"' } },
      ],
      VALID_KEY_RPCS,
    )
    __setSupabaseClient(supabase)

    const res = await handler()(post([BASTION_ROW]))
    expect(res.status).toBe(500)
    const body = (await res.json()) as { success: boolean; summary: Record<string, number> }
    expect(body.success).toBe(false)
    expect(body.summary.errors).toBe(1)
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
        { data: [], error: null },          // wiersz 1: findBotTwin po treści: brak
        { data: base, error: null },        // wiersz 1: insert
        { data: base, error: null },        // wiersz 1: partner check (stop)
        { data: base, error: null },        // wiersz 1: titan check (stop)
        // wiersz 2: duplikat (zgodna treść: firma/model/szerokość)
        { data: [{ id: 9, model: '', width: '', company: 'B', client_order_number: '' }], error: null },
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

  it('dedup krzyżowy: wiersz z numerem klienta istniejącym u bota → duplicate_bot, zero insertów', async () => {
    const { supabase, calls } = makeFakeSupabase(
      [
        { data: [], error: null }, // dedup po (kategoria, numer): brak
        {
          // findBotTwin: świeże boty w kategorii
          data: [{ id: 77, order_number: '4312', company: ' po drzwi ', client_order_number: '49360300/sendal' }],
          error: null,
        },
      ],
      VALID_KEY_RPCS,
    )
    __setSupabaseClient(supabase)

    const row = {
      'Nazwa firmy': 'PO DRZWI', System: 'NORMAL PLUS', 'Numer zlecenia': '2289',
      'Numer zamówienia': ' 49360300/SENDAL ',
    }
    const res = await handler()(post([row]))
    const body = (await res.json()) as { summary: Record<string, number>; results: Array<Record<string, unknown>> }
    expect(body.summary).toMatchObject({ received: 1, created: 0, bot_duplicates: 1 })
    expect(body.results[0]).toMatchObject({ status: 'duplicate_bot', bot_order_id: 77, bot_order_number: '4312' })
    expect(calls.inserted).toHaveLength(0)
  })

  it('dedup krzyżowy: łapie mimo różnie zapisanej firmy (bot: PO DRZWI, arkusz: PO DRZWI ŻORY)', async () => {
    const { supabase, calls } = makeFakeSupabase(
      [
        { data: [], error: null },
        { data: [{ id: 91, order_number: '4318', company: 'PO DRZWI', client_order_number: '49495368/Rog-stal' }], error: null },
      ],
      VALID_KEY_RPCS,
    )
    __setSupabaseClient(supabase)

    const row = {
      'Nazwa firmy': 'PO DRZWI ŻORY', System: 'NORMAL PLUS', 'Numer zlecenia': '2309',
      'Numer zamówienia': '49495368/Rog-stal',
    }
    const res = await handler()(post([row]))
    const body = (await res.json()) as { summary: Record<string, number>; results: Array<Record<string, unknown>> }
    expect(body.summary).toMatchObject({ received: 1, created: 0, bot_duplicates: 1 })
    expect(body.results[0]).toMatchObject({ status: 'duplicate_bot', bot_order_number: '4318' })
    expect(calls.inserted).toHaveLength(0)
  })

  it('dedup krzyżowy: bot z innym numerem klienta NIE blokuje insertu', async () => {
    const base = { id: 13, order_number: '2290', category: 'STA', system: 'NORMAL', extra_fields: {}, linked_order_id: null }
    const { supabase, calls } = makeFakeSupabase(
      [
        { data: [], error: null }, // dedup po numerze: brak
        { data: [{ id: 77, order_number: '4312', company: 'PO DRZWI', client_order_number: 'INNY/NUMER' }], error: null }, // findBotTwin
        { data: base, error: null }, // insert
        { data: base, error: null }, // partner check (stop)
        { data: base, error: null }, // titan check (stop)
      ],
      VALID_KEY_RPCS,
    )
    __setSupabaseClient(supabase)

    const row = {
      'Nazwa firmy': 'PO DRZWI', System: 'NORMAL', 'Numer zlecenia': '2290',
      'Numer zamówienia': '49360300/SENDAL',
    }
    const res = await handler()(post([row]))
    const body = (await res.json()) as { summary: Record<string, number> }
    expect(body.summary).toMatchObject({ received: 1, created: 1, bot_duplicates: 0 })
    expect(calls.inserted).toHaveLength(1)
  })

  it('dedup krzyżowy po TREŚCI: numer klienta "-" + identyczne drzwi u bota sprzed chwili → duplicate_bot (3.11: 7 dubli)', async () => {
    const { supabase, calls } = makeFakeSupabase(
      [
        { data: [], error: null }, // dedup po numerze: brak
        {
          // findBotTwin po treści: bot FTB sprzed 6 minut, te same drzwi
          data: [{
            id: 15990, order_number: '4571', company: 'FTB # WAŁBRZYCH', client_order_number: '-',
            model: 'VENTO 12B', width: '80E', height: 'STD', wing_color: 'DĄB ZŁOTY', direction: 'LEWE', quantity: 1,
          }],
          error: null,
        },
      ],
      VALID_KEY_RPCS,
    )
    __setSupabaseClient(supabase)

    const row = {
      'Nazwa firmy': 'FTB # WAŁBRZYCH', System: 'NORMAL', 'Numer zlecenia': '2781', 'Numer zamówienia': '-',
      Model: 'VENTO 12B', 'Szerokość': '80E', 'Wysokość': 'STD', 'Kolor skrzydła': 'DĄB ZŁOTY', Kierunek: 'LEWE', 'Ilość': '1',
    }
    const res = await handler()(post([row]))
    const body = (await res.json()) as { summary: Record<string, number>; results: Array<Record<string, unknown>> }
    expect(body.summary).toMatchObject({ received: 1, created: 0, bot_duplicates: 1 })
    expect(body.results[0]).toMatchObject({ status: 'duplicate_bot', bot_order_number: '4571' })
    expect(calls.inserted).toHaveLength(0)
  })

  it('dedup krzyżowy po TREŚCI: numer "-", ale inne drzwi (inna strona) → wchodzi normalnie', async () => {
    const base = { id: 14, order_number: '2291', category: 'STA', system: 'NORMAL', extra_fields: {}, linked_order_id: null }
    const { supabase, calls } = makeFakeSupabase(
      [
        { data: [], error: null }, // dedup po numerze: brak
        {
          data: [{
            id: 15990, order_number: '4571', company: 'FTB # WAŁBRZYCH', client_order_number: '-',
            model: 'VENTO 12B', width: '80E', height: 'STD', wing_color: 'DĄB ZŁOTY', direction: 'PRAWE', quantity: 1,
          }],
          error: null,
        },
        { data: base, error: null }, // insert
        { data: base, error: null }, // partner check
        { data: base, error: null }, // titan check
      ],
      VALID_KEY_RPCS,
    )
    __setSupabaseClient(supabase)

    const row = {
      'Nazwa firmy': 'FTB # WAŁBRZYCH', System: 'NORMAL', 'Numer zlecenia': '2291', 'Numer zamówienia': '-',
      Model: 'VENTO 12B', 'Szerokość': '80E', 'Wysokość': 'STD', 'Kolor skrzydła': 'DĄB ZŁOTY', Kierunek: 'LEWE', 'Ilość': '1',
    }
    const res = await handler()(post([row]))
    const body = (await res.json()) as { summary: Record<string, number> }
    expect(body.summary).toMatchObject({ received: 1, created: 1, bot_duplicates: 0 })
    expect(calls.inserted).toHaveLength(1)
  })

  it('konflikt numeru arkusza + identyczny wiersz z Excela sprzed chwili → duplicate, bez nowego numeru (28.10: 958 → 7173)', async () => {
    const { supabase, calls } = makeFakeSupabase(
      [
        // dedup: numer 7170 zajęty przez INNE zamówienie (LUX-401)
        { data: [{ id: 1, model: 'LUX-401', width: '90', company: 'INNA FIRMA', client_order_number: 'Q/9' }], error: null },
        {
          // findExcelTwin: ten sam wiersz wszedł godzinę temu jako 958
          data: [{
            id: 15678, order_number: '958', company: 'MT 73 SYSTEM  Wodzisław Śląski', client_order_number: '228W',
            model: 'A-112-INOX', width: '80 NW', height: '197 Z OŚC WĘŻSZE O 10mm', wing_color: 'GRAFIT STARY', direction: 'PRAWE', quantity: 1,
          }],
          error: null,
        },
      ],
      { ...VALID_KEY_RPCS, get_next_order_number: { data: '7173', error: null } },
    )
    __setSupabaseClient(supabase)

    const row = {
      'Nazwa firmy': 'MT 73 SYSTEM  Wodzisław Śląski', System: 'BASIC', 'Numer zlecenia': '7170', 'Numer zamówienia': '228W',
      Model: 'A-112-INOX', 'Szerokość': '80 NW', 'Wysokość': '197 Z OŚC WĘŻSZE O 10mm', 'Kolor skrzydła cał.': 'GRAFIT STARY', Kierunek: 'PRAWE', 'Ilość': '1',
    }
    const res = await handler()(post([row]))
    const body = (await res.json()) as { summary: Record<string, number>; results: Array<Record<string, unknown>> }
    expect(body.summary).toMatchObject({ received: 1, created: 0, duplicates: 1 })
    expect(body.results[0]).toMatchObject({ status: 'duplicate' })
    expect(calls.inserted).toHaveLength(0)
    expect(calls.rpc.map(([n]) => n)).not.toContain('get_next_order_number')
  })

  it('akceptuje też pojedynczy obiekt (nie tylko tablicę)', async () => {
    const base = { id: 12, order_number: '3', category: 'STA', system: 'NORMAL', extra_fields: {}, linked_order_id: null }
    const { supabase } = makeFakeSupabase(
      [
        { data: [], error: null },
        { data: [], error: null }, // findBotTwin po treści: brak
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
