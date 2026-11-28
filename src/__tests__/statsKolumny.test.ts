// Runda 6 (wydajność): Statystyki pobierają tylko wybrane kolumny zleceń (STATS_ORDER_COLUMNS) zamiast `select *`.
// Ten test pilnuje, żeby każde pole zlecenia (z typu Order) użyte w kodzie Statystyk było na liście —
// inaczej wykres po cichu dostawałby `undefined`.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STATS_ORDER_COLUMNS } from '../hooks/useStats'

const czytaj = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf-8')

describe('Statystyki: lista kolumn zleceń', () => {
  it('zawiera każde pole Order używane w kodzie Statystyk', () => {
    const typy = czytaj('../types.ts')
    const i = typy.indexOf('export type Order = {')
    const klucze = [...typy.slice(i, typy.indexOf('\n}', i)).matchAll(/^\s+([a-z_]+)\??:/gm)].map((m) => m[1])
    const pliki = [
      ...readdirSync(new URL('../components/stats/', import.meta.url)).filter((f) => f.endsWith('.tsx')).map((f) => `../components/stats/${f}`),
      '../components/StatsView.tsx',
      '../lib/companyStats.ts',
      // D47: ścieżka zapasowa (stara baza) liczy zestawienia ze zleceń tu
      '../lib/statsZlecenia.ts',
      '../lib/salesStats.ts',
      '../lib/optimaRo.ts',
    ]
    // komponenty, które NIE dostają listy zleceń ze Statystyk (pobierają własne dane / RPC)
    const wlasneDane = ['ProductivityView.tsx', 'LeadTimeStatsView.tsx', 'ConfiguratorShareView.tsx', 'InternalDoorStatsDashboard.tsx', 'CategoryTrendShortages.tsx', 'MonthlyConsumptionView.tsx']
    const brakujace = new Set<string>()
    for (const p of pliki) {
      if (wlasneDane.some((w) => p.endsWith(w))) continue
      const kod = czytaj(p)
      for (const k of klucze) {
        if (new RegExp(`\\b(?:o|order|x|r|row)\\.${k}\\b`).test(kod) && !(STATS_ORDER_COLUMNS as readonly string[]).includes(k)) brakujace.add(`${k} (${p})`)
      }
    }
    expect([...brakujace]).toEqual([])
  })
})
