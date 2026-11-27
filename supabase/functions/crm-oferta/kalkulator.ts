// Kalkulator cen Po Drzwi: cena bazowa z WooCommerce + dopłaty z Barn2 Product Options.
// Port 1:1 z kalkulator/kalkulator.py (ten plik jest czysty: bez Deno i bez bazy, testowalny Node'em).
// Zasada: AI dobiera produkt i opcje, ten kod liczy cenę.

export type Produkt = {
  id: number; nazwa: string; status: string | null; cena: number | null; cena_regularna?: number | null
  permalink: string | null; kategorie: number[]; kategorie_nazwy?: string[]
}
export type Wybor = { id: string; label: string; price_type: string | null; pricing: string | number | null | boolean; selected: boolean | null }
export type Opcja = {
  id: number; name: string; menu_order: number; required: string | null; type: string
  conditional_logic: unknown; choices: Wybor[]; manual_products: number[]
}
export type Grupa = {
  id: number; nazwa: string; visibility: string; menu_order: number
  products: number[]; exclude_products: number[]; categories: number[]; exclude_categories: number[]; options: Opcja[]
}

// Wyjątki potwierdzone na stronie sklepu (serwer renderuje inne produkty niż zwraca API).
// Klucz: id opcji typu `product`; wartość: lista product_id, które sklep faktycznie pokazuje.
export const OVERRIDE_PRODUCT_CHOICES: Record<number, number[]> = {
  76: [42716, 43519],   // grupa 21 „Okucia - Czarne Mat - Wood+, Alu extra”: API mówi 30665 (inox), strona pokazuje czarne mat (TODO w sklepie)
}

export type StanWartosc = string | number | string[]
export type Stan = Record<string, StanWartosc>
export type Pozycja = { grupa: string; opcja: string; wybor: string; kwota: number; typ: string }
export type Wynik = {
  produkt_id: number; nazwa: string; cena_bazowa: number; pozycje: Pozycja[]
  brakujace: string[]; uwagi: string[]; doplaty: number
  /** liczba sztuk tej pozycji; `razem_szt` = cena jednej sztuki, `razem` = wszystkie sztuki (dopłaty flat_fee liczone raz) */
  ilosc: number; razem_szt: number; razem: number
}

const zaokr = (x: number) => Math.round(x * 100) / 100
export function num(x: unknown): number {
  if (x === null || x === undefined || x === false || x === '') return 0
  const n = parseFloat(String(x).replace(',', '.'))
  return isNaN(n) ? 0 : n
}

export class Dane {
  produkty = new Map<number, Produkt>()
  grupy = new Map<number, Grupa>()
  private poProdukcie = new Map<number, Set<number>>()
  private poKategorii = new Map<number, Set<number>>()
  /** 27.11: grupy, które karta produktu w sklepie renderuje NA ŻYWO (ważniejsze niż products/exclude_* ze zrzutu katalogu) */
  private naKarcie = new Map<number, Set<number>>()
  /** uwagi o nieaktualnym katalogu (grupa / pole na karcie sklepu, którego nie ma w zrzucie) — idą do „sprawdź” */
  katalogUwagi: string[] = []

  constructor(produkty: Produkt[], grupy: Grupa[]) {
    for (const p of produkty) this.produkty.set(p.id, p)
    for (const g of grupy) {
      this.grupy.set(g.id, g)
      if (g.visibility !== 'specific') continue
      for (const pid of g.products ?? []) this.dodaj(this.poProdukcie, pid, g.id)
      for (const cid of g.categories ?? []) this.dodaj(this.poKategorii, cid, g.id)
    }
  }
  private dodaj(m: Map<number, Set<number>>, k: number, v: number) {
    if (!m.has(k)) m.set(k, new Set())
    m.get(k)!.add(v)
  }
  produkt(id: number): Produkt | undefined { return this.produkty.get(id) }
  ustawGrupyZKarty(pid: number, grupy: Set<number>) { this.naKarcie.set(pid, grupy) }

