import { describe, expect, it } from 'vitest'
import { canEditPrintTemplates } from '../lib/permissions'

// D59 (28.11.2026): szablony etykiet i dokumentów druku edytuje tylko admin / superadmin.
describe('D59: edycja szablonów druku', () => {
  it('admin, superadmin (i stary manager) — tak', () => {
    expect(canEditPrintTemplates('admin')).toBe(true)
    expect(canEditPrintTemplates('superadmin')).toBe(true)
    expect(canEditPrintTemplates('manager')).toBe(true)
  })
  it('kierownicy i pracownicy — nie', () => {
    for (const r of ['kierownik_dzialu', 'kierownik_magazynu', 'kierownik_produkcji', 'kierownik_firmowy', 'pracownik_produkcji', 'magazynier', 'obsluga_klienta', '', null, undefined]) {
      expect(canEditPrintTemplates(r)).toBe(false)
    }
  })
})
