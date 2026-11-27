// Link do koszyka podrzwi.pl ze skonfigurowanymi produktami, bez logowania. Port kalkulator/link_koszyka.py.
//  1. Dla KAŻDEJ pozycji oferty: POST „add-to-cart” na kartę produktu z polami Barn2 (wpo-option[...]) na TEJ SAMEJ sesji
//     (ciasteczka z pierwszej odpowiedzi idą do kolejnych) → WooCommerce dokłada pozycje do jednego koszyka gościa.
//     Kilka drzwi w ofercie (właściciel 2026-11-16: „wystarczy dodawać produkty po kolei do koszyka”) = kilka takich POST-ów.
//  2. GET /wp-json/wc/store/v1/cart z tym samym ciasteczkiem → nagłówek Cart-Token (JWT sesji).
//  3. Link: https://podrzwi.pl/koszyk/?session=<Cart-Token>
// Suma z koszyka jest porównywana z kalkulatorem („co do grosza”) przez wołającego.

import { Dane, polaFormularza, type Stan } from './kalkulator.ts'

const UA = 'Mozilla/5.0 (PoDrzwi oferty)'

export type PozycjaKoszyka = { pid: number; wybory: Stan; ilosc?: number }
export type WynikKoszyka = {
  link: string | null; wazny_do: Date | null; suma_koszyka: number
  pozycje: { id: number; nazwa: string; ilosc: number; kwota: number; dane: [string, string][] }[]
  bledy: string[]
}

