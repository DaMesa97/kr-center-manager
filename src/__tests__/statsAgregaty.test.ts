// D47 (28.11): Statystyki zleceń z agregatów (baza: stat_zlecenia_podsumowanie, stara baza: podsumujZlecenia).
// Wynik ekranu (widokKategorii) musi być IDENTYCZNY z dawnym liczeniem komponentu (fixtures/staryWidokKategorii).
// Na danych produkcji 28.11 porównano też wynik funkcji SQL — 160/160 zgodnych (raport D47).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Order } from '../types'
import { normalizujPodsumowanie, podsumujZlecenia, widokKategorii } from '../lib/statsZlecenia'
import {
  buildCompanyAliases,
  companyCanonizer,
  companyCanonizerFromGroups,
  companyNameCounts,
  companyNames,
  companyNamesFromCounts,
} from '../lib/companyStats'
import { staryWidokKategorii } from './fixtures/staryWidokKategorii'

const NOW = new Date(2026, 10, 28, 12, 0, 0)

/** prosty deterministyczny generator (powtarzalne „losowe” dane) */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function losoweZlecenia(n: number, seed: number): Order[] {
  const r = rng(seed)
  const wybierz = <T,>(a: T[]): T => a[Math.floor(r() * a.length)]
  const kategorie = ['STA', 'Disting', 'ST', 'Bastion', 'Techniczne', 'DrzwiWewnetrzne', null]
  const firmy = ['PO DRZWI', 'Po Drzwi ', ' BEL-POL Opole', 'BEL-POL OPOLE', 'Rojar # Tuchów', 'ROJAR TUCHOW', '', null, 'Gama ', 'X']
  const modele = ['TORINO 13B', ' torino', 'MILANO', '', null, 'A1', 'A2', 'A3']
  const out: Order[] = []
  for (let i = 0; i < n; i++) {
    const cat = wybierz(kategorie)
    const d0 = new Date(2024, 0, 1).getTime() + Math.floor(r() * 1050) * 86_400_000
    const orderDate = r() < 0.05 ? null : new Date(d0).toLocaleDateString('sv-SE')
    const wydane = r() < 0.7
    const rel = wydane ? new Date(d0 + Math.floor(r() * 80 - 5) * 86_400_000).toLocaleDateString('sv-SE') : null
    const extra: Record<string, unknown> = {}
    if (r() < 0.08) extra.cancelled = true
    if (r() < 0.03) extra.cancelled = 'true' // tekst — NIE liczy się jako anulowane
    if (r() < 0.15) extra.release_date_szacunkowa = true
    if (r() < 0.05) extra.titan_group = 100 + i
    if (r() < 0.03) extra.closed_by = 'optima_ro'
    const optima = r() < 0.15
    const mr = optima && r() < 0.3
    out.push({
      id: n - i, // celowo nie po kolei
      category: cat as Order['category'],
      order_number: String(1000 + i),
      company: wybierz(firmy) as string,
      model: wybierz(modele) as string,
      system: wybierz(['DISTING PLUS', 'disting  plus', 'STANDARD', '', null]) as string,
      wing_color: wybierz(['Biały', ' biały', 'Antracyt', '', null]) as string,
      quantity: wybierz([1, 2, 3, 0, null, 5]) as number,
      order_date: orderDate as string,
      release_date: rel,
      created_at: new Date(d0 + Math.floor(r() * 86_400_000)).toISOString(),
      source: optima ? 'optima_ro' : wybierz(['bot', 'excel', 'manual']),
      source_metadata: optima ? { state: wybierz([0, 1, 2, 3, 4, '3', null]), optima_key: mr ? 'MR:12' : 'KR:5' } : null,
      extra_fields: Object.keys(extra).length ? extra : wybierz([null, {}]),
      linked_order_id: r() < 0.2 ? 5 : null,
    } as unknown as Order)
  }
  return out
}

