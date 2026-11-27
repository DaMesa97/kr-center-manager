#!/usr/bin/env node
// Katalog sklepu podrzwi.pl → crm.produkty i crm.grupy_opcji (27.11.2026), BEZ haseł: tylko to, co sklep pokazuje publicznie.
//   * produkty i ceny brutto: publiczne Store API WooCommerce (/wp-json/wc/store/v1/products), to samo, z którego CRM robi koszyk;
//   * opcje Barn2 (pola, wybory, dopłaty, warunki, produkty dodatkowe): z kodu kart produktów (data-option-id, data-price-amount,
//     data-clogic-conditions…). Grupy powtarzają się między produktami, więc czytamy tylko tyle kart, żeby każda grupa
//     z bazy pojawiła się choć raz (--wszystkie = wszystkie karty, ok. 1,4 GB, raz na jakiś czas).
// Które grupy są przy którym produkcie, crm-oferta i tak sprawdza na żywo przy każdej ofercie (v23+), więc products / categories /
// exclude_* grup zostają z poprzedniego importu (zapas, gdy karta się nie wczyta).
//
// Użycie (z katalogu repo):
//   node scripts/sklep-katalog-import.mjs                 – tylko raport: co się zmieniło w sklepie względem bazy (nic nie zapisuje)
//   node scripts/sklep-katalog-import.mjs --wgraj         – raport + zapis zmian do bazy (klucz serwisowy z .env)
//   node scripts/sklep-katalog-import.mjs --karta <url>   – porównanie jednej karty produktu z bazą (do sprawdzania parsera)
//   opcje: --wszystkie (wszystkie karty), --limit N (maks. kart), --raport plik.json (pełny raport do pliku)
import { readFileSync, writeFileSync } from 'node:fs'

const SKLEP = 'https://podrzwi.pl'
const UA = 'Mozilla/5.0 (PoDrzwi CRM katalog)'
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
const WGRAJ = process.argv.includes('--wgraj')
const WSZYSTKIE = process.argv.includes('--wszystkie')
const LIMIT = Number(arg('--limit') ?? 0) || Infinity
const RAPORT = arg('--raport')
const KARTA = arg('--karta')
const ROWNOLEGLE = 4

