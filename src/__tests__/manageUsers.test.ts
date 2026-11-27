import { beforeAll, describe, expect, it } from 'vitest'
// Test handlera manage-users: autoryzacja po ROLI (admin + legacy manager),
// tworzenie/usuwanie kont, walidacja domeny — zgłoszenia #16/#17/#18.
import '../../supabase/functions/manage-users/index'
import { __handlers } from './stubs/deno-http-server'
import { __setSupabaseClient } from './stubs/esm-supabase'

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).Deno = { env: { get: () => 'http://stub.local' } }
})

const handler = () => __handlers[0]

type FakeOpts = {
  callerId?: string | null
  role?: string
  createdUserId?: string
  deleteError?: { message: string } | null
  /** profile kont docelowych (po id) — do ochrony superadmina (maybeSingle) */
  targets?: Record<string, { role: string; categories?: string[] }>
  /** konta z wpisem w crm.dostep (dostęp do CRM Po Drzwi) */
  crmUsers?: string[]
  /** błąd odczytu crm.dostep (np. chwilowa awaria) */
  crmError?: { message: string } | null
  /** liczba wierszy z autorem = konto, klucz `schemat.tabela.kolumna` (historia przy delete) */
  history?: Record<string, number>
  /** błąd liczenia historii (dla wszystkich tabel) */
  historyError?: { message: string } | null
  /** konta w auth (list_status): banned_until */
  authUsers?: Array<{ id: string; banned_until?: string | null }>
}

function makeFakeSupabase(opts: FakeOpts) {
  const {
    callerId = 'caller-1',
    role = 'admin',
    createdUserId = 'new-user-1',
    deleteError = null,
    targets = {},
    crmUsers = [],
    crmError = null,
    history = {},
    historyError = null,
    authUsers = [],
  } = opts
  const calls = { created: [] as unknown[], deleted: [] as string[], updated: [] as string[] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeBuilder = (schema: string, table: string): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {}
    let lastEq: string | null = null
    let selCol = ''
    builder.select = (col?: string) => {
      selCol = String(col ?? '')
      return builder
    }
    // zapytanie z { count, head } jest awaitowane bezpośrednio (bez single/maybeSingle)
    builder.then = (resolve: (v: unknown) => unknown) => {
      if (schema === 'crm' && table === 'dostep') {
        return resolve({ data: crmError ? null : crmUsers.map((user_id) => ({ user_id })), error: crmError })
      }
      if (table === 'profiles') {
        return resolve({ data: Object.entries(targets).map(([id, t]) => ({ id, categories: [], ...t })), error: null })
      }
      return resolve(
        historyError
          ? { count: null, error: historyError }
          : { count: history[`${schema}.${table}.${selCol}`] ?? 0, error: null },
      )
    }
    builder.eq = (_col: string, v: string) => {
      lastEq = v
      return builder
    }
    builder.single = async () => ({ data: { role }, error: null })
    builder.maybeSingle = async () => {
      if (schema === 'crm' && table === 'dostep') {
        if (crmError) return { data: null, error: crmError }
        return { data: lastEq && crmUsers.includes(lastEq) ? { user_id: lastEq } : null, error: null }
      }
      return { data: lastEq && targets[lastEq] ? targets[lastEq] : null, error: null }
    }
    return builder
  }
  const supabase = {
    from: (table: string) => makeBuilder('public', table),
    schema: (schema: string) => ({ from: (table: string) => makeBuilder(schema, table) }),
    auth: {
      getUser: async () =>
        callerId
          ? { data: { user: { id: callerId } }, error: null }
          : { data: { user: null }, error: { message: 'bad jwt' } },
      admin: {
        createUser: async (args: unknown) => {
          calls.created.push(args)
          return { data: { user: { id: createdUserId } }, error: null }
        },
        deleteUser: async (id: string) => {
          calls.deleted.push(id)
          return { error: deleteError }
        },
        listUsers: async () => ({ data: { users: authUsers }, error: null }),
        updateUserById: async (id: string) => {
          calls.updated.push(id)
          return { error: null }
        },
      },
    },
  }
  return { supabase, calls }
}

