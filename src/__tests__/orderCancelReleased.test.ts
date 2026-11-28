import { describe, expect, it, vi } from 'vitest'
import { anulujPotemZwroc, isOrderReleased, mozeAnulowacCalyZestawTitan, splitCancellableLegs } from '../lib/orderCancel'
import { actionMenuItems, type OrderTableCtx } from '../components/orderTableColumns'
import type { Order } from '../types'

// D43 (28.11.2026): wydanego zlecenia nie anulujemy z menu, kaskada pary / Titana pomija wydane nogi.
describe('D43: anulowanie wydanego zlecenia', () => {
  it('wydane = niepusta data wydania', () => {
    expect(isOrderReleased({ release_date: '2026-11-27' })).toBe(true)
    expect(isOrderReleased({ release_date: '  ' })).toBe(false)
    expect(isOrderReleased({ release_date: null })).toBe(false)
    expect(isOrderReleased(undefined)).toBe(false)
  })

  it('kaskada pomija wydane nogi', () => {
    const r = splitCancellableLegs([
      { id: 1, release_date: null },
      { id: 2, release_date: '2026-11-20' },
      { id: 3, release_date: '' },
      { id: null, release_date: null },
    ])
    expect(r.cancel).toEqual([1, 3])
    expect(r.skippedReleased).toEqual([2])
  })

  const ctx = (onCancel: (o: Order) => void) =>
    ({ onHandleCancelOrderClick: onCancel, onHandleRestoreOrder: vi.fn() }) as unknown as OrderTableCtx

  it('menu: „Anuluj” wyłączone dla wydanego, aktywne dla niewydanego', () => {
    const onCancel = vi.fn()
    const released = { id: 10, order_number: '1', release_date: '2026-11-27', extra_fields: {} } as unknown as Order
    const open = { id: 11, order_number: '2', release_date: null, extra_fields: {} } as unknown as Order
    const r = actionMenuItems(ctx(onCancel), released).find((i) => i.key === 'cancel')
    expect(r?.disabled).toBe(true)
    r?.onClick()
    expect(onCancel).not.toHaveBeenCalled()
    const o = actionMenuItems(ctx(onCancel), open).find((i) => i.key === 'cancel')
    expect(o?.disabled).toBeFalsy()
    o?.onClick()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('D28: anulowanie nogi Bastion zestawu Titan', () => {
  it('pyta o cały zestaw, gdy jest aktywne STA z parą ST', () => {
    expect(mozeAnulowacCalyZestawTitan({ id: 1, category: 'STA', extra_fields: {} }, { id: 2, category: 'ST' })).toBe(true)
  })
  it('tylko noga Bastion, gdy STA brak, anulowane, wydane albo bez pary ST', () => {
    expect(mozeAnulowacCalyZestawTitan(null, { id: 2, category: 'ST' })).toBe(false)
    expect(mozeAnulowacCalyZestawTitan({ id: 1, category: 'STA', extra_fields: { cancelled: true } }, { id: 2, category: 'ST' })).toBe(false)
    expect(mozeAnulowacCalyZestawTitan({ id: 1, category: 'STA', release_date: '2026-11-20' }, { id: 2, category: 'ST' })).toBe(false)
    expect(mozeAnulowacCalyZestawTitan({ id: 1, category: 'STA' }, { id: 2, category: 'Disting' })).toBe(false)
    expect(mozeAnulowacCalyZestawTitan({ id: 1, category: 'Bastion' }, { id: 2, category: 'ST' })).toBe(false)
  })
})

describe('D51: anulowanie ze zwrotem — najpierw oznaczenie, potem zwrot', () => {
  it('kolejność kroków i błąd zwrotu nie cofa anulowania', async () => {
    const kroki: string[] = []
    const ok = { error: null }
    const r1 = await anulujPotemZwroc(
      async () => { kroki.push('oznacz'); return ok },
      async () => { kroki.push('zwroc'); return { error: { message: 'brak sieci' } } },
    )
    expect(kroki).toEqual(['oznacz', 'zwroc'])
    expect(r1).toEqual({ ok: true, bladZwrotu: 'brak sieci' })
  })
  it('błąd oznaczenia — zwrotu nie ma', async () => {
    const zwroc = vi.fn(async () => ({ error: null }))
    const r = await anulujPotemZwroc(async () => ({ error: { message: 'odmowa' } }), zwroc)
    expect(r).toEqual({ ok: false, blad: 'odmowa' })
    expect(zwroc).not.toHaveBeenCalled()
  })
})