// ------------------------------------------------------------------------------------------ HTML
const ENCJE = { quot: '"', amp: '&', apos: "'", lt: '<', gt: '>', nbsp: ' ' }
export function dekoduj(s) {
  return String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENCJE[n.toLowerCase()] ?? m)
}
const atrybut = (tag, nazwa) => { const m = tag.match(new RegExp(`\\s${nazwa}=(["'])([\\s\\S]*?)\\1`)); return m ? dekoduj(m[2]) : null }
const tekst = (html) => dekoduj(String(html ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

// typy pól na karcie → typy z API Barn2 (tak zapisane w crm.grupy_opcji; kalkulator rozróżnia html/wysiwyg/product/number/text/…)
const TYP_Z_KARTY = { image_buttons: 'images', display: 'html' }

/** Karta produktu → Map(groupId → opcje w kształcie crm.grupy_opcji.options), w kolejności z karty. */
export function opcjeZKarty(html) {
  const grupy = new Map()
  const starty = [...html.matchAll(/<div id="wpo-field-(\d+)-(\d+)"[^>]*>/g)]
  starty.forEach((m, k) => {
    const tag = m[0]
    const naKarcie = Number(m[2])   // produkt, którego to karta (lista „Podobne produkty” pomija samego siebie)
    const blok = html.slice(m.index, k + 1 < starty.length ? starty[k + 1].index : m.index + 60000)
    const gid = Number(atrybut(tag, 'data-group-id'))
    const id = Number(atrybut(tag, 'data-option-id'))
    if (!gid || !id) return
    const klasa = atrybut(tag, 'class') ?? ''
    const produkt = atrybut(tag, 'data-parent-type') === 'product' || /\bwpo-field-product\b/.test(klasa)
    const typKarta = atrybut(tag, 'data-type') ?? ''
    let warunki = '{}'
    if (atrybut(tag, 'data-clogic') === 'true') {
      try {
        warunki = { relation: atrybut(tag, 'data-clogic-relation') ?? 'and', conditions: JSON.parse(atrybut(tag, 'data-clogic-conditions') ?? '[]'), visibility: atrybut(tag, 'data-clogic-visibility') ?? 'show' }
      } catch { warunki = null }   // nie dało się odczytać – zostanie stara wartość
    }
    const nazwa = tekst((blok.match(/<span class="wpo-option-name__text">([\s\S]*?)<\/span>/) ?? [])[1] ?? '')
    const wybory = []
    const produkty = []
    // dropdown: <option value=… data-price-type=… data-price-amount=… aria-label=…>
    // pole produktów jako lista z licznikami („Podobne produkty”, „Zestaw w wersji WC”): name="wpo-option[option-ID-qty][PID]"
    if (produkt) for (const q of blok.matchAll(new RegExp(`name="wpo-option\\[option-${id}-qty\\]\\[(\\d+)\\]"`, 'g'))) { const pid = Number(q[1]); if (pid && !produkty.includes(pid)) produkty.push(pid) }
    for (const o of blok.matchAll(/<option\s[^>]*>/g)) {
      const t = o[0]
      const v = atrybut(t, 'value')
      if (!v) continue
      // lista rozwijana produktów (np. „Regulacja ościeżnicy” przy drzwiach od ręki) ma wartości „71393,71393”
      if (produkt) { const pid = parseInt(v, 10); if (pid && !produkty.includes(pid)) produkty.push(pid); continue }
      wybory.push(wybor(v, atrybut(t, 'aria-label') ?? '', atrybut(t, 'data-price-type'), atrybut(t, 'data-price-amount'), /\sselected[=\s>]/.test(t)))
    }
    // pola z inputami (image_buttons, checkbox, radio, text_labels, product…): etykieta z najbliższego <label … aria-label/title>
    for (const inp of blok.matchAll(/<input\s[^>]*>/g)) {
      const t = inp[0]
      const name = atrybut(t, 'name') ?? ''
      if (!name.startsWith(`wpo-option[option-${id}]`)) continue
      const v = atrybut(t, 'value')
      if (v == null || v === '') continue
      if (produkt) { const pid = Number(v); if (pid && !produkty.includes(pid)) produkty.push(pid); continue }
      const przed = blok.slice(0, inp.index)
      const lab = przed.slice(przed.lastIndexOf('<label'))
      const labTag = (lab.match(/^<label[^>]*>/) ?? [''])[0]
      const po = blok.slice(inp.index + t.length, blok.indexOf('</label>', inp.index) > 0 ? blok.indexOf('</label>', inp.index) : inp.index + 400)
      const etykieta = atrybut(labTag, 'aria-label') ?? (atrybut(labTag, 'title') ?? '').replace(/\s*\(\+[^)]*\)\s*$/, '').trim() ?? tekst(po)
      wybory.push(wybor(v, etykieta || tekst(po), atrybut(t, 'data-price-type'), atrybut(t, 'data-price-amount'), /\schecked[=\s>]/.test(t)))
    }
    const op = {
      id, name: nazwa, type: produkt ? 'product' : (TYP_Z_KARTY[typKarta] ?? typKarta), required: /\bwpo-field-required\b/.test(klasa) ? '1' : '0',
      conditional_logic: warunki, choices: wybory, manual_products: produkty, _typ_karty: typKarta, _produkt: produkt, _karta: naKarcie,
    }
    if (!grupy.has(gid)) grupy.set(gid, [])
    if (!grupy.get(gid).some((x) => x.id === id)) grupy.get(gid).push(op)
  })
  return grupy
}
function wybor(id, label, priceType, amount, selected) {
  const pt = priceType || 'no_cost'
  const kw = amount == null || amount === '' ? null : Number(amount)
  return { id, label: String(label).trim(), price_type: pt, pricing: pt === 'no_cost' ? false : (kw ?? ''), selected }
}

// ------------------------------------------------------------------------------------------ scalanie z bazą
// porównanie bez znaczenia kolejności kluczy (baza: id, value, operator…; karta: id, optionID, optionType…) i typu optionID (13018 / "13018")
const kanon = (v) => (Array.isArray(v) ? v.map(kanon) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, k === 'optionID' ? String(v[k]) : kanon(v[k])])) : v)
const norm = (v) => JSON.stringify(kanon(v))
const warunkiPuste = (w) => { if (w == null || w === '' || w === '{}') return true; const o = typeof w === 'string' ? (() => { try { return JSON.parse(w) } catch { return {} } })() : w; return !Array.isArray(o?.conditions) || !o.conditions.length }

