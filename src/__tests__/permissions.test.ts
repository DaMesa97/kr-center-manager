import { describe, expect, it } from 'vitest'
import { can, isAdminRole, isCategoryScoped, isManagerRole } from '../lib/permissions'

// Weryfikacja macierzy uprawnień — dokładnie tak, jak opisano w Pomocy (sekcja Role).

describe('permissions — macierz ról', () => {
  it('admin = superrola (wszystko, w tym panel administracyjny)', () => {
    expect(isAdminRole('admin')).toBe(true)
    expect(isManagerRole('admin')).toBe(true)
    expect(can('admin', 'admin.panel')).toBe(true)
    expect(can('admin', 'orders.edit')).toBe(true)
    expect(can('admin', 'prices.view')).toBe(true)
  })

  it('legacy manager = pełny dostęp (okres przejściowy przed migracją ról)', () => {
    expect(isManagerRole('manager')).toBe(true)
    expect(isAdminRole('manager')).toBe(false)
    expect(can('manager', 'admin.panel')).toBe(true)
    expect(can('manager', 'orders.edit')).toBe(true)
  })

  it('kierownik produkcji/firmowy — pełne zarządzanie, ale BEZ panelu admina', () => {
    for (const r of ['kierownik_produkcji', 'kierownik_firmowy', 'kierownik_magazynu']) {
      expect(isManagerRole(r)).toBe(true)
      expect(can(r, 'orders.edit')).toBe(true)
      expect(can(r, 'prices.view')).toBe(true)
      expect(can(r, 'admin.panel')).toBe(false)
      expect(isCategoryScoped(r)).toBe(false)
    }
  })

  it('kierownik działu — pełne uprawnienia, ale zawężony do kategorii', () => {
    expect(isManagerRole('kierownik_dzialu')).toBe(true)
    expect(isCategoryScoped('kierownik_dzialu')).toBe(true)
    expect(can('kierownik_dzialu', 'prices.view')).toBe(true)
    expect(can('kierownik_dzialu', 'shipping.invoice')).toBe(true)
  })

  it('pracownik produkcji — podgląd + komentarze, bez edycji i bez cen, zawężony', () => {
    expect(isManagerRole('pracownik_produkcji')).toBe(false)
    expect(isCategoryScoped('pracownik_produkcji')).toBe(true)
    expect(can('pracownik_produkcji', 'orders.view')).toBe(true)
    expect(can('pracownik_produkcji', 'comments.write')).toBe(true)
    expect(can('pracownik_produkcji', 'orders.edit')).toBe(false)
    expect(can('pracownik_produkcji', 'prices.view')).toBe(false)
    expect(can('pracownik_produkcji', 'stages.markAny')).toBe(false)
  })

  it('magazynier — wysyłka + ruchy magazynowe, bez zarządzania magazynem i cen', () => {
    expect(can('magazynier', 'shipping.view')).toBe(true)
    expect(can('magazynier', 'warehouse.movements')).toBe(true)
    expect(can('magazynier', 'warehouse.manage')).toBe(false)
    expect(can('magazynier', 'warehouse.ordering')).toBe(false)
    expect(can('magazynier', 'prices.view')).toBe(false)
  })

  it('obsługa klienta — podgląd + komentarze + druk etykiet, nic więcej', () => {
    expect(can('obsluga_klienta', 'orders.view')).toBe(true)
    expect(can('obsluga_klienta', 'comments.write')).toBe(true)
    expect(can('obsluga_klienta', 'labels.print')).toBe(true)
    expect(can('obsluga_klienta', 'orders.edit')).toBe(false)
    expect(can('obsluga_klienta', 'prices.view')).toBe(false)
    expect(can('obsluga_klienta', 'shipping.view')).toBe(false)
  })

  it('nieznana/pusta rola — nic nie może', () => {
    expect(can('', 'orders.view')).toBe(false)
    expect(can('cokolwiek', 'orders.view')).toBe(false)
    expect(isManagerRole('')).toBe(false)
  })
})