  /** Grupy Barn2 widoczne na karcie produktu (products + categories − exclude_*). Zweryfikowane ze stroną sklepu. */
  grupyProduktu(pid: number): Grupa[] {
    const p = this.produkty.get(pid)
    if (!p) throw new Error(`Nie znam produktu #${pid}`)
    const kat = new Set(p.kategorie ?? [])
    // Otto 49 (27.11): zrzut z 14.11 wykluczał grupę „Kierunek i sposób otwierania”, a sklep już ją pokazuje (i wymaga) → koszyk odrzucał drzwi.
    // Gdy znamy grupy z karty produktu, liczymy dokładnie te.
    const zKarty = this.naKarcie.get(pid)
    if (zKarty) {
      return [...zKarty].map((gid) => this.grupy.get(gid)).filter((g): g is Grupa => !!g && !!g.options?.length)
        .sort((a, b) => (a.menu_order || 0) - (b.menu_order || 0) || a.id - b.id)
    }
    const ids = new Set<number>(this.poProdukcie.get(pid) ?? [])
    for (const c of kat) for (const gid of this.poKategorii.get(c) ?? []) ids.add(gid)
    const out: Grupa[] = []
    for (const gid of ids) {
      const g = this.grupy.get(gid)
      if (!g) continue
      if ((g.exclude_products ?? []).includes(pid)) continue
      if ((g.exclude_categories ?? []).some((c) => kat.has(c))) continue
      if (!g.options?.length) continue
      out.push(g)
    }
    return out.sort((a, b) => (a.menu_order || 0) - (b.menu_order || 0) || a.id - b.id)
  }
}

type Warunki = { visibility?: string; relation?: string; conditions: { optionID: unknown; operator?: string; value: unknown }[] }

export function warunki(o: Opcja): Warunki | null {
  let cl: unknown = o.conditional_logic
  if (cl === null || cl === undefined || cl === '' || cl === '{}') return null
  if (typeof cl === 'string') { try { cl = JSON.parse(cl) } catch { return null } }
  const w = cl as Warunki
  return Array.isArray(w?.conditions) && w.conditions.length ? w : null
}

function wartosci(stan: Stan, oid: string): Set<string> {
  const v = stan[oid]
  if (v === undefined || v === null) return new Set()
  if (Array.isArray(v)) return new Set(v.map(String))
  return new Set([String(v)])
}

function widoczna(o: Opcja, stan: Stan, widoczne: Record<string, boolean>): boolean {
  const cl = warunki(o)
  if (!cl) return true
  const wyniki: boolean[] = []
  for (const c of cl.conditions) {
    const oid = String(c.optionID)
    const vals = (widoczne[oid] ?? true) ? wartosci(stan, oid) : new Set<string>()
    // Barn2: wartość „any” (albo brak wartości) = „pole ma jakąkolwiek wartość” (drzwi wewnętrzne: „Ościeżnica” pokazuje się, gdy Wariant = any;
    // 500 takich warunków w sklepie – przez to oferta Lucano 17.11 wyszła bez ościeżnic, bo kalkulator chował te pola)
    const dowolna = c.value === null || c.value === undefined || c.value === '' || String(c.value).toLowerCase() === 'any'
    const target = String(c.value)
    switch (c.operator) {
      case 'equals': wyniki.push(dowolna ? vals.size > 0 : vals.has(target)); break
      case 'not_equals': wyniki.push(dowolna ? vals.size === 0 : !vals.has(target)); break
      case 'contains': wyniki.push(dowolna ? vals.size > 0 : [...vals].some((v) => v.toLowerCase().includes(target.toLowerCase()))); break
      case 'not_empty': wyniki.push(vals.size > 0); break
      default: wyniki.push(false)
    }
  }
  const ok = cl.relation === 'and' ? wyniki.every(Boolean) : wyniki.some(Boolean)
  return (cl.visibility ?? 'show') === 'show' ? ok : !ok
}

export function produktyOpcji(o: Opcja): number[] {
  return OVERRIDE_PRODUCT_CHOICES[o.id] ?? (o.manual_products ?? []).filter((x) => typeof x === 'number' && x > 0)
}

export type Pole = { g: Grupa; o: Opcja }