/** Stara grupa z bazy + opcje z karty → { opcje, zmiany[] }. Typ i menu_order istniejących pól zostają; reszta z karty. */
export function scalGrupe(stara, zKarty) {
  const zmiany = []
  const stare = new Map((stara?.options ?? []).map((o) => [o.id, o]))
  const out = zKarty.map((k, i) => {
    const s = stare.get(k.id)
    if (!s) { zmiany.push(`+ pole #${k.id} „${k.name}” (${k.type})`); return { id: k.id, name: k.name, type: k.type, choices: k._produkt ? [] : k.choices, required: k.required, menu_order: i, manual_products: k.manual_products, conditional_logic: k.conditional_logic ?? '{}' } }
    const n = { ...s }
    if (k.name && k.name !== String(s.name ?? '').trim()) { zmiany.push(`#${k.id} nazwa: „${s.name}” → „${k.name}”`); n.name = k.name }
    if (k.required !== String(s.required ?? '0')) { zmiany.push(`#${k.id} „${k.name}” wymagane: ${s.required} → ${k.required}`); n.required = k.required }
    if (k.conditional_logic !== null) {
      const bylo = warunkiPuste(s.conditional_logic), jest = warunkiPuste(k.conditional_logic)
      if (!(bylo && jest) && norm(typeof s.conditional_logic === 'string' ? JSON.parse(s.conditional_logic || '{}') : s.conditional_logic) !== norm(k.conditional_logic)) {
        zmiany.push(`#${k.id} „${k.name}” warunki widoczności zmienione`); n.conditional_logic = jest ? '{}' : k.conditional_logic
      }
    }
    if (k._produkt || s.type === 'product') {
      // porównanie zbiorów; lista na karcie nie zawiera produktu, którego to karta — wtedy zostaje on z bazy
      const stareP = (s.manual_products ?? []).map(Number)
      const zbior = (a) => JSON.stringify([...new Set(a)].sort((x, y) => x - y))
      const bezSiebie = stareP.filter((x) => x !== k._karta)
      if (k.manual_products.length === 0 && stareP.length > 0) {
        // pola z produktami, którego parser nie umie odczytać (inny wygląd) — nie zerujemy listy z bazy
        zmiany.push(`! #${k.id} „${k.name}”: nie odczytano listy produktów z karty (zostaje z bazy: ${stareP.length})`)
      } else if (zbior(stareP) !== zbior(k.manual_products) && zbior(bezSiebie) !== zbior(k.manual_products)) {
        zmiany.push(`#${k.id} „${k.name}” produkty: [${stareP.join(',')}] → [${k.manual_products.join(',')}]`); n.manual_products = k.manual_products
      }
    } else if (['number', 'text', 'customer_price', 'html', 'wysiwyg', 'price_formula'].includes(s.type)) {
      // pola bez wyborów do kliknięcia – wybory/opisy zostają z poprzedniego importu
    } else if (k.choices.length) {
      const sw = new Map((s.choices ?? []).map((c) => [c.id, c]))
      const nowe = k.choices.map((c) => {
        const st = sw.get(c.id)
        if (!st) { zmiany.push(`#${k.id} „${k.name}” + wybór „${c.label}”${c.pricing ? ` (${c.pricing} zł)` : ''}`); return c }
        const w = { ...st }
        if (c.label && c.label !== String(st.label ?? '').trim()) { zmiany.push(`#${k.id} „${k.name}” etykieta „${st.label}” → „${c.label}”`); w.label = c.label }
        if (['no_cost', 'flat_fee', 'quantity_based'].includes(c.price_type)) {
          const ptSt = st.price_type || 'no_cost'   // stare wiersze mają czasem null = bez dopłaty
          const cenaSt = ptSt === 'no_cost' ? 0 : Number(st.pricing || 0), cenaN = c.price_type === 'no_cost' ? 0 : Number(c.pricing || 0)
          if (c.price_type !== ptSt || cenaSt !== cenaN) { zmiany.push(`#${k.id} „${k.name}” / „${c.label}”: ${st.price_type} ${cenaSt} → ${c.price_type} ${cenaN} zł`); w.price_type = c.price_type; w.pricing = c.pricing }
        }
        if (!!c.selected !== !!st.selected) { zmiany.push(`#${k.id} „${k.name}” / „${c.label}” domyślny: ${!!st.selected} → ${!!c.selected}`); w.selected = c.selected }
        return w
      })
      for (const st of s.choices ?? []) if (!k.choices.some((c) => c.id === st.id)) zmiany.push(`#${k.id} „${k.name}” − wybór „${st.label}”`)
      n.choices = nowe
    }
    return n
  })
  for (const s of stara?.options ?? []) if (!zKarty.some((k) => k.id === s.id)) zmiany.push(`− pole #${s.id} „${s.name}” (${s.type})`)
  // kolejność pól jak na karcie (menu_order istniejących pól zostaje, nowe dostają pozycję z karty)
  return { opcje: out, zmiany }
}

