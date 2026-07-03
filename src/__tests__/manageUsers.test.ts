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
}

function makeFakeSupabase(opts: FakeOpts) {
  const { callerId = 'caller-1', role = 'admin', createdUserId = 'new-user-1', deleteError = null } = opts
  const calls = { created: [] as unknown[], deleted: [] as string[] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq']) builder[m] = () => builder
  builder.single = async () => ({ data: { role }, error: null })
  const supabase = {
    from: () => builder,
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
