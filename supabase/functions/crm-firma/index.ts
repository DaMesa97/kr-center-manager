// crm-firma: dane firmy po NIP do karty klienta CRM (27.11.2026, Tymek: „jeżeli jest NIP, to niech się zapisuje
// i pobiera dane z GUS-u — prościej potem z zamówieniami i umowami”).
//
// Wejście (POST, JSON, JWT użytkownika z dostępem do CRM): { nip: string, zrodlo?: 'auto' | 'gus' | 'mf', test_gus?: boolean }
// Wyjście: { ok: true, firma: { nip, nazwa, adres, kod, miasto, ulica, regon, krs, status_vat, zrodlo, pobrano } }
//          albo HTTP 400/404 { error }.
//
// Źródła:
//  * GUS BIR1.1 (REGON) — gdy jest sekret GUS_BIR_KEY (bezpłatny klucz z api.stat.gov.pl); pełny rejestr, także firmy bez VAT.
//  * Wykaz podatników VAT MF (wl-api.mf.gov.pl, „biała lista”) — bez klucza; tylko podatnicy VAT (czynni / zwolnieni /
//    wykreśleni), limit zapytań dziennie na IP. Zapasowe źródło, gdy GUS nie ma klucza albo nie odpowiada.
//  * test_gus (tylko superadmin): środowisko testowe GUS z publicznym kluczem testowym — sprawdzenie ścieżki SOAP.
// Funkcja niczego nie zapisuje — kartę klienta zapisuje aplikacja (crm.leady: nip, firma_nazwa, firma_adres, regon, krs…).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const JSON_H = { 'Content-Type': 'application/json' }
const odp = (status: number, dane: unknown) => new Response(JSON.stringify(dane), { status, headers: JSON_H })

type Firma = {
  nip: string
  nazwa: string
  ulica: string | null
  kod: string | null
  miasto: string | null
  adres: string | null
  regon: string | null
  krs: string | null
  status_vat: string | null
  zrodlo: 'gus' | 'mf'
  pobrano: string
}

class BrakFirmy extends Error {}

export function nipPoprawny(nip: string): boolean {
  if (!/^\d{10}$/.test(nip)) return false
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7]
  const suma = w.reduce((s, x, i) => s + x * Number(nip[i]), 0)
  return suma % 11 === Number(nip[9])
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return odp(405, { error: 'Tylko POST' })
  const kto = await autoryzuj(req)
  if (!kto) return odp(401, { error: 'Brak uprawnień' })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return odp(400, { error: 'Oczekiwano JSON' }) }
  const nip = String(body.nip ?? '').replace(/^PL/i, '').replace(/\D/g, '')
  if (!nipPoprawny(nip)) return odp(400, { error: `NIP „${String(body.nip ?? '')}” jest niepoprawny (10 cyfr, suma kontrolna)` })
  const zrodlo = String(body.zrodlo ?? 'auto')
  const testGus = body.test_gus === true
  if (testGus && !kto.superadmin) return odp(403, { error: 'Test GUS tylko dla superadmina' })

  const klucz = Deno.env.get('GUS_BIR_KEY') ?? ''
  const bledy: string[] = []
  try {
    if (testGus || (zrodlo !== 'mf' && klucz)) {
      try {
        return odp(200, { ok: true, firma: await gus(nip, testGus ? null : klucz) })
      } catch (e) {
        if (e instanceof BrakFirmy && (testGus || zrodlo === 'gus')) return odp(404, { error: e.message })
        bledy.push('GUS: ' + (e instanceof Error ? e.message : String(e)))
        if (testGus || zrodlo === 'gus') throw new Error(bledy.join('; '))
      }
    }
    return odp(200, { ok: true, firma: await mf(nip), ...(bledy.length ? { uwagi: bledy } : {}) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('crm-firma:', msg)
    return odp(e instanceof BrakFirmy ? 404 : 502, { error: msg })
  }
})

// --------------------------------------------------------------------------------------------- MF (biała lista)
async function mf(nip: string): Promise<Firma> {
  const dzis = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' })
  const r = await fetch(`https://wl-api.mf.gov.pl/api/search/nip/${nip}?date=${dzis}`, { headers: { Accept: 'application/json' } })
  const j = await r.json().catch(() => null) as Record<string, unknown> | null
  if (!r.ok) {
    const kod = String((j as { code?: string } | null)?.code ?? r.status)
    const opis = String((j as { message?: string } | null)?.message ?? '')
    throw new Error(`wykaz VAT MF ${kod}${opis ? `: ${opis}` : ''}`)
  }
  const s = ((j?.result as Record<string, unknown> | undefined)?.subject ?? null) as Record<string, string | null> | null
  if (!s) throw new BrakFirmy(`Brak firmy o NIP ${nip} w wykazie podatników VAT (może nie być VAT-owcem — wtedy pomoże GUS)`)
  const adresPelny = (s.workingAddress || s.residenceAddress || '').trim()
  const { ulica, kod, miasto } = rozbijAdres(adresPelny)
  return {
    nip,
    nazwa: (s.name ?? '').trim(),
    ulica,
    kod,
    miasto,
    adres: adresPelny || null,
    regon: s.regon || null,
    krs: s.krs || null,
    status_vat: s.statusVat || null,
    zrodlo: 'mf',
    pobrano: new Date().toISOString(),
  }
}