// ------------------------------------------------------------------------------------------ sieć
async function pobierz(url, proby = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) })
      if (r.ok) return r
      if (i >= proby || r.status < 500) throw new Error(`${r.status} ${url}`)
    } catch (e) { if (i >= proby) throw e }
    await new Promise((res) => setTimeout(res, 2000 * i))
  }
}
async function produktySklepu() {
  const out = []
  for (let p = 1; ; p++) {
    const r = await pobierz(`${SKLEP}/wp-json/wc/store/v1/products?per_page=100&page=${p}&orderby=id&order=asc`)
    const lista = await r.json()
    out.push(...lista)
    const strony = Number(r.headers.get('x-wp-totalpages') ?? 1)
    process.stderr.write(`\rprodukty ze sklepu: ${out.length}`)
    if (p >= strony || !lista.length) break
  }
  process.stderr.write('\n')
  return out.map((p) => ({
    id: p.id, nazwa: dekoduj(p.name), status: 'publish',
    cena: Number(p.prices?.price ?? 0) / 10 ** Number(p.prices?.currency_minor_unit ?? 2),
    cena_regularna: Number(p.prices?.regular_price ?? 0) / 10 ** Number(p.prices?.currency_minor_unit ?? 2),
    permalink: p.permalink, kategorie: (p.categories ?? []).map((c) => c.id), kategorie_nazwy: (p.categories ?? []).map((c) => dekoduj(c.name)),
  }))
}

// ------------------------------------------------------------------------------------------ baza
async function baza() {
  const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')] }))
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Brak SUPABASE_SERVICE_ROLE_KEY w .env')
  const { createClient } = await import('@supabase/supabase-js')
  return createClient('https://vwlabgmilckfhtuerzio.supabase.co', env.SUPABASE_SERVICE_ROLE_KEY, { db: { schema: 'crm' } })
}
async function wszystko(db, tabela, kolumny) {
  const out = []
  for (let od = 0; ; od += 1000) {
    const { data, error } = await db.from(tabela).select(kolumny).order('id').range(od, od + 999)
    if (error) throw new Error(`${tabela}: ${error.message}`)
    out.push(...data)
    if (data.length < 1000) return out
  }
}