class Ciasteczka {
  private m = new Map<string, string>()
  zbierz(r: Response) {
    const lista: string[] = typeof (r.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (r.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')!] : [])
    for (const sc of lista) {
      const para = sc.split(';')[0]
      const i = para.indexOf('=')
      if (i > 0) this.m.set(para.slice(0, i).trim(), para.slice(i + 1).trim())
    }
  }
  naglowek(): string { return [...this.m.entries()].map(([k, v]) => `${k}=${v}`).join('; ') }
}

async function zRedirectami(url: string, init: RequestInit, c: Ciasteczka): Promise<Response> {
  let r = await fetch(url, { ...init, redirect: 'manual', headers: { ...(init.headers as Record<string, string>), Cookie: c.naglowek() } })
  c.zbierz(r)
  for (let i = 0; i < 4 && [301, 302, 303, 307, 308].includes(r.status); i++) {
    const loc = r.headers.get('location')
    if (!loc) break
    await r.body?.cancel()
    url = new URL(loc, url).toString()
    r = await fetch(url, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': UA, Cookie: c.naglowek() } })
    c.zbierz(r)
  }
  return r
}

/** Koszyk z wszystkich pozycji (po kolei, jedna sesja). Jedna pozycja = dotychczasowe zachowanie. */
export async function utworzLink(dane: Dane, pozycje: PozycjaKoszyka[], sklep = 'https://podrzwi.pl'): Promise<WynikKoszyka> {
  if (!pozycje.length) throw new Error('Koszyk: brak pozycji do dodania')
  const c = new Ciasteczka()
  const bledy: string[] = []
  const wiele = pozycje.length > 1
  for (const [i, poz] of pozycje.entries()) {
    const p = dane.produkt(poz.pid)
    if (!p?.permalink) throw new Error(`Produkt #${poz.pid} nie ma adresu karty (permalink)`)
    const pola = polaFormularza(dane, poz.pid, poz.wybory)
    // Barn2 dodaje produkt dodatkowy z opcji (komplet okuć, osłonki) do koszyka ZAWSZE 1 szt., niezależnie od ilości drzwi
    // (scout Rivoli × 2, 17.11: 170 zł zamiast 340). Dotąd dosypywaliśmy brakujące sztuki dodatku jako osobny produkt, ale sklep go
    // odrzuca, gdy dodatek ma własne wymagane pola (27.11, Otto 49 × 2: komplet okuć #42844 wymaga „Wybór opcji wkładki”).
    // Teraz: drzwi z dodatkami dodajemy N razy po 1 szt. — sklep łączy drzwi w jedną linię, a dodatek dokłada do każdej sztuki.
    const ilosc = Math.max(1, Math.round(poz.ilosc ?? 1))
    const maDodatki = pola.some(([k]) => k.includes('[product_ids]'))
    const razy = ilosc > 1 && maDodatki ? ilosc : 1
    for (let k = 0; k < razy; k++) {
      const body = new URLSearchParams()
      body.append('add-to-cart', String(poz.pid))
      body.append('quantity', String(razy > 1 ? 1 : ilosc))
      for (const [kk, v] of pola) body.append(kk, v)
      const r1 = await zRedirectami(p.permalink, { method: 'POST', body, headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' } }, c)
      const html = await r1.text()
      if (!r1.ok) throw new Error(`Sklep odpowiedział ${r1.status} na dodanie do koszyka${wiele ? ` (pozycja ${i + 1})` : ''}`)
      if (html.includes('woocommerce-error')) {
        const frag = html.split('woocommerce-error', 2)[1]?.slice(0, 3000) ?? ''
        let n = 0
        for (const m of frag.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) { bledy.push((wiele ? `poz. ${i + 1}: ` : '') + czysty(m[1])); if (++n >= 5) break }
        break   // ten sam błąd przy każdej kolejnej sztuce
      }
    }
  }

  const r2 = await fetch(`${sklep}/wp-json/wc/store/v1/cart`, { headers: { 'User-Agent': UA, Cookie: c.naglowek() } })
  if (!r2.ok) throw new Error(`Store API koszyka: ${r2.status}`)
  const token = r2.headers.get('cart-token')
  const cart = await r2.json()

  const t = cart?.totals ?? {}
  const suma = (parseInt(t.total_items ?? '0', 10) + parseInt(t.total_items_tax ?? '0', 10)) / 100
  const wKoszyku = ((cart?.items ?? []) as Record<string, unknown>[]).map((i) => {
    const tt = (i.totals ?? {}) as Record<string, string>
    return {
      id: Number(i.id), nazwa: String(i.name ?? ''), ilosc: Number(i.quantity ?? 1),
      kwota: (parseInt(tt.line_total ?? '0', 10) + parseInt(tt.line_total_tax ?? '0', 10)) / 100,
      dane: ((i.item_data ?? []) as { key?: string; value?: string }[]).map((d) => [String(d.key ?? ''), czysty(String(d.value ?? ''))] as [string, string]),
    }
  })
  // sklep łączy identyczne pozycje w jedną linię, więc porównujemy sumę sztuk, nie liczbę linii; produkty dodatkowe z opcji
  // (komplet okuć, osłonki) są w koszyku osobnymi liniami – liczymy tylko linie z produktami oferty
  const pidy = new Set(pozycje.map((p) => p.pid))
  const sztukOczekiwane = pozycje.reduce((s, p) => s + Math.max(1, Math.round(p.ilosc ?? 1)), 0)
  const sztukWKoszyku = wKoszyku.filter((p) => pidy.has(p.id)).reduce((s, p) => s + p.ilosc, 0)
  if (sztukWKoszyku !== sztukOczekiwane) bledy.push(`w koszyku jest ${sztukWKoszyku} szt., oferta ma ${sztukOczekiwane} szt.`)
  let exp: Date | null = null
  if (token) {
    try {
      const cz = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      const payload = JSON.parse(atob(cz + '='.repeat((4 - cz.length % 4) % 4)))
      if (payload.exp) exp = new Date(payload.exp * 1000)
    } catch { /* bez daty ważności */ }
  }
  return { link: token ? `${sklep}/koszyk/?session=${token}` : null, wazny_do: exp, suma_koszyka: suma, pozycje: wKoszyku, bledy }
}

function czysty(v: string): string {
  return v.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}