/** „UL. RYBNICKA 12/3, 44-200 ŻORY” → ulica / kod / miasto */
function rozbijAdres(a: string): { ulica: string | null; kod: string | null; miasto: string | null } {
  const m = a.match(/^(.*?),?\s*(\d{2}-\d{3})\s+(.+)$/)
  if (!m) return { ulica: a || null, kod: null, miasto: null }
  return { ulica: m[1].replace(/,\s*$/, '').trim() || null, kod: m[2], miasto: m[3].trim() }
}

// --------------------------------------------------------------------------------------------- GUS BIR1.1 (SOAP)
const GUS_PROD = 'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc'
const GUS_TEST = 'https://wyszukiwarkaregontest.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc'
const GUS_TEST_KEY = 'abcde12345abcde12345'
const NS = 'http://CIS/BIR/PUBL/2014/07'

function koperta(url: string, akcja: string, cialo: string): string {
  return `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="${NS}" xmlns:dat="${NS}/DataContract">`
    + `<soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing"><wsa:To>${url}</wsa:To>`
    + `<wsa:Action>${NS}/IUslugaBIRzewnPubl/${akcja}</wsa:Action></soap:Header>`
    + `<soap:Body>${cialo}</soap:Body></soap:Envelope>`
}

async function soap(url: string, akcja: string, cialo: string, sid?: string): Promise<string> {
  const h: Record<string, string> = { 'Content-Type': 'application/soap+xml; charset=utf-8' }
  if (sid) h.sid = sid
  const r = await fetch(url, { method: 'POST', headers: h, body: koperta(url, akcja, cialo) })
  const t = await r.text()
  if (!r.ok) throw new Error(`GUS ${akcja} HTTP ${r.status}: ${t.slice(0, 200)}`)
  return t
}

function wynik(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  return m ? m[1] : ''
}

const odEncji = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#xD;/g, '').replace(/&amp;/g, '&')
const pole = (xml: string, tag: string) => {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  return m ? odEncji(m[1]).trim() : ''
}

async function gus(nip: string, klucz: string | null): Promise<Firma> {
  const url = klucz ? GUS_PROD : GUS_TEST
  const sid = wynik(await soap(url, 'Zaloguj', `<ns:Zaloguj><ns:pKluczUzytkownika>${klucz ?? GUS_TEST_KEY}</ns:pKluczUzytkownika></ns:Zaloguj>`), 'ZalogujResult').trim()
  if (!sid) throw new Error('logowanie do GUS nieudane (sprawdź klucz GUS_BIR_KEY)')
  try {
    const odpXml = await soap(url, 'DaneSzukajPodmioty',
      `<ns:DaneSzukajPodmioty><ns:pParametryWyszukiwania><dat:Nip>${nip}</dat:Nip></ns:pParametryWyszukiwania></ns:DaneSzukajPodmioty>`, sid)
    const dane = odEncji(wynik(odpXml, 'DaneSzukajPodmiotyResult'))
    const rek = dane.match(/<dane>([\s\S]*?)<\/dane>/)?.[1] ?? ''
    if (!rek || pole(rek, 'ErrorCode')) {
      const opis = pole(rek, 'ErrorMessagePl') || 'nie znaleziono podmiotu'
      throw new BrakFirmy(`GUS: brak firmy o NIP ${nip} (${opis})`)
    }
    const ulicaNr = [pole(rek, 'Ulica'), [pole(rek, 'NrNieruchomosci'), pole(rek, 'NrLokalu')].filter(Boolean).join('/')].filter(Boolean).join(' ')
    const miasto = pole(rek, 'Miejscowosc') || null
    const kodRaw = pole(rek, 'KodPocztowy')
    const kod = /^\d{5}$/.test(kodRaw) ? `${kodRaw.slice(0, 2)}-${kodRaw.slice(2)}` : (kodRaw || null)
    const ulica = ulicaNr || null
    return {
      nip,
      nazwa: pole(rek, 'Nazwa'),
      ulica,
      kod,
      miasto,
      adres: [ulica ?? miasto, [kod, miasto].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null,
      regon: pole(rek, 'Regon') || null,
      krs: null,
      status_vat: null,
      zrodlo: 'gus',
      pobrano: new Date().toISOString(),
    }
  } finally {
    await soap(url, 'Wyloguj', `<ns:Wyloguj><ns:pIdentyfikatorSesji>${sid}</ns:pIdentyfikatorSesji></ns:Wyloguj>`).catch(() => undefined)
  }
}

// --------------------------------------------------------------------------------------------- autoryzacja
let kluczWewnetrzny: string | null = null

async function autoryzuj(req: Request): Promise<{ userId: string | null; superadmin: boolean } | null> {
  // system (baza / cron / test z pg_net): x-internal-key = crm.klucz_wewnetrzny()
  const wew = req.headers.get('x-internal-key')
  if (wew) {
    if (!kluczWewnetrzny) {
      const db = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { db: { schema: 'crm' } })
      const { data } = await db.rpc('klucz_wewnetrzny')
      kluczWewnetrzny = typeof data === 'string' ? data : null
    }
    return kluczWewnetrzny && wew === kluczWewnetrzny ? { userId: null, superadmin: true } : null
  }
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const jakoUzytkownik = createClient(SUPABASE_URL, anon, { global: { headers: { Authorization: auth } } })
  const { data: u } = await jakoUzytkownik.auth.getUser(auth.slice(7))
  if (!u?.user) return null
  const { data: ma } = await jakoUzytkownik.rpc('current_user_has_crm')
  if (ma !== true) return null
  const { data: su } = await jakoUzytkownik.rpc('current_user_is_superadmin')
  return { userId: u.user.id, superadmin: su === true }
}