/** Płaska lista pól (opcji) produktu z grupami, w kolejności wyświetlania. */
export function pola(dane: Dane, pid: number): Pole[] {
  const out: Pole[] = []
  for (const g of dane.grupyProduktu(pid)) {
    const ops = [...(g.options ?? [])].sort((a, b) => (a.menu_order || 0) - (b.menu_order || 0))
    for (const o of ops) out.push({ g, o })
  }
  return out
}

/** stan = wybory uzupełnione o domyślne (selected), widoczne = {option_id: bool} wg logiki warunkowej. */
export function stanIWidocznosc(dane: Dane, pid: number, wybory: Stan) {
  const stan: Stan = {}
  for (const [k, v] of Object.entries(wybory)) stan[String(k)] = v
  const lista = pola(dane, pid)
  for (const { o } of lista) {
    const oid = String(o.id)
    if (oid in stan || ['html', 'wysiwyg', 'price_formula'].includes(o.type)) continue
    const dom = (o.choices ?? []).filter((c) => c.selected).map((c) => c.id)
    if (dom.length) stan[oid] = dom.length > 1 ? dom : dom[0]
  }
  // widoczność liczona iteracyjnie (warunki działają w obrębie grupy, ale kolejność bywa dowolna)
  const widoczne: Record<string, boolean> = {}
  for (let i = 0; i < 4; i++) for (const { o } of lista) widoczne[String(o.id)] = widoczna(o, stan, widoczne)
  return { stan, widoczne, lista }
}

/** wybory: {option_id: choice_id | [choice_ids] | product_id | liczba/tekst}. Do wyboru po nazwach użyj wybierzPoNazwach. */
export function policz(dane: Dane, pid: number, wybory: Stan, ilosc = 1): Wynik {
  const p = dane.produkt(pid)
  if (!p) throw new Error(`Nie znam produktu #${pid}`)
  const w: Wynik = { produkt_id: pid, nazwa: p.nazwa, cena_bazowa: num(p.cena), pozycje: [], brakujace: [], uwagi: [], doplaty: 0, ilosc: Math.max(1, Math.round(ilosc || 1)), razem_szt: 0, razem: 0 }
  const { stan, widoczne, lista } = stanIWidocznosc(dane, pid, wybory)
  for (const { g, o } of lista) {
    const oid = String(o.id)
    if (!widoczne[oid]) continue
    const typ = o.type
    if (typ === 'html' || typ === 'wysiwyg') continue
    const vals = wartosci(stan, oid)
    if (typ === 'product') {
      const dostepne = produktyOpcji(o)
      for (const v of vals) {
        const ppid = parseInt(v, 10)
        if (isNaN(ppid)) { w.uwagi.push(`${o.name}: nieprawidłowy produkt ${v}`); continue }
        if (!dostepne.includes(ppid)) { w.uwagi.push(`${o.name}: produkt ${ppid} nie jest dostępny przy tym modelu (dostępne: ${dostepne.join(', ')})`); continue }
        const pp = dane.produkt(ppid)
        w.pozycje.push({ grupa: g.nazwa, opcja: o.name, wybor: pp?.nazwa ?? String(ppid), kwota: num(pp?.cena), typ: 'produkt' })
      }
      if (o.required === '1' && !vals.size) w.brakujace.push(o.name)
      continue
    }
    if (typ === 'price_formula') { w.uwagi.push(`${o.name}: cena ze wzoru, nieobsługiwana w tej wersji`); continue }
    if (typ === 'customer_price') {
      const kw = num(stan[oid])
      if (kw) w.pozycje.push({ grupa: g.nazwa, opcja: o.name, wybor: 'kwota wpisana ręcznie', kwota: kw, typ: 'reczna' })
      continue
    }
    if (typ === 'number' || typ === 'text') {
      if (o.required === '1' && !vals.size) w.brakujace.push(o.name)
      continue
    }
    const choices = new Map((o.choices ?? []).map((c) => [String(c.id), c]))
    if (o.required === '1' && !vals.size) w.brakujace.push(o.name)
    for (const v of vals) {
      const c = choices.get(v)
      if (!c) { w.uwagi.push(`${o.name}: nieznany wybór ${v}`); continue }
      const pt = c.price_type
      if ((pt === 'quantity_based' || pt === 'flat_fee') && c.pricing !== null && c.pricing !== '' && c.pricing !== false && c.pricing !== undefined) {
        w.pozycje.push({ grupa: g.nazwa, opcja: o.name, wybor: c.label, kwota: num(c.pricing), typ: pt })
      }
    }
  }
  w.doplaty = zaokr(w.pozycje.reduce((s, x) => s + x.kwota, 0))
  w.razem_szt = zaokr(w.cena_bazowa + w.doplaty)
  // kilka sztuk: cena bazowa i dopłaty „od sztuki” razy ilość, dopłaty jednorazowe (flat_fee) raz – tak liczy koszyk WooCommerce/Barn2
  const jednorazowe = w.pozycje.filter((x) => x.typ === 'flat_fee').reduce((s, x) => s + x.kwota, 0)
  w.razem = zaokr((w.razem_szt - jednorazowe) * w.ilosc + jednorazowe)
  return w
}

