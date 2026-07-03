import { describe, expect, it } from 'vitest'
import { tabsForUserDepartment } from '../utils'

// Widoczność zakładek per rola — zgodnie z Pomocą (sekcja Role) i permissions.ts.

describe('tabsForUserDepartment — nowe role', () => {
  it('admin widzi panel administracyjny i wszystko inne', () => {
    const tabs = tabsForUserDepartment('all', true, 'admin', [])
    for (const t of ['Pulpit', 'STA', 'Bastion', 'Wysyłka', 'Magazyn', 'Zamawianie', 'Kontrahenci', 'Konfiguracja', 'Użytkownicy', 'Klucze API', 'Etykiety', 'Zgłoszenia', 'Pomoc']) {
      expect(tabs).toContain(t)
    }
  })

  it('kierownik produkcji — pełna firma, ale BEZ panelu admina', () => {
    const tabs = tabsForUserDepartment('all', true, 'kierownik_produkcji', [])
    for (const t of ['Pulpit', 'STA', 'Wysyłka', 'Statystyki', 'Archiwum', 'Magazyn', 'Zamawianie']) {
      expect(tabs).toContain(t)
    }
    for (const t of ['Użytkownicy', 'Konfiguracja', 'Klucze API', 'Kontrahenci']) {
      expect(tabs).not.toContain(t)
    }
  })

  it('kierownik działu — tylko przypisane kategorie zleceń', () => {
    const tabs = tabsForUserDepartment('all', true, 'kierownik_dzialu', ['STA', 'Disting'])
    expect(tabs).toContain('STA')
    expect(tabs).toContain('Disting')
    expect(tabs).not.toContain('ST')
    expect(tabs).not.toContain('Bastion')
    expect(tabs).toContain('Wysyłka')
  })

  it('pracownik produkcji — przypisane kategorie + Moje stanowisko, bez magazynu/wysyłki', () => {
    const tabs = tabsForUserDepartment('all', false, 'pracownik_produkcji', ['ST'])
    expect(tabs).toContain('Moje stanowisko')
    expect(tabs).toContain('ST')
    expect(tabs).toContain('Etykiety')
    expect(tabs).not.toContain('STA')
    expect(tabs).not.toContain('Wysyłka')
    expect(tabs).not.toContain('Magazyn')
    expect(tabs).not.toContain('Użytkownicy')
  })

  it('magazynier — wszystkie kategorie (podgląd) + Wysyłka + Magazyn, bez Zamawiania', () => {
    const tabs = tabsForUserDepartment('all', false, 'magazynier', [])
    expect(tabs).toContain('Moje stanowisko')
    expect(tabs).toContain('STA')
    expect(tabs).toContain('Wysyłka')
    expect(tabs).toContain('Magazyn')
    expect(tabs).not.toContain('Zamawianie')
    expect(tabs).not.toContain('Statystyki')
    expect(tabs).not.toContain('Użytkownicy')
  })

  it('obsługa klienta — wszystkie kategorie, bez produkcyjnych narzędzi', () => {
    const tabs = tabsForUserDepartment('all', false, 'obsluga_klienta', [])
    expect(tabs).toContain('STA')
    expect(tabs).toContain('DrzwiWewnetrzne')
    expect(tabs).not.toContain('Moje stanowisko')
    expect(tabs).not.toContain('Wysyłka')
    expect(tabs).not.toContain('Magazyn')
  })
})

describe('tabsForUserDepartment — legacy (okres przejściowy, zero zmian)', () => {
  it('legacy worker w dziale bastion widzi tylko Bastion + narzędzia', () => {
    const tabs = tabsForUserDepartment('bastion', false, 'worker')
    expect(tabs).toContain('Bastion')
    expect(tabs).not.toContain('STA')
    expect(tabs).toContain('Moje stanowisko')
    expect(tabs).toContain('Magazyn')
    expect(tabs).not.toContain('Wysyłka')
    expect(tabs).not.toContain('Użytkownicy')
  })

  it('legacy manager widzi wszystko (w tym panel admina)', () => {
    const tabs = tabsForUserDepartment('all', true, 'manager')
    for (const t of ['Pulpit', 'STA', 'Bastion', 'Wysyłka', 'Statystyki', 'Archiwum', 'Użytkownicy', 'Konfiguracja', 'Klucze API', 'Kontrahenci']) {
      expect(tabs).toContain(t)
    }
  })
})