const post = (body: unknown, withAuth = true) =>
  new Request('http://edge.local/', {
    method: 'POST',
    headers: withAuth ? { Authorization: 'Bearer jwt', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })

describe('manage-users — autoryzacja', () => {
  it('brak nagłówka Authorization → 401; nieważny JWT → 401', async () => {
    __setSupabaseClient(makeFakeSupabase({}).supabase)
    expect((await handler()(post({ action: 'create' }, false))).status).toBe(401)
    __setSupabaseClient(makeFakeSupabase({ callerId: null }).supabase)
    expect((await handler()(post({ action: 'create' }))).status).toBe(401)
  })

  it('rola bez uprawnień (np. kierownik_produkcji) → 403', async () => {
    __setSupabaseClient(makeFakeSupabase({ role: 'kierownik_produkcji' }).supabase)
    expect((await handler()(post({ action: 'create' }))).status).toBe(403)
  })

  it('admin (nowe role) ORAZ legacy manager przechodzą — migracja ról nie odetnie panelu', async () => {
    for (const role of ['admin', 'manager']) {
      const { supabase } = makeFakeSupabase({ role })
      __setSupabaseClient(supabase)
      const res = await handler()(post({ action: 'create', email: 'jan@krcenter.pl', password: 'x' }))
      expect(res.status, `rola ${role}`).toBe(200)
    }
  })
})

describe('manage-users — akcje', () => {
  it('create: waliduje domenę @krcenter.pl i wymaga hasła', async () => {
    __setSupabaseClient(makeFakeSupabase({}).supabase)
    expect((await handler()(post({ action: 'create', email: 'jan@gmail.com', password: 'x' }))).status).toBe(400)
    expect((await handler()(post({ action: 'create', email: 'jan@krcenter.pl' }))).status).toBe(400)
  })

  it('create: sukces zwraca id nowego konta', async () => {
    const { supabase, calls } = makeFakeSupabase({ createdUserId: 'u-77' })
    __setSupabaseClient(supabase)
    const res = await handler()(post({ action: 'create', email: 'Jan@KRCENTER.pl', password: 'tajne' }))
    const body = (await res.json()) as { user: { id: string } }
    expect(body.user.id).toBe('u-77')
    // e-mail znormalizowany do małych liter
    expect(calls.created[0]).toMatchObject({ email: 'jan@krcenter.pl', email_confirm: true })
  })

  it('delete: nie pozwala usunąć własnego konta', async () => {
    __setSupabaseClient(makeFakeSupabase({ callerId: 'me' }).supabase)
    const res = await handler()(post({ action: 'delete', user_id: 'me' }))
    expect(res.status).toBe(400)
  })

  it('delete: sukces usuwa wskazane konto; błąd z auth → 400 z komunikatem', async () => {
    const ok = makeFakeSupabase({})
    __setSupabaseClient(ok.supabase)
    const res = await handler()(post({ action: 'delete', user_id: 'u-5' }))
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true)
    expect(ok.calls.deleted).toEqual(['u-5'])

    const fail = makeFakeSupabase({ deleteError: { message: 'foreign key' } })
    __setSupabaseClient(fail.supabase)
    expect((await handler()(post({ action: 'delete', user_id: 'u-6' }))).status).toBe(400)
  })

  it('nieznana akcja → 400', async () => {
    __setSupabaseClient(makeFakeSupabase({}).supabase)
    expect((await handler()(post({ action: 'wtf' }))).status).toBe(400)
  })
})