describe('D47: Statystyki zleceń z agregatów = dawne liczenie', () => {
  const aliases = buildCompanyAliases([{ alias_name: 'PO DRZWI', company_name: 'Po Drzwi Żory' }])

  for (const seed of [1, 7, 42]) {
    it(`losowe zlecenia (seed ${seed}): każdy wykres każdej kategorii, każde okno, ze scalaniem nazw i bez`, () => {
      const wszystkie = losoweZlecenia(1500, seed)
      // stare: useStats odfiltrowywało RO MR Profil i trzymało listę po id rosnąco
      const stare = wszystkie
        .filter((o) => !(o.source === 'optima_ro' && String((o.source_metadata as { optima_key?: string } | null)?.optima_key ?? '').startsWith('MR:')))
        .sort((a, b) => Number(a.id) - Number(b.id))
      const pods = podsumujZlecenia(wszystkie)
      // jak z bazy: przez JSON (RPC) i normalizację
      const zBazy = normalizujPodsumowanie(JSON.parse(JSON.stringify(pods)))
      expect(zBazy).toEqual(pods)
      expect(pods.liczba).toBe(stare.length)

      const canonStary = companyCanonizer(stare, aliases)
      const canonNowy = companyCanonizerFromGroups(companyNamesFromCounts(zBazy.firmy, aliases), aliases)
      for (const k of ['STA', 'Disting', 'ST', 'Bastion', 'Techniczne', 'DrzwiWewnetrzne', 'Aluminium']) {
        for (const rm of [3, 12, 24, 40]) {
          // przez JSON: stare liczenie dawało czasem -0 dni (Math.round(-0,3)) — na ekranie to samo „0”
          const jakNaEkranie = (x: unknown) => JSON.parse(JSON.stringify(x))
          expect(widokKategorii(zBazy.kategorie[k], rm, NOW, canonNowy)).toEqual(jakNaEkranie(staryWidokKategorii(k, stare, rm, NOW, canonStary)))
          expect(widokKategorii(zBazy.kategorie[k], rm, NOW)).toEqual(jakNaEkranie(staryWidokKategorii(k, stare, rm, NOW)))
        }
      }
      expect(companyNamesFromCounts(zBazy.firmy, aliases)).toEqual(companyNames(stare, aliases))
    })
  }

  it('reguły brzegowe: anulowane tylko boolean, RO zamknięte w Optimie, ilość 0/brak, data szacunkowa', () => {
    const o = (p: Partial<Order> & { id: number }): Order => ({ category: 'STA', quantity: 1, order_date: '2026-11-02', ...p }) as Order
    const pods = podsumujZlecenia([
      o({ id: 1, extra_fields: { cancelled: true }, quantity: 4 }),
      o({ id: 2, extra_fields: { cancelled: 'true' }, quantity: 2 }),
      o({ id: 3, source: 'optima_ro', source_metadata: { state: 3 }, quantity: 3 }),
      o({ id: 4, release_date: '2026-11-12', quantity: null as unknown as number }),
      o({ id: 5, release_date: '2026-11-20', extra_fields: { release_date_szacunkowa: true } }),
      o({ id: 6, release_date: '2026-11-01' }), // przed datą zamówienia — bez czasu realizacji
      o({ id: 7, source: 'optima_ro', source_metadata: { state: 4, optima_key: 'MR:9' } }), // MR Profil — poza statystykami
    ]).kategorie.STA
    expect(pods.status).toEqual({ zrealizowane: 3 + 0 + 1 + 1, w_produkcji: 2, anulowane: 4 })
    expect(pods.bez_daty).toBe(1)
    expect(pods.realizacja).toEqual([{ m: '2026-11', suma: 10, n: 1, min: 10, max: 10 }])
    expect(pods.produkcja).toEqual([{ m: '2026-11', szt: 1 }])
    // dni tygodnia / modele: brak ilości liczy się jako 1 sztuka
    expect(pods.dni.reduce((s, x) => s + x, 0)).toBe(2 + 3 + 1 + 1 + 1)
  })

  it('remisy w rankingach: kolejność pierwszego wystąpienia (najmniejsze id), jak stabilne sortowanie', () => {
    const z = (id: number, model: string) => ({ id, category: 'ST', model, quantity: 1, order_date: '2026-01-05' }) as Order
    const pods = podsumujZlecenia([z(30, 'C'), z(10, 'B'), z(20, 'A')]).kategorie.ST
    expect(pods.modele.map((m) => m.name)).toEqual(['B', 'A', 'C'])
  })

  it('companyNameCounts + companyNamesFromCounts = companyNames (bez anulowanych, nóg Titana i Disting Plus)', () => {
    const lista = losoweZlecenia(400, 3).sort((a, b) => Number(a.id) - Number(b.id))
    expect(companyNamesFromCounts(companyNameCounts(lista))).toEqual(companyNames(lista))
  })

  it('aplikacja woła funkcje zdefiniowane w migracji D47 (nazwy i parametr)', () => {
    const sql = readFileSync(new URL('../../supabase/migrations/20261128051100_d47_statystyki_zlecen_agregaty.sql', import.meta.url), 'utf-8')
    const hook = readFileSync(new URL('../hooks/useStats.ts', import.meta.url), 'utf-8')
    expect(sql).toMatch(/function public\.stat_zlecenia_podsumowanie\(\)/)
    expect(sql).toMatch(/function public\.stat_zlecenia_firm\(p_nazwy text\[\]\)/)
    expect(sql).toMatch(/current_user_is_manager\(\)/)
    expect(sql).not.toMatch(/grant execute[^;]*\banon\b/i)
    expect(hook).toContain("rpc('stat_zlecenia_podsumowanie')")
    expect(hook).toContain("rpc('stat_zlecenia_firm', { p_nazwy: nazwy })")
    expect(hook).toContain("'PGRST202'")
  })
})
