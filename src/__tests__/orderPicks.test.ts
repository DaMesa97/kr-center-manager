import { describe, expect, it } from 'vitest'
import { canPick, canPickIntDoor, groupPicks, isPicked, pickChanged, pickKey, pickProgress, pickSig, type OrderPick } from '../lib/orderPicks'

const pick = (order_id: number, line_key: string): OrderPick => ({ order_id, line_key, picked_at: '2026-11-26T15:00:00Z', picked_by: null, picked_initials: 'TW' })

describe('przygotowanie do pakowania', () => {
  it('klucz linii: id linii z Optimy (przeżywa ponowny import), przy ręcznych id pozycji', () => {
    expect(pickKey({ id: 605, optima_element_id: 3489780 })).toBe('optima:3489780')
    expect(pickKey({ id: 12, optima_element_id: null })).toBe('item:12')
  })

  it('część kompletu (SYSTEM PRZESUWNY) ma własny klucz — odhaczenie skrzydła nie odhacza systemu; klucz stały między importami', () => {
    const skrzydlo = { id: 54886, optima_element_id: 3492258, component_id: 3391, notes: 'skrzydło przesuwne, prowadnica' }
    const system = { id: 55044, optima_element_id: 3492258, component_id: 3386, notes: 'Część kompletu MALEO 06 BIAŁY 80 Z SYSTEMEM PRZESUWNYM' }
    expect(pickKey(skrzydlo)).toBe('optima:3492258')
    expect(pickKey(system)).toBe('optima:3492258:3386')
    expect(pickKey({ ...system, id: 99999 })).toBe('optima:3492258:3386')
    expect(pickProgress([skrzydlo, system], new Map([['optima:3492258', pick(1, 'optima:3492258')]]))).toEqual({ done: 1, total: 2, complete: false })
  })

  it('postęp: 0/3 → 2/3 → komplet; odznaczenie linii, której już nie ma w RO, się nie liczy', () => {
    const items = [
      { id: 1, optima_element_id: 10 },
      { id: 2, optima_element_id: 11 },
      { id: 3, optima_element_id: 12 },
    ]
    const byOrder = groupPicks([pick(7, 'optima:10'), pick(7, 'optima:11'), pick(7, 'optima:99'), pick(8, 'optima:10')])
    expect(pickProgress(items, undefined)).toEqual({ done: 0, total: 3, complete: false })
    expect(pickProgress(items, byOrder.get(7))).toEqual({ done: 2, total: 3, complete: false })
    byOrder.get(7)!.set('optima:12', pick(7, 'optima:12'))
    expect(pickProgress(items, byOrder.get(7))).toEqual({ done: 3, total: 3, complete: true })
    expect(pickProgress([], byOrder.get(7)).complete).toBe(false)
  })

  it('kto odznacza: kierownik, magazynier, pracownik działu magazyn — sprzedawca nie', () => {
    expect(canPick({ role: 'magazynier' }, false)).toBe(true)
    expect(canPick({ role: 'worker', department: 'magazyn' }, false)).toBe(true)
    expect(canPick({ role: 'worker', department: 'stalowe' }, false)).toBe(false)
    expect(canPick({ role: 'sprzedawca' }, false)).toBe(false)
    expect(canPick({ role: 'kierownik_magazynu' }, true)).toBe(true)
  })

  it('D62: drzwi wewn. odhacza kierownik, magazynier i kierownik działu tylko z kategorią DrzwiWewnetrzne', () => {
    expect(canPickIntDoor({ role: 'kierownik_dzialu', categories: ['STA'] }, true)).toBe(false)
    expect(canPickIntDoor({ role: 'kierownik_dzialu', categories: [] }, true)).toBe(false)
    expect(canPickIntDoor({ role: 'kierownik_dzialu' }, true)).toBe(false)
    expect(canPickIntDoor({ role: 'kierownik_dzialu', categories: ['STA', 'DrzwiWewnetrzne'] }, true)).toBe(true)
    expect(canPickIntDoor({ role: 'kierownik_magazynu', categories: [] }, true)).toBe(true)
    expect(canPickIntDoor({ role: 'admin', categories: [] }, true)).toBe(true)
    expect(canPickIntDoor({ role: 'magazynier' }, false)).toBe(true)
    expect(canPickIntDoor({ role: 'pracownik_produkcji', categories: ['DrzwiWewnetrzne'] }, false)).toBe(false)
    expect(canPickIntDoor({ role: 'obsluga_klienta' }, false)).toBe(false)
    // „trzymamy na magazynie” bez zmian — kierownik działu dalej może
    expect(canPick({ role: 'kierownik_dzialu' }, true)).toBe(true)
  })
})

describe('poprawki po testach 27.11', () => {
  const skrzydlo = { id: 55179, optima_element_id: 3492967, component_id: 3389, optima_code: 'MALEO06-JS-80', quantity: 1, notes: 'skrzydło przesuwne' }
  const system = { id: 55180, optima_element_id: 3492967, component_id: 3386, optima_code: 'SYS-PRZ', quantity: 1, notes: 'Część kompletu MALEO 06 JESION SZARY 80 Z SYSTEMEM PRZESUWNYM' }
  it('lista w telefonie (pełne pola): odhaczone samo skrzydło to 1/2, nie „komplet”', () => {
    expect(pickProgress([skrzydlo, system], new Map([[pickKey(skrzydlo), pick(1, pickKey(skrzydlo))]]))).toEqual({ done: 1, total: 2, complete: false })
  })
  it('zmiana ilości albo kodu w Optimie po odhaczeniu = linia nieodhaczona', () => {
    const odh = { ...pick(1, pickKey(skrzydlo)), line_sig: pickSig(skrzydlo) }
    const m = new Map([[pickKey(skrzydlo), odh]])
    expect(isPicked(m, skrzydlo)).toBe(true)
    expect(isPicked(m, { ...skrzydlo, quantity: 2 })).toBe(false)
    expect(pickChanged(m, { ...skrzydlo, quantity: 2 })).toBe(true)
    expect(isPicked(m, { ...skrzydlo, optima_code: 'MALEO06-JS-90' })).toBe(false)
  })
  it('stare odhaczenie bez podpisu liczy się jak dotąd', () => {
    const m = new Map([[pickKey(skrzydlo), pick(1, pickKey(skrzydlo))]])
    expect(isPicked(m, { ...skrzydlo, quantity: 5 })).toBe(true)
    expect(pickChanged(m, { ...skrzydlo, quantity: 5 })).toBe(false)
  })
})