/** Klucz wyboru → nazwa pola. Dwa różne pola o tej samej nazwie (Libre 31: „Sposób otwierania” = na zewnątrz / do wewnątrz
 *  i „Sposób otwierania” = przycisk z elektrozaczepem) trzymamy jako „Sposób otwierania” i „Sposób otwierania #2”. */
export function bazaNazwy(klucz: string): string { return klucz.replace(/\s*#\d+\s*$/, '').trim() }

/** Wartość wyboru dopasowana do pola (choice_id / product_id / tekst) albo null, gdy to pole nie ma takiego wyboru. */
export function dopasujWybor(dane: Dane, o: Opcja, wartosc: string | number): StanWartosc | null {
  if (o.type === 'product') {
    const dost = produktyOpcji(o)
    const v = parseInt(String(wartosc).trim(), 10)
    if (!isNaN(v) && dost.includes(v)) return v
    for (const ppid of dost) if ((dane.produkt(ppid)?.nazwa ?? '').toLowerCase().includes(String(wartosc).toLowerCase())) return ppid
    return null
  }
  if (['number', 'text', 'customer_price'].includes(o.type)) return wartosc
  const ch = o.choices ?? []
  // model przepisuje etykiety ze spisu pól razem z dopiskiem ceny „(+750 zł)” – zdejmujemy go (oferta Rybarz 16.11: „Nie dopasowano wyboru”)
  const want = String(wartosc).replace(/\s*\(\+?\s*[\d\s.,]*\s*zł\)\s*$/i, '').trim().toLowerCase()
  let hit = ch.filter((c) => c.label.trim().toLowerCase() === want)[0]
    ?? ch.filter((c) => c.label.trim().toLowerCase().startsWith(want))[0]
    ?? ch.filter((c) => c.label.trim().toLowerCase().includes(want))[0]
  if (!hit) {
    // dwa pola o tej samej nazwie z innymi etykietami (Bastion Interior: „Rozmiar” = „80 (901 mm x 2073 mm)” przy ościeżnicy pełnej,
    // „80 (865 mm x 2055 mm)” przy regulowanej): dopasuj po pierwszym członie etykiety („80”), gdy pasuje dokładnie jeden wybór
    const glowa = want.split(/[\s(]/)[0]
    const poGlowie = glowa ? ch.filter((c) => c.label.trim().toLowerCase().split(/[\s(]/)[0] === glowa) : []
    if (poGlowie.length === 1) hit = poGlowie[0]
  }
  return hit ? hit.id : null
}

/** Id pól produktu o nazwie `nazwa`, w których `wartosc` jest dostępnym wyborem. */
export function polaZWyborem(dane: Dane, pid: number, nazwa: string, wartosc: string | number): number[] {
  const n = bazaNazwy(nazwa).toLowerCase()
  return pola(dane, pid).filter(({ o }) => o.name.trim().toLowerCase() === n && !['number', 'text', 'customer_price'].includes(o.type) && dopasujWybor(dane, o, wartosc) !== null).map(({ o }) => o.id)
}

/** {nazwa pola: etykieta wyboru lub product_id} → {option_id: choice_id}. Przy duplikatach pól (warunkowych) wybór idzie do każdego,
 *  w którym etykieta istnieje; niewidoczne pola i tak nie liczą się do ceny. Dopasowanie: dokładne, potem prefiks, potem zawieranie. */
export function wybierzPoNazwach(dane: Dane, pid: number, wyboryNazwy: Record<string, string | number>) {
  const out: Stan = {}
  const nieznane: string[] = []
  const lista = pola(dane, pid)
  for (const [klucz, wartosc] of Object.entries(wyboryNazwy)) {
    const nazwa = bazaNazwy(klucz)
    let trafione = false
    for (const { o } of lista) {
      if (o.name.trim().toLowerCase() !== nazwa.toLowerCase()) continue
      const v = dopasujWybor(dane, o, wartosc)
      if (v !== null) { out[String(o.id)] = v; trafione = true }
    }
    if (!trafione) nieznane.push(`${nazwa}=${wartosc}`)
  }
  przeniesDoWidocznychWariantow(dane, pid, lista, out, nieznane)
  return { wybory: out, nieznane }
}

/** Nazwa produktu bez wielkości liter i zbędnych spacji (do porównań między wariantami pola). */
function normNazwa(s: string) { return s.trim().toLowerCase().replace(/\s+/g, ' ') }

/** Długość wspólnego początku dwóch napisów. */
function wspolnyPoczatek(a: string, b: string) {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/** Z listy produktów wybiera ten, którego nazwa jest „tym samym” produktem co `zrodlo` w innym wariancie
 *  (różni się zwykle tylko końcówką, np. „rozstaw klamki 72mm” / „92mm”). Wspólny początek musi objąć co najmniej
 *  60% krótszej nazwy i być jednoznacznie najdłuższy, inaczej null. */
export function najblizszyProdukt(dane: Dane, kandydaci: number[], zrodlo: string): number | null {
  const z = normNazwa(zrodlo)
  if (!z) return null
  let best: number | null = null, bestLen = 0, remis = false
  for (const ppid of kandydaci) {
    const n = normNazwa(dane.produkt(ppid)?.nazwa ?? '')
    if (!n) continue
    if (n === z) return ppid
    const len = wspolnyPoczatek(n, z)
    if (len < 0.6 * Math.min(n.length, z.length)) continue
    if (len > bestLen) { best = ppid; bestLen = len; remis = false } else if (len === bestLen) remis = true
  }
  return remis ? null : best
}

/** Pola typu „product” o tej samej nazwie to warianty jednego pola pod różnymi warunkami (np. „Okucia” osobno dla System=Basic
 *  i System=Premium, z innymi numerami produktów). Gdy numer produktu trafił tylko do ukrytego wariantu, a widoczny został pusty,
 *  przenosimy wybór do widocznego po nazwie produktu; gdy się nie da, zgłaszamy w `nieznane` (trafia do „sprawdź tylko to”). */
function przeniesDoWidocznychWariantow(dane: Dane, pid: number, lista: Pole[], out: Stan, nieznane: string[]) {
  const { widoczne } = stanIWidocznosc(dane, pid, out)
  const wgNazwy = new Map<string, Opcja[]>()
  for (const { o } of lista) {
    if (o.type !== 'product') continue
    const k = normNazwa(o.name)
    wgNazwy.set(k, [...(wgNazwy.get(k) ?? []), o])
  }
  for (const opcje of wgNazwy.values()) {
    if (opcje.length < 2) continue
    const puste = opcje.filter((o) => widoczne[String(o.id)] && !(String(o.id) in out))
    const ukryte = opcje.filter((o) => !widoczne[String(o.id)] && String(o.id) in out)
    if (!puste.length || !ukryte.length) continue
    const zrodloId = Number(out[String(ukryte[0].id)])
    const zrodlo = dane.produkt(zrodloId)?.nazwa ?? ''
    for (const o of puste) {
      const traf = najblizszyProdukt(dane, produktyOpcji(o), zrodlo)
      if (traf !== null) out[String(o.id)] = traf
      else nieznane.push(`${o.name}=${zrodloId}`)
    }
  }
}

/** Czytelny spis pól i wyborów (dla człowieka i dla promptu AI). */
export function opisOpcji(dane: Dane, pid: number): string {
  const p = dane.produkt(pid)!
  const lines = [`#${pid} ${p.nazwa} | cena bazowa ${p.cena} zł`]
  for (const { g, o } of pola(dane, pid)) {
    if (o.type === 'html' || o.type === 'wysiwyg') continue
    const cond = warunki(o) ? ' [warunkowe]' : ''
    const req = o.required === '1' ? '*' : ''
    let ch: string[]
    if (o.type === 'product') {
      ch = produktyOpcji(o).map((ppid) => `${ppid}: ${(dane.produkt(ppid)?.nazwa ?? '?').slice(0, 70)} (+${dane.produkt(ppid)?.cena ?? '?'} zł)`)
    } else {
      ch = (o.choices ?? []).map((c) => {
        const platne = (c.price_type === 'quantity_based' || c.price_type === 'flat_fee') && c.pricing !== null && c.pricing !== '' && c.pricing !== false
        return c.label + (platne ? ` (+${c.pricing} zł)` : '')
      })
    }
    lines.push(`  [${g.nazwa}] ${o.name}${req} (${o.type})${cond}: ${ch.join(' | ')}`)
  }
  return lines.join('\n')
}

/** {option_id: wartość} → pary (nazwa pola formularza Barn2, wartość). Tylko pola widoczne, jak w przeglądarce. */
export function polaFormularza(dane: Dane, pid: number, wybory: Stan): [string, string][] {
  const { stan, widoczne, lista } = stanIWidocznosc(dane, pid, wybory)
  const typy = new Map(lista.map(({ o }) => [String(o.id), o.type]))
  const out: [string, string][] = []
  for (const [oid, v] of Object.entries(stan)) {
    if (!(widoczne[oid] ?? true)) continue
    const vals = Array.isArray(v) ? v : [v]
    for (const x of vals) {
      if (typy.get(oid) === 'product') out.push([`wpo-option[option-${oid}][product_ids][${x}][]`, String(x)])
      else out.push([`wpo-option[option-${oid}][]`, String(x)])
    }
  }
  return out
}

/** Rozbicie ceny jako tekst (do maila i do zadania). Dostawa jest poza koszykiem sklepu, więc osobno.
 *  Kilka pozycji (różne drzwi) = kilka bloków z numerem pozycji, liczbą sztuk i ceną pozycji, potem suma. */
export function rozbicieTekst(wynik: Wynik | Wynik[], dostawa?: { opis: string; koszt: number }): string {
  const lista = Array.isArray(wynik) ? wynik : [wynik]
  const razem = zaokr(lista.reduce((s, w) => s + w.razem, 0))
  const blok = (w: Wynik) => {
    let b = `cena bazowa ${w.cena_bazowa.toFixed(2)} zł\n` + w.pozycje.map((p) => `+ ${p.kwota.toFixed(2)} zł ${p.opcja}: ${p.wybor}`).join('\n')
    if (w.ilosc > 1) b += `\n= ${w.razem_szt.toFixed(2)} zł za sztukę × ${w.ilosc} szt. = ${w.razem.toFixed(2)} zł`
    return b
  }
  let t: string
  if (lista.length === 1) t = blok(lista[0])
  else t = lista.map((w, i) => `POZYCJA ${i + 1}: ${w.nazwa}${w.ilosc > 1 ? ` × ${w.ilosc} szt.` : ''}\n${blok(w)}\n= pozycja ${w.razem.toFixed(2)} zł`).join('\n\n')
  t += `\nDRZWI RAZEM ${razem.toFixed(2)} zł brutto (23% VAT), tyle pokazuje koszyk sklepu`
  if (dostawa) {
    t += `\n+ ${dostawa.koszt.toFixed(2)} zł ${dostawa.opis} (poza koszykiem, wybierane przy zamówieniu)`
      + `\nRAZEM Z DOSTAWĄ ${(razem + dostawa.koszt).toFixed(2)} zł brutto`
  }
  return t
}