// CRM Po Drzwi (brief 14.11.2026): rola superadmin, domena @podrzwi.pl, ochrona
// konta superadmina przed adminem (ban i reset hasła idą service_role poza RLS).
describe('manage-users — superadmin i CRM Po Drzwi', () => {
  it('superadmin zarządza kontami jak admin', async () => {
    __setSupabaseClient(makeFakeSupabase({ role: 'superadmin' }).supabase)
    expect((await handler()(post({ action: 'create', email: 'jan@krcenter.pl', password: 'x' }))).status).toBe(200)
  })

  it('create: dopuszcza @podrzwi.pl, nadal odrzuca inne domeny', async () => {
    const { supabase, calls } = makeFakeSupabase({ createdUserId: 'u-magda' })
    __setSupabaseClient(supabase)
    const res = await handler()(post({ action: 'create', email: 'Magda@PoDrzwi.pl', password: 'tajne' }))
    expect(res.status).toBe(200)
    expect(calls.created[0]).toMatchObject({ email: 'magda@podrzwi.pl' })
    expect((await handler()(post({ action: 'create', email: 'jan@gmail.com', password: 'x' }))).status).toBe(400)
  })

  it('admin nie dezaktywuje, nie resetuje hasła i nie usuwa konta superadmina → 403', async () => {
    const targets = { 'sa-1': { role: 'superadmin' }, 'pp-1': { role: 'pracownik_produkcji' } }
    const { supabase, calls } = makeFakeSupabase({ role: 'admin', targets })
    __setSupabaseClient(supabase)
    expect((await handler()(post({ action: 'deactivate', user_id: 'sa-1' }))).status).toBe(403)
    expect((await handler()(post({ action: 'reset_password', user_id: 'sa-1', password: 'nowehaslo' }))).status).toBe(403)
    expect((await handler()(post({ action: 'delete', user_id: 'sa-1' }))).status).toBe(403)
    expect(calls.updated).toEqual([])
    expect(calls.deleted).toEqual([])
    // zwykłe konto — bez zmian w zachowaniu
    expect((await handler()(post({ action: 'deactivate', user_id: 'pp-1' }))).status).toBe(200)
    expect((await handler()(post({ action: 'reset_password', user_id: 'pp-1', password: 'nowehaslo' }))).status).toBe(200)
    expect(calls.updated).toEqual(['pp-1', 'pp-1'])
  })

  it('superadmin może zarządzać kontem innego superadmina', async () => {
    const targets = { 'sa-2': { role: 'superadmin' } }
    const { supabase, calls } = makeFakeSupabase({ role: 'superadmin', targets })
    __setSupabaseClient(supabase)
    expect((await handler()(post({ action: 'deactivate', user_id: 'sa-2' }))).status).toBe(200)
    expect((await handler()(post({ action: 'reset_password', user_id: 'sa-2', password: 'nowehaslo' }))).status).toBe(200)
    expect(calls.updated).toEqual(['sa-2', 'sa-2'])
  })
})

// Testy 27.11 (runda 3): konto z dostępem do CRM Po Drzwi (crm.dostep) — jak superadmin.
describe('manage-users — konta z dostępem do CRM Po Drzwi', () => {
  it('admin nie resetuje hasła, nie dezaktywuje i nie usuwa konta z wpisem w crm.dostep → 403', async () => {
    const targets = { 'h-1': { role: 'obsluga_klienta' } }
    const { supabase, calls } = makeFakeSupabase({ role: 'admin', targets, crmUsers: ['h-1'] })
    __setSupabaseClient(supabase)
    for (const body of [
      { action: 'reset_password', user_id: 'h-1', password: 'nowehaslo' },
      { action: 'deactivate', user_id: 'h-1' },
      { action: 'reactivate', user_id: 'h-1' },
      { action: 'delete', user_id: 'h-1' },
    ]) {
      const res = await handler()(post(body))
      expect(res.status, body.action).toBe(403)
      expect(((await res.json()) as { error: string }).error).toMatch(/CRM Po Drzwi/)
    }
    expect(calls.updated).toEqual([])
    expect(calls.deleted).toEqual([])
  })

  it('superadmin zarządza kontem z dostępem do CRM', async () => {
    const { supabase, calls } = makeFakeSupabase({ role: 'superadmin', crmUsers: ['h-1'] })
    __setSupabaseClient(supabase)
    expect((await handler()(post({ action: 'reset_password', user_id: 'h-1', password: 'nowehaslo' }))).status).toBe(200)
    expect((await handler()(post({ action: 'deactivate', user_id: 'h-1' }))).status).toBe(200)
    expect(calls.updated).toEqual(['h-1', 'h-1'])
  })

  it('błąd odczytu crm.dostep → odmowa (nie zgadujemy)', async () => {
    const { supabase, calls } = makeFakeSupabase({ role: 'admin', crmError: { message: 'timeout' } })
    __setSupabaseClient(supabase)
    expect((await handler()(post({ action: 'reset_password', user_id: 'x-1', password: 'nowehaslo' }))).status).toBe(403)
    expect(calls.updated).toEqual([])
  })
})

