#!/usr/bin/env node
// Cennik producenta z plików skilla wycena-drzwi → SQL do crm.cennik_zrodla / crm.cennik_pozycje (27.11.2026).
// Użycie: node scripts/cennik-import.mjs <katalog skilla wycena-drzwi> > cennik.sql   (SQL wgrywa się konektorem Supabase)
// Teraz: KR Center, ulotka „Sierpień 2026”, drzwi wewnętrzne (skrzydła, ościeżnice, okucia, opcje).
// Nowa ulotka: zmień ZRODLO.nazwa — skrypt wyłącza poprzednie źródła tego producenta (aktywny = false) i dodaje nowe.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const skill = process.argv[2]
if (!skill) {
  console.error('Podaj katalog skilla wycena-drzwi (ten z SKILL.md i dane/)')
  process.exit(1)
}

const ZRODLO = { producent: 'KR Center', nazwa: 'Ulotka Sierpień 2026 — drzwi wewnętrzne', edycja: '2026-08', wazny_od: '2026-08-01' }

/** CSV z cudzysłowami (pola z przecinkami, "" = cudzysłów) → tablica obiektów */
export function parseCsv(tekst) {
  const wiersze = []
  let pole = ''
  let wiersz = []
  let wCudzyslowie = false
  for (let i = 0; i < tekst.length; i++) {
    const c = tekst[i]
    if (wCudzyslowie) {
      if (c === '"' && tekst[i + 1] === '"') { pole += '"'; i++ } else if (c === '"') wCudzyslowie = false
      else pole += c
    } else if (c === '"') wCudzyslowie = true
    else if (c === ',') { wiersz.push(pole); pole = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && tekst[i + 1] === '\n') i++
      wiersz.push(pole); pole = ''
      if (wiersz.some((x) => x !== '')) wiersze.push(wiersz)
      wiersz = []
    } else pole += c
  }
  if (pole !== '' || wiersz.length) { wiersz.push(pole); if (wiersz.some((x) => x !== '')) wiersze.push(wiersz) }
  const [naglowek, ...reszta] = wiersze
  return reszta.map((w) => Object.fromEntries(naglowek.map((k, i) => [k.trim(), (w[i] ?? '').trim()])))
}

/** "1 234,50" → 1234.5; puste → null */
export const kwota = (s) => {
  const t = String(s ?? '').replace(/\s/g, '').replace(',', '.')
  return t === '' || Number.isNaN(Number(t)) ? null : Number(t)
}
const sql = (v) => (v == null || v === '' ? 'null' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)
const czytaj = (f) => parseCsv(readFileSync(join(skill, 'dane', 'kr-center', f), 'utf8'))

