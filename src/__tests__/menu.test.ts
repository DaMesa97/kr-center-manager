import { describe, expect, it } from 'vitest'
import { TAB_GROUPS } from '../components/Sidebar'
import { TABS, WAREHOUSE_SUB_TABS, WAREHOUSE_TABS, WAREHOUSE_TAB_SUBTABS } from '../constants'
import { tabsForUserDepartment } from '../utils'

// Porządki menu (beta.86): każda rzecz w dokładnie jednym miejscu.

function menuTabs(): string[] {
  const out: string[] = []
  for (const g of TAB_GROUPS) {
    if (g.type === 'standalone') out.push(g.tab)
    else out.push(...g.tabs)
  }
  return out
}

describe('menu boczne — układ', () => {
  it('każda zakładka z TABS ma dokładnie jedno miejsce w Sidebarze', () => {
    const inMenu = menuTabs()
    for (const t of TABS) {
      expect(inMenu.filter((x) => x === t), `zakładka ${t}`).toHaveLength(1)
    }
  })

  it('Sidebar nie zna zakładek spoza TABS (np. starego „Magazyn" / „Klucze API")', () => {
    for (const t of menuTabs()) {
      expect(TABS as readonly string[], `pozycja menu ${t}`).toContain(t)
    }
  })

  it('grupy trzymają się zasady „jedno pytanie użytkownika"', () => {
    const byId = Object.fromEntries(
      TAB_GROUPS.filter((g) => g.type === 'group').map((g) => [g.type === 'group' ? g.id : '', g.type === 'group' ? [...g.tabs] : []]),
    )
    expect(byId.orders).toEqual(['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne', 'Aluminium', 'Weryfikacja', 'Archiwum'])
    expect(byId.production).toEqual(['Wysyłka', 'Etykiety', 'ZKP'])
    expect(byId.warehouse).toEqual([...WAREHOUSE_TABS])
    expect(byId.analytics).toEqual(['Statystyki', 'Audyt'])
    expect(byId.settings).toEqual(['Konfiguracja', 'Kontrahenci', 'Użytkownicy', 'Integracje'])
  })
})

describe('menu boczne — Magazyn', () => {
  it('każda podzakładka magazynu należy do dokładnie jednej pozycji menu', () => {
    const all = Object.values(WAREHOUSE_TAB_SUBTABS).flat()
    for (const sub of WAREHOUSE_SUB_TABS) {
      expect(all.filter((x) => x === sub), `podzakładka ${sub}`).toHaveLength(1)
    }
    expect(all).toHaveLength(WAREHOUSE_SUB_TABS.length)
  })

  it('pierwsza podzakładka pozycji to ta, od której pozycja bierze nazwę', () => {
    expect(WAREHOUSE_TAB_SUBTABS.Stany[0]).toBe('Stany')
    expect(WAREHOUSE_TAB_SUBTABS.Komponenty[0]).toBe('Komponenty')
    expect(WAREHOUSE_TAB_SUBTABS.Zamawianie[0]).toBe('Zamawianie')
    expect(WAREHOUSE_TAB_SUBTABS.Inwentaryzacja).toEqual(['Inwentaryzacja'])
  })
})

describe('menu boczne — widoczność per rola po porządkach', () => {
  it('magazynier widzi Stany / Komponenty / Dokumenty, bez Zamawiania i Inwentaryzacji', () => {
    const tabs = tabsForUserDepartment('all', false, 'magazynier', [])
    expect(tabs).toEqual(expect.arrayContaining(['Stany', 'Komponenty', 'Dokumenty']))
    expect(tabs).not.toContain('Zamawianie')
    expect(tabs).not.toContain('Inwentaryzacja')
  })

  it('pracownik produkcji ma najwyżej 5 pozycji poza swoimi kategoriami', () => {
    const tabs = tabsForUserDepartment('all', false, 'pracownik_produkcji', ['ST'])
    const nonCategory = tabs.filter((t) => t !== 'ST')
    expect(nonCategory).toEqual(['Moje stanowisko', 'Etykiety', 'Zgłoszenia', 'Pomoc'])
  })

  it('admin ma Integracje zamiast Kluczy API i nie ma starego „Magazyn"', () => {
    const tabs = tabsForUserDepartment('all', true, 'admin', [])
    expect(tabs).toContain('Integracje')
    expect(tabs as string[]).not.toContain('Klucze API')
    expect(tabs as string[]).not.toContain('Magazyn')
  })
})