// Testy 27.11 (runda 3): usunięcie konta z historią zerowało autora (FK ON DELETE SET NULL).
describe('manage-users — delete konta z historią', () => {
  it('konto z ruchami magazynowymi / ofertami CRM → 409 z liczbami, bez usuwania', async () => {
    const { supabase, calls } = makeFakeSupabase({
      history: {
        'public.warehouse_movements.created_by': 12,
        'crm.zdarzenia.kto': 3,
        'public.purchase_orders.created_by': 1,
        'public.purchase_orders.sent_by': 2,
      },
    })
    __setSupabaseClient(supabase)
    const res = await handler()(post({ action: 'delete', user_id: 'u-hist' }))
    expect(res.status).toBe(409)
    const msg = ((await res.json()) as { error: string }).error
    expect(msg).toContain('ruchy magazynowe: 12')
    expect(msg).toContain('zdarzenia CRM: 3')
    expect(msg).toContain('zamówienia do dostawców: 3')
    expect(msg).toContain('Dezaktywuj')
    expect(calls.deleted).toEqual([])
  })

  it('błąd liczenia historii → odmowa, bez usuwania', async () => {
    const { supabase, calls } = makeFakeSupabase({ historyError: { message: 'timeout' } })
    __setSupabaseClient(supabase)
    expect((await handler()(post({ action: 'delete', user_id: 'u-x' }))).status).toBe(409)
    expect(calls.deleted).toEqual([])
  })
})

// Testy 27.11 (runda 3): lista użytkowników nie pokazywała, kto jest zablokowany.
describe('manage-users — list_status', () => {
  const targets = {
    'pp-1': { role: 'pracownik_produkcji', categories: ['STA'] },
    'pp-2': { role: 'pracownik_produkcji', categories: ['ALU'] },
    'sa-1': { role: 'superadmin' },
    'h-1': { role: 'obsluga_klienta' },
  }
  const authUsers = [
    { id: 'pp-1', banned_until: '2126-01-01T00:00:00Z' },
    { id: 'pp-2', banned_until: '2020-01-01T00:00:00Z' }, // ban wygasł
    { id: 'sa-1', banned_until: null },
    { id: 'h-1' },
  ]

  it('admin: banned z banned_until w przyszłości, locked dla superadmina i konta z CRM', async () => {
    __setSupabaseClient(makeFakeSupabase({ role: 'admin', targets, authUsers, crmUsers: ['h-1'] }).supabase)
    const res = await handler()(post({ action: 'list_status' }))
    expect(res.status).toBe(200)
    const { users } = (await res.json()) as { users: Array<{ id: string; banned: boolean; locked: boolean }> }
    const byId = Object.fromEntries(users.map((u) => [u.id, u]))
    expect(byId['pp-1']).toEqual({ id: 'pp-1', banned: true, locked: false })
    expect(byId['pp-2']).toEqual({ id: 'pp-2', banned: false, locked: false })
    expect(byId['sa-1'].locked).toBe(true)
    expect(byId['h-1'].locked).toBe(true)
  })

  it('superadmin: nic nie jest locked', async () => {
    __setSupabaseClient(makeFakeSupabase({ role: 'superadmin', targets, authUsers, crmUsers: ['h-1'] }).supabase)
    const { users } = (await (await handler()(post({ action: 'list_status' }))).json()) as {
      users: Array<{ locked: boolean }>
    }
    expect(users.every((u) => !u.locked)).toBe(true)
  })

  it('kierownik działu: tylko pracownicy produkcji ze swoich kategorii', async () => {
    const { supabase } = makeFakeSupabase({ role: 'kierownik_dzialu', targets, authUsers })
    // kategorie kierownika (single() profilu wołającego)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origFrom = (supabase as any).from
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(supabase as any).from = (t: string) => {
      const b = origFrom(t)
      b.single = async () => ({ data: { role: 'kierownik_dzialu', categories: ['STA'] }, error: null })
      return b
    }
    __setSupabaseClient(supabase)
    const { users } = (await (await handler()(post({ action: 'list_status' }))).json()) as { users: Array<{ id: string }> }
    expect(users.map((u) => u.id)).toEqual(['pp-1'])
  })
})