/** Grupy, które wg poprzedniego importu powinny być na karcie produktu (do wyboru kart do odczytu). */
function przewidywaneGrupy(grupy, p) {
  const kat = new Set(p.kategorie ?? [])
  return grupy.filter((g) => g.visibility === 'specific' && (g.options ?? []).length
    && ((g.products ?? []).includes(p.id) || (g.categories ?? []).some((c) => kat.has(c)))
    && !(g.exclude_products ?? []).includes(p.id) && !(g.exclude_categories ?? []).some((c) => kat.has(c))).map((g) => g.id)
}

// ------------------------------------------------------------------------------------------ główny
async function main() {
  const db = await baza()
  const grupyDb = await wszystko(db, 'grupy_opcji', '*')
  const poId = new Map(grupyDb.map((g) => [g.id, g]))
  console.error(`w bazie: ${grupyDb.length} grup opcji`)

  if (KARTA) {
    const html = await (await pobierz(KARTA)).text()
    for (const [gid, opcje] of opcjeZKarty(html)) {
      const { zmiany } = scalGrupe(poId.get(gid), opcje)
      console.log(`grupa #${gid} ${poId.get(gid)?.nazwa ?? '(NOWA)'}: ${opcje.length} pól, ${zmiany.length ? `${zmiany.length} zmian` : 'bez zmian'}`)
      for (const z of zmiany) console.log('   ' + z)
    }
    return
  }

  const sklep = await produktySklepu()
  const produktyDb = await wszystko(db, 'produkty', 'id, nazwa, status, cena, cena_regularna, permalink')
  const pDb = new Map(produktyDb.map((p) => [p.id, p]))
  const zmianyProduktow = []
  for (const p of sklep) {
    const s = pDb.get(p.id)
    if (!s) zmianyProduktow.push(`+ #${p.id} ${p.nazwa.slice(0, 70)} (${p.cena} zł)`)
    else if (Number(s.cena) !== p.cena) zmianyProduktow.push(`#${p.id} ${p.nazwa.slice(0, 60)}: ${s.cena} → ${p.cena} zł`)
    else if (s.status !== 'publish') zmianyProduktow.push(`#${p.id} ${p.nazwa.slice(0, 60)}: status ${s.status} → publish`)
  }
  const wSklepie = new Set(sklep.map((p) => p.id))
  const zniknely = produktyDb.filter((p) => p.status === 'publish' && !wSklepie.has(p.id))

  // karty do odczytu: zachłannie, aż każda grupa z bazy (specific, z polami) pojawi się choć raz; --wszystkie = każda karta
  const doPokrycia = new Set(grupyDb.filter((g) => g.visibility === 'specific' && (g.options ?? []).length).map((g) => g.id))
  const kandydaci = sklep.filter((p) => p.permalink && !(p.kategorie_nazwy ?? []).includes('Konfigurator'))
    .map((p) => ({ p, przew: przewidywaneGrupy(grupyDb, p) })).filter((x) => WSZYSTKIE || x.przew.length)
  const zKart = new Map()       // gid → opcje z karty
  const gdzie = new Map()       // gid → [pid…] (karty, na których grupa jest)
  let przeczytane = 0
  const kolejka = [...kandydaci]
  const nastepny = () => {
    if (WSZYSTKIE) return kolejka.shift()
    // najwięcej jeszcze niewidzianych grup
    let best = -1, ile = 0
    kolejka.forEach((x, i) => { const n = x.przew.filter((g) => doPokrycia.has(g)).length; if (n > ile) { ile = n; best = i } })
    return best >= 0 ? kolejka.splice(best, 1)[0] : undefined
  }
  const pracownik = async () => {
    for (;;) {
      if (przeczytane >= LIMIT) return
      const x = nastepny()
      if (!x) return
      przeczytane++
      for (const g of x.przew) doPokrycia.delete(g)   // rezerwacja, żeby równoległe wątki nie czytały tego samego
      try {
        const html = await (await pobierz(x.p.permalink)).text()
        for (const [gid, opcje] of opcjeZKarty(html)) {
          if (!zKart.has(gid)) zKart.set(gid, opcje)
          gdzie.set(gid, [...(gdzie.get(gid) ?? []), x.p.id])
          doPokrycia.delete(gid)
        }
      } catch (e) { console.error(`\nkarta #${x.p.id}: ${e.message}`) }
      process.stderr.write(`\rkarty: ${przeczytane}, grup odczytanych: ${zKart.size}, zostało do pokrycia: ${doPokrycia.size}   `)
    }
  }
  await Promise.all(Array.from({ length: ROWNOLEGLE }, pracownik))
  process.stderr.write('\n')

  const raport = { czas: new Date().toISOString(), kart: przeczytane, produkty: { w_sklepie: sklep.length, zmiany: zmianyProduktow, zniknely: zniknely.map((p) => `#${p.id} ${p.nazwa}`) }, grupy: [] }
  const doZapisu = []
  for (const [gid, opcje] of zKart) {
    const stara = poId.get(gid)
    const { opcje: nowe, zmiany } = scalGrupe(stara, opcje)
    if (!stara) {
      raport.grupy.push({ id: gid, nazwa: '(nowa grupa)', zmiany, karty: gdzie.get(gid) })
      doZapisu.push({ id: gid, nazwa: `Grupa #${gid} (z karty sklepu)`, visibility: 'specific', menu_order: 0, products: gdzie.get(gid), exclude_products: [], categories: [], exclude_categories: [], options: nowe })
    } else if (zmiany.length) {
      raport.grupy.push({ id: gid, nazwa: stara.nazwa, zmiany })
      // same ostrzeżenia („!” — nie odczytano, zostaje z bazy) to nie zmiana — grupy nie zapisujemy
      if (zmiany.some((z) => !z.startsWith('! '))) doZapisu.push({ ...stara, options: nowe })
    }
  }
  const nieodczytane = [...doPokrycia].map((g) => `#${g} ${poId.get(g)?.nazwa ?? ''}`)

  console.log(`\nPRODUKTY: w sklepie ${sklep.length}; zmian ${zmianyProduktow.length}; w bazie jako opublikowane, a w sklepie ich nie ma: ${zniknely.length}`)
  for (const z of zmianyProduktow.slice(0, 40)) console.log('  ' + z)
  if (zmianyProduktow.length > 40) console.log(`  … i ${zmianyProduktow.length - 40} więcej`)
  console.log(`\nGRUPY OPCJI: odczytano ${zKart.size} z ${przeczytane} kart; zmienionych / nowych: ${raport.grupy.length}; nieodczytanych (żadna karta ich nie pokazała): ${nieodczytane.length}`)
  for (const g of raport.grupy) {
    console.log(`  #${g.id} ${g.nazwa}: ${g.zmiany.length} zmian`)
    for (const z of g.zmiany.slice(0, 8)) console.log('     ' + z)
    if (g.zmiany.length > 8) console.log(`     … i ${g.zmiany.length - 8} więcej`)
  }
  raport.nieodczytane = nieodczytane
  if (RAPORT) { writeFileSync(RAPORT, JSON.stringify(raport, null, 1)); console.log(`\npełny raport: ${RAPORT}`) }

  if (!WGRAJ) { console.log('\n(tylko raport — nic nie zapisano; zapis: --wgraj)'); return }
  const teraz = new Date().toISOString()
  for (let i = 0; i < sklep.length; i += 200) {
    const { error } = await db.from('produkty').upsert(sklep.slice(i, i + 200).map((p) => ({ ...p, zaktualizowano: teraz })), { onConflict: 'id' })
    if (error) throw new Error('zapis produktów: ' + error.message)
  }
  for (let i = 0; i < doZapisu.length; i += 50) {
    const { error } = await db.from('grupy_opcji').upsert(doZapisu.slice(i, i + 50).map((g) => ({ ...g, zaktualizowano: teraz })), { onConflict: 'id' })
    if (error) throw new Error('zapis grup: ' + error.message)
  }
  console.log(`\nZAPISANO: ${sklep.length} produktów, ${doZapisu.length} grup opcji`)
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  main().catch((e) => { console.error('\nBŁĄD: ' + (e instanceof Error ? e.message : String(e))); process.exit(1) })
}
