// testy 27.11 (runda 3): numer zlecenia zajęty w międzyczasie przez bota/Excel
import { describe, expect, it, vi } from 'vitest'
import { insertOrderWithNumberRetry } from '../utils'

const taken = { code: '23505', message: 'duplicate key value violates unique constraint "orders_unique_number_per_category_new"' }

describe('insertOrderWithNumberRetry', () => {
  it('wolny numer — jeden insert, bez zmiany numeru', async () => {
    const insert = vi.fn(async (row: Record<string, unknown>) => ({ data: { id: 1, order_number: row.order_number }, error: null }))
    const fetchNumber = vi.fn(async () => '999')
    const r = await insertOrderWithNumberRetry({ category: 'STA', order_number: '100' }, { fallbackCategory: 'STA', fetchNumber, insert })
    expect(r.error).toBeNull()
    expect(r.orderNumber).toBe('100')
    expect(r.renumberedFrom).toBeNull()
    expect(fetchNumber).not.toHaveBeenCalled()
  })

  it('zajęty numer — pobiera nowy i ponawia, zgłasza zmianę', async () => {
    const insert = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: taken })
      .mockImplementationOnce(async (row: Record<string, unknown>) => ({ data: { id: 2, order_number: row.order_number }, error: null }))
    const fetchNumber = vi.fn(async (cat: string) => (cat === 'Bastion' ? '101' : 'x'))
    const r = await insertOrderWithNumberRetry({ category: 'Bastion', order_number: '100' }, { fallbackCategory: 'STA', fetchNumber, insert })
    expect(r.error).toBeNull()
    expect(r.orderNumber).toBe('101')
    expect(r.renumberedFrom).toBe('100')
    expect(insert).toHaveBeenCalledTimes(2)
  })

  it('po 3 ponowieniach poddaje się z czytelnym komunikatem', async () => {
    const insert = vi.fn(async () => ({ data: null, error: taken }))
    let n = 100
    const fetchNumber = vi.fn(async () => String(++n))
    const r = await insertOrderWithNumberRetry({ category: 'ST', order_number: '100' }, { fallbackCategory: 'ST', fetchNumber, insert })
    expect(insert).toHaveBeenCalledTimes(4)
    expect(r.error?.message).toMatch(/zajęty/)
    expect(r.data).toBeNull()
  })

  it('pusty numer — pobiera przy zapisie', async () => {
    const insert = vi.fn(async (row: Record<string, unknown>) => ({ data: { id: 3, order_number: row.order_number }, error: null }))
    const r = await insertOrderWithNumberRetry({ category: 'ST', order_number: '  ' }, { fallbackCategory: 'ST', fetchNumber: async () => '55', insert })
    expect(insert.mock.calls[0][0].order_number).toBe('55')
    expect(r.renumberedFrom).toBeNull()
  })

  it('pusty numer i nie da się pobrać — nie zapisuje', async () => {
    const insert = vi.fn()
    const r = await insertOrderWithNumberRetry({ category: 'ST', order_number: '' }, { fallbackCategory: 'ST', fetchNumber: async () => '', insert })
    expect(insert).not.toHaveBeenCalled()
    expect(r.error?.message).toMatch(/brak numeru/)
  })

  it('inny błąd (nie numer) — bez ponowień', async () => {
    const insert = vi.fn(async () => ({ data: null, error: { code: '22P02', message: 'invalid input syntax for type integer' } }))
    const fetchNumber = vi.fn(async () => '1')
    const r = await insertOrderWithNumberRetry({ category: 'ST', order_number: '7' }, { fallbackCategory: 'ST', fetchNumber, insert })
    expect(insert).toHaveBeenCalledTimes(1)
    expect(fetchNumber).not.toHaveBeenCalled()
    expect(r.error?.code).toBe('22P02')
  })

  it('23505 na innym indeksie — bez ponowień', async () => {
    const insert = vi.fn(async () => ({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "orders_pkey"' } }))
    const r = await insertOrderWithNumberRetry({ category: 'ST', order_number: '7' }, { fallbackCategory: 'ST', fetchNumber: async () => '8', insert })
    expect(insert).toHaveBeenCalledTimes(1)
    expect(r.error?.message).toMatch(/orders_pkey/)
  })
})
