// D48 (28.11): Wysyłka i zakładki kategorii pobierają listę kolumn zamiast `select *`.
// Testy pilnują, żeby widok miał wszystkie potrzebne pola — inaczej pole po cichu byłoby `undefined`
// (puste w tabeli / w oknie edycji).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ORDER_COLUMNS_NIEUZYWANE,
  ORDER_LIST_COLUMNS,
  SHIPPING_ORDER_COLUMNS,
  __resetOrderSelect,
  brakKolumnyWLiscie,
  orderSelect,
} from '../lib/orderColumns'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const czytaj = (p: string) => readFileSync(p, 'utf-8')
const wspomina = (kod: string, kolumna: string) => new RegExp(`(?<![A-Za-z0-9_])${kolumna}(?![A-Za-z0-9_])`).test(kod)

function wszystkiePliki(dir: string): string[] {
  const out: string[] = []
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f)
    if (statSync(p).isDirectory()) {
      if (f !== '__tests__') out.push(...wszystkiePliki(p))
    } else if (/\.(ts|tsx)$/.test(f)) out.push(p)
  }
  return out
}

/** Pliki importowane (przechodnio, tylko względne importy w src/) z podanych plików startowych. */
function domkniecieImportow(starty: string[]): string[] {
  const widziane = new Set<string>()
  const rozwiaz = (z: string, spec: string): string | null => {
    const baza = path.resolve(path.dirname(z), spec)
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx', '']) {
      const p = baza + ext
      if (/\.(ts|tsx)$/.test(p) && existsSync(p) && statSync(p).isFile()) return p
    }
    return null
  }
  const idz = (plik: string) => {
    if (widziane.has(plik)) return
    widziane.add(plik)
    const kod = czytaj(plik)
    for (const m of kod.matchAll(/(?:import|export)[^'"]*?from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const r = rozwiaz(plik, m[1] ?? m[2])
      if (r) idz(r)
    }
  }
  for (const s of starty) idz(path.join(SRC, s))
  return [...widziane]
}

describe('D48: listy kolumn zleceń', () => {
  afterEach(() => __resetOrderSelect())

  it('listy bez powtórzeń, Wysyłka ⊆ zakładki, nieużywane poza listami', () => {
    expect(new Set(ORDER_LIST_COLUMNS).size).toBe(ORDER_LIST_COLUMNS.length)
    expect(SHIPPING_ORDER_COLUMNS.filter((c) => !(ORDER_LIST_COLUMNS as readonly string[]).includes(c))).toEqual([])
    expect(ORDER_LIST_COLUMNS.filter((c) => (ORDER_COLUMNS_NIEUZYWANE as readonly string[]).includes(c))).toEqual([])
    for (const c of ['id', 'category', 'order_number', 'release_date', 'extra_fields', 'production_stages', 'stock_issues']) {
      expect(SHIPPING_ORDER_COLUMNS).toContain(c)
    }
  })

  it('kolumny „nieużywane” naprawdę nie padają nigdzie w kodzie aplikacji', () => {
    const pomin = [path.join(SRC, 'types.ts'), path.join(SRC, 'lib', 'orderColumns.ts')]
    const znalezione: string[] = []
    for (const p of wszystkiePliki(SRC)) {
      if (pomin.includes(p)) continue
      const kod = czytaj(p)
      for (const c of ORDER_COLUMNS_NIEUZYWANE) if (wspomina(kod, c)) znalezione.push(`${c} (${path.relative(SRC, p)})`)
    }
    expect(znalezione).toEqual([])
  })

  it('każde pole typu Order jest na liście zakładek (albo jest świadomie pominięte)', () => {
    const typy = czytaj(path.join(SRC, 'types.ts'))
    const i = typy.indexOf('export type Order = {')
    const klucze = [...typy.slice(i, typy.indexOf('\n}', i)).matchAll(/^ {2}([a-z_0-9]+)\??:/gm)].map((m) => m[1])
    expect(klucze.length).toBeGreaterThan(50)
    // pola typu, których nie ma w tabeli orders (formularz trzyma je w extra_fields)
    const nieKolumny = ['podwalina_1', 'podwalina_1_qty', 'podwalina_2', 'podwalina_2_qty']
    const brak = klucze.filter(
      (k) => !(ORDER_LIST_COLUMNS as readonly string[]).includes(k) && !(ORDER_COLUMNS_NIEUZYWANE as readonly string[]).includes(k) && !nieKolumny.includes(k),
    )
    expect(brak).toEqual([])
  })

  it('Wysyłka: każda kolumna wspomniana w modułach Wysyłki (z importami) jest na liście Wysyłki', () => {
    const pliki = domkniecieImportow([
      'components/ShippingView.tsx',
      'components/LogisticsDeskView.tsx',
      'hooks/useShipping.ts',
      // okna szczegółów otwierane z Wysyłki dostają zlecenie z tej listy
      'components/ShippingDetailsModal.tsx',
      'components/InternalDoorOrderDetailsModal.tsx',
    ]).filter((p) => !p.endsWith(`${path.sep}types.ts`) && !p.endsWith(`${path.sep}orderColumns.ts`))
    expect(pliki.length).toBeGreaterThan(10)
    const brakujace = new Set<string>()
    for (const p of pliki) {
      const kod = czytaj(p)
      for (const c of ORDER_LIST_COLUMNS) {
        if (!SHIPPING_ORDER_COLUMNS.includes(c) && wspomina(kod, c)) brakujace.add(`${c} (${path.relative(SRC, p)})`)
      }
    }
    expect([...brakujace]).toEqual([])
  })

  it('bezpiecznik: po 42703 (brak kolumny) do końca sesji select *', () => {
    expect(orderSelect(['id', 'category'])).toBe('id, category')
    expect(brakKolumnyWLiscie({ code: 'PGRST301' })).toBe(false)
    expect(brakKolumnyWLiscie(null)).toBe(false)
    expect(orderSelect(['id'])).toBe('id')
    expect(brakKolumnyWLiscie({ code: '42703' })).toBe(true)
    expect(orderSelect(['id', 'category'])).toBe('*')
    // drugie równoległe zapytanie z tym samym błędem też dostaje „ponów”
    expect(brakKolumnyWLiscie({ code: '42703' })).toBe(true)
  })
})
