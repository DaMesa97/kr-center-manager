import { describe, expect, it } from 'vitest'
import { can } from '../lib/permissions'

// D31 (28.11.2026, właściciel: NIE): magazynier nie planuje tras dostaw.
describe('D31: planowanie tras', () => {
  it('magazynier widzi Wysyłkę, ale nie planuje tras', () => {
    expect(can('magazynier', 'shipping.view')).toBe(true)
    expect(can('magazynier', 'shipping.routes')).toBe(false)
  })
  it('kierownicy i admin planują trasy', () => {
    for (const r of ['kierownik_dzialu', 'kierownik_magazynu', 'kierownik_produkcji', 'kierownik_firmowy', 'admin', 'superadmin']) {
      expect(can(r, 'shipping.routes')).toBe(true)
    }
  })
  it('pracownik produkcji i obsługa klienta — nie', () => {
    expect(can('pracownik_produkcji', 'shipping.routes')).toBe(false)
    expect(can('obsluga_klienta', 'shipping.routes')).toBe(false)
  })
})