const pozycje = []
for (const r of czytaj('skrzydla-wewnetrzne.csv')) {
  pozycje.push({ kategoria: 'skrzydlo', symbol: r.model, okleina: r.okleina, kolor: r.kolor, dostepnosc: r.dostepnosc, wariant: r.zamek, szerokosci: r.szerokosci.replace(/"/g, ''), netto: kwota(r.netto), brutto: kwota(r.brutto), strona: Number(r.strona) || null, uwaga: r.uwaga, atrybuty: { typ: r.typ } })
}
for (const r of czytaj('oscieznice.csv')) {
  const [od, doo] = String(r.zakres_mm ?? '').split('-').map((x) => Number(x) || null)
  const okleina = /PRO Line/i.test(r.wariant) ? 'PRO Line' : /TOP Decor/i.test(r.wariant) ? 'TOP Decor' : null
  pozycje.push({ kategoria: 'oscieznica', symbol: r.symbol, okleina, wariant: r.wariant, mur_od_mm: od, mur_do_mm: doo, netto: kwota(r.netto), brutto: kwota(r.brutto), strona: Number(r.strona) || null, uwaga: r.uwaga, atrybuty: {} })
}
for (const r of czytaj('okucia.csv')) {
  pozycje.push({ kategoria: 'okucie', symbol: `${r.marka} — ${r.element}`, kolor: r.kolor, wariant: r.szyld_ksztalt, netto: kwota(r.netto), brutto: kwota(r.brutto), strona: Number(r.strona) || null, uwaga: r.uwaga, atrybuty: { marka: r.marka, element: r.element } })
}
for (const r of czytaj('opcje.csv')) {
  pozycje.push({ kategoria: 'opcja', symbol: r.opcja, wariant: r.grupa, dostepnosc: r.dostepnosc, netto: kwota(r.netto), brutto: kwota(r.brutto), strona: Number(r.strona) || null, uwaga: r.uwaga, atrybuty: {} })
}

const kol = ['kategoria', 'symbol', 'okleina', 'kolor', 'dostepnosc', 'wariant', 'szerokosci', 'mur_od_mm', 'mur_do_mm', 'netto', 'brutto', 'strona', 'uwaga']

// --wgraj: od razu do bazy przez REST kluczem serwisowym z .env (SUPABASE_SERVICE_ROLE_KEY) — bez wklejania SQL
if (process.argv.includes('--wgraj')) {
  const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')] }))
  const { createClient } = await import('@supabase/supabase-js')
  const db = createClient('https://vwlabgmilckfhtuerzio.supabase.co', env.SUPABASE_SERVICE_ROLE_KEY, { db: { schema: 'crm' } })
  const e1 = await db.from('cennik_zrodla').update({ aktywny: false }).eq('producent', ZRODLO.producent).neq('nazwa', ZRODLO.nazwa)
  if (e1.error) throw new Error(e1.error.message)
  const e2 = await db.from('cennik_zrodla').delete().eq('producent', ZRODLO.producent).eq('nazwa', ZRODLO.nazwa)
  if (e2.error) throw new Error(e2.error.message)
  const { data: z, error: e3 } = await db.from('cennik_zrodla').insert({ ...ZRODLO, aktywny: true, uwagi: `import ze skilla wycena-drzwi (dane/kr-center), ${pozycje.length} pozycji` }).select('id').single()
  if (e3) throw new Error(e3.message)
  const wiersze = pozycje.map((p) => ({ zrodlo_id: z.id, producent: ZRODLO.producent, ...Object.fromEntries(kol.map((k) => [k, p[k] === '' ? null : p[k] ?? null])), atrybuty: p.atrybuty ?? {} }))
  const { error: e4 } = await db.from('cennik_pozycje').insert(wiersze)
  if (e4) throw new Error(e4.message)
  console.error(`wgrano źródło ${z.id}: ${wiersze.length} pozycji`)
  process.exit(0)
}

const out = []
out.push('begin;')
out.push(`update crm.cennik_zrodla set aktywny = false where producent = ${sql(ZRODLO.producent)} and nazwa <> ${sql(ZRODLO.nazwa)};`)
out.push(`delete from crm.cennik_zrodla where producent = ${sql(ZRODLO.producent)} and nazwa = ${sql(ZRODLO.nazwa)};`)
out.push(`with z as (insert into crm.cennik_zrodla (producent, nazwa, edycja, wazny_od, aktywny, uwagi) values (${sql(ZRODLO.producent)}, ${sql(ZRODLO.nazwa)}, ${sql(ZRODLO.edycja)}, ${sql(ZRODLO.wazny_od)}, true, 'import ze skilla wycena-drzwi (dane/kr-center), ${pozycje.length} pozycji') returning id)`)
out.push(`insert into crm.cennik_pozycje (zrodlo_id, producent, ${kol.join(', ')}, atrybuty) select z.id, v.* from z, (values`)
out.push(pozycje.map((p) => `  (${sql(ZRODLO.producent)}, ${kol.map((k) => sql(p[k] ?? null)).join(', ')}, ${sql(JSON.stringify(p.atrybuty ?? {}))}::jsonb)`).join(',\n'))
out.push(`) as v(producent, ${kol.join(', ')}, atrybuty);`)
out.push('commit;')
process.stdout.write(out.join('\n') + '\n')
console.error(`pozycji: ${pozycje.length} (skrzydła ${pozycje.filter((p) => p.kategoria === 'skrzydlo').length}, ościeżnice ${pozycje.filter((p) => p.kategoria === 'oscieznica').length}, okucia ${pozycje.filter((p) => p.kategoria === 'okucie').length}, opcje ${pozycje.filter((p) => p.kategoria === 'opcja').length})`)
