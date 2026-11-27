// crm-oferta: liczy oferty w CRM Po Drzwi. Port oferta/prototyp.py (dobór, cena, koszyk, mail, poprawka).
//
// Wejścia (POST JSON):
//   { akcja: 'przelicz', oferta_id }      – jedna oferta w statusie 'przelicz' (woła ją trigger crm.oferty przez pg_net,
//                                            a także frontend lub człowiek; podwójne wywołanie jest nieszkodliwe: blokada liczenie_od)
//   { akcja: 'przelicz_wszystkie' }       – wszystkie oferty w statusie 'przelicz' (siatka bezpieczeństwa, np. z crona)
//   { akcja: 'import_produkty', produkty: [...] } / { akcja: 'import_grupy', grupy: [...] } – cennik z podrzwi.pl (kalkulator/wgraj_cennik.py)
//
// Autoryzacja (jedna z): nagłówek x-internal-key = klucz z vault (trigger), x-ingest-key = sekret CRM_INGEST_KEY,
//   albo Authorization: Bearer <JWT użytkownika> z dostępem do CRM (rpc current_user_has_crm).
//
// Dwa tryby liczenia:
//   * świeża oferta (poprawka pusta): kandydaci (kod) → dobór produktu i opcji (AI) → cena (kod) → koszyk (sklep) → mail (AI);
//     wynik zapisany w tej samej ofercie, status 'do_sprawdzenia';
//   * poprawka handlowca (poprawka = tekst): AI mapuje tekst na zmiany pól → cena → koszyk → mail (ton z poprzedniego);
//     powstaje NOWA wersja (poprzednia_id), stara schodzi do 'robocza'.
// Każdy błąd: oferta wraca do 'do_sprawdzenia' z wpisem „BŁĄD systemu” w sprawdz + zdarzenie 'blad'. Nic nie znika po cichu.
// Oferta z maila klienta (mail_id): zamiast transkrypcji model dostaje treść maila i wie, że odpowiada mailem.
// Oferta z notatki handlowca (notatka, bez rozmowy i maila; klient z salonu): model dostaje notatkę i wie, że to pierwszy mail.
// Ta funkcja liczy TYLKO oferty rodzaj 'sklep'; oferty 'oficjalna' (PDF z montażem) liczy crm-oferta-pdf.
// Kilka drzwi w jednej ofercie (2026-11-16): AI zwraca `pozycje` (produkt + wybory + ilość), kod liczy każdą osobno i sumuje,
// koszyk dostaje produkty po kolei na jednej sesji. `oferty.pozycje` = lista pozycji; `product_id`/`produkt`/`wybory` = pierwsza
// pozycja (zgodność z aplikacją), `cena_bazowa` = suma cen bazowych, `rozbicie` = dopłaty wszystkich pozycji (× ilość), `cena_razem` = suma.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { Dane, policz, wybierzPoNazwach, opisOpcji, rozbicieTekst, bazaNazwy, polaZWyborem, type Produkt, type Grupa, type Wynik, type Pozycja, type Stan } from './kalkulator.ts'
import { utworzLink } from './koszyk.ts'
import { claudeJson, type Zuzycie } from './ai.ts'
import { stylHandlowca, stylDoZapisu } from './styl.ts'
import { SCHEMA_DOBOR, SCHEMA_MAIL, SCHEMA_POPRAWKA, promptDoboru, promptMaila, promptPoprawki, kandydaci, opisDostawy,
  type Analiza, type Dobor, type Mail, type Poprawka, type Dostawa, type Kanal, promptPytan, SCHEMA_PYTANIA, SCHEMA_NAPRAWA, promptNaprawy, type Naprawa,
  celeWgWzoru, wzorProduktu } from './prompty.ts'

const JSON_H = { 'Content-Type': 'application/json' }
const odp = (status: number, dane: unknown) => new Response(JSON.stringify(dane), { status, headers: JSON_H })
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const BEZ_LINKU = Deno.env.get('CRM_BEZ_LINKU') === '1'
// Dostawa nie jest w koszyku sklepu: kurier 300 zł (stan 2026-11-14) albo odbiór osobisty 0 zł, wybierane przy zamówieniu.
const KOSZT_KURIERA = Number(Deno.env.get('CRM_KOSZT_KURIERA') ?? '300')
let kluczWewnetrzny: string | null = null

type Oferta = {
  id: string; lead_id: string | null; rozmowa_id: string | null; mail_id: string | null; wersja: number; poprzednia_id: string | null; status: string
  product_id: number | null; produkt: string | null; wybory: Record<string, string | number>; zalozenia: string[]; sprawdz: string[]
  analiza: Analiza | null; dobor: Dobor | null; cena_razem: number | null; mail_do: string | null; mail_temat: string | null; mail_tresc: string | null
  poprawka: string | null; handlowiec: string | null; koszt_ai_usd: number | null; dostawa: 'kurier' | 'odbior_osobisty' | null
  notatka: string | null; pozycje: PozycjaOferty[] | null
}
/** Pozycja oferty sklepowej zapisana w `oferty.pozycje` (oferty 'oficjalna' trzymają tam inny kształt, rozróżnia `rodzaj`). */
type PozycjaOferty = {
  lp: number; product_id: number; produkt: string; ilosc: number; wybory: Record<string, string | number>; opis: string
  cena_bazowa: number; cena_szt: number; cena_razem: number; rozbicie: Pozycja[]
}
/** Pozycja w trakcie liczenia. */
type Poz = { product_id: number; ilosc: number; wybory: Record<string, string | number>; opis: string }
const zaokr = (x: number) => Math.round(x * 100) / 100
const MAKS_POZYCJI = 12

/** Rodzaj dostawy: z poprawki handlowca, z poprzedniej wersji oferty albo z analizy rozmowy; nieustalone = kurier + wpis do „sprawdź”. */
function ustalDostawe(zRozmowy: unknown, zOferty: Oferta['dostawa'], zPoprawki: string | undefined): Dostawa {
  const r = (zPoprawki && zPoprawki !== '' ? zPoprawki : null) ?? zOferty ?? (zRozmowy === 'kurier' || zRozmowy === 'odbior_osobisty' ? zRozmowy : null)
  if (r === 'odbior_osobisty') return { rodzaj: 'odbior_osobisty', koszt: 0, zalozona: false }
  return { rodzaj: 'kurier', koszt: KOSZT_KURIERA, zalozona: r !== 'kurier' }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ingest-key' } })
  if (req.method !== 'POST') return odp(405, { error: 'Tylko POST' })
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: 'crm' } })

  const kto = await autoryzuj(req, db)
  if (!kto) return odp(401, { error: 'Brak uprawnień' })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return odp(400, { error: 'Oczekiwano JSON' }) }
  const akcja = String(body.akcja ?? '')

  try {
    if (akcja === 'import_produkty' || akcja === 'import_grupy') {
      if (kto === 'uzytkownik') return odp(403, { error: 'Import cennika tylko kluczem systemowym' })
      return odp(200, await importuj(db, akcja, body))
    }
    if (akcja === 'przelicz') {
      const id = String(body.oferta_id ?? '')
      if (!id) return odp(400, { error: 'Brak oferta_id' })
      return odp(200, await przelicz(db, id, kto === 'uzytkownik' ? (body.user_id as string | undefined) ?? null : null))
    }
    if (akcja === 'przelicz_wszystkie') {
      const { data } = await db.from('oferty').select('id').eq('status', 'przelicz').eq('rodzaj', 'sklep').order('created_at').limit(10)
      const wyniki = []
      for (const o of data ?? []) wyniki.push(await przelicz(db, o.id, null))
      return odp(200, { ok: true, policzono: wyniki.length, wyniki })
    }
    return odp(400, { error: 'Nieznana akcja' })
  } catch (e) {
    return odp(500, { error: e instanceof Error ? e.message : String(e) })
  }
})

// --------------------------------------------------------------------------------------------
async function autoryzuj(req: Request, db: SupabaseClient): Promise<'system' | 'uzytkownik' | null> {
  const ingest = Deno.env.get('CRM_INGEST_KEY')
  if (ingest && req.headers.get('x-ingest-key') === ingest) return 'system'
  const wew = req.headers.get('x-internal-key')
  if (wew) {
    if (!kluczWewnetrzny) {
      const { data } = await db.rpc('klucz_wewnetrzny')
      kluczWewnetrzny = typeof data === 'string' ? data : null
    }
    if (kluczWewnetrzny && wew === kluczWewnetrzny) return 'system'
  }
  const auth = req.headers.get('Authorization')
  if (auth?.startsWith('Bearer ')) {
    const jwt = auth.slice(7)
    const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const jakoUzytkownik = createClient(SUPABASE_URL, anon, { global: { headers: { Authorization: auth } } })
    const { data: u } = await jakoUzytkownik.auth.getUser(jwt)
    if (!u?.user) return null
    const { data: ma } = await jakoUzytkownik.rpc('current_user_has_crm')
    return ma === true ? 'uzytkownik' : null
  }
  return null
}

// --------------------------------------------------------------------------------------------
async function importuj(db: SupabaseClient, akcja: string, body: Record<string, unknown>) {
  const tabela = akcja === 'import_produkty' ? 'produkty' : 'grupy_opcji'
  const wiersze = (body[akcja === 'import_produkty' ? 'produkty' : 'grupy'] ?? []) as Record<string, unknown>[]
  if (!Array.isArray(wiersze) || !wiersze.length) return { ok: true, zapisano: 0 }
  const teraz = new Date().toISOString()
  const dane = wiersze.map((w) => ({ ...w, zaktualizowano: teraz }))
  const { error } = await db.from(tabela).upsert(dane, { onConflict: 'id' })
  if (error) throw new Error(`Import ${tabela}: ${error.message}`)
  if (body.usun_starsze_niz && typeof body.usun_starsze_niz === 'string') {
    await db.from(tabela).delete().lt('zaktualizowano', body.usun_starsze_niz)
  }
  return { ok: true, zapisano: dane.length }
}

// --------------------------------------------------------------------------------------------
async function przelicz(db: SupabaseClient, ofertaId: string, userId: string | null) {
  // blokada: tylko oferta sklepowa w statusie 'przelicz', nieliczona w ciągu ostatnich 5 minut
  const granica = new Date(Date.now() - 5 * 60_000).toISOString()
  const { data: zajete, error: eZ } = await db.from('oferty').update({ liczenie_od: new Date().toISOString() })
    .eq('id', ofertaId).eq('status', 'przelicz').eq('rodzaj', 'sklep').or(`liczenie_od.is.null,liczenie_od.lt.${granica}`).select('*')
  if (eZ) throw new Error('Blokada oferty: ' + eZ.message)
  if (!zajete?.length) return { ok: true, oferta_id: ofertaId, pominieto: 'oferta nie jest sklepowa w statusie przelicz albo właśnie się liczy (oficjalne liczy crm-oferta-pdf)' }
  const o = zajete[0] as Oferta
  const zuzycie: Zuzycie[] = []
  const t0 = Date.now()
  try {
    const wynik = await policzOferte(db, o, zuzycie, userId)
    return { ok: true, oferta_id: wynik.oferta_id, wersja: wynik.wersja, cena: wynik.cena, koszyk_zgodny: wynik.koszyk_zgodny, koszt_usd: wynik.koszt_usd, czas_s: Math.round((Date.now() - t0) / 1000) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const sprawdz = [`BŁĄD systemu: ${msg.slice(0, 300)}. Oferta nie została policzona; spróbuj „Przelicz” jeszcze raz albo zgłoś.`, ...(o.sprawdz ?? [])]
    await db.from('oferty').update({ status: 'do_sprawdzenia', liczenie_od: null, uwagi: msg.slice(0, 2000), sprawdz, koszt_ai_usd: sumaKosztu(zuzycie) || o.koszt_ai_usd }).eq('id', o.id)
    await zdarzenie(db, { lead_id: o.lead_id, oferta_id: o.id, typ: 'blad', opis: msg.slice(0, 500), kto: userId })
    return { ok: false, oferta_id: o.id, blad: msg }
  }
}

/** 24.11: oferta bez dobranego produktu — aplikacja po tym tekście (i po `pytania`) pokazuje formularz pytań zamiast spinnera */
const BRAK_DOBORU_TEKST = 'System nie dobrał produktu — odpowiedz na pytania poniżej (albo dopytaj klienta), a oferta policzy się od nowa.'
const PYTANIA_OGOLNE = [
  'Jakie to drzwi: wejściowe do mieszkania (z klatki), zewnętrzne do domu czy wewnętrzne?',
  'Jaka linia / system (np. Titan, Bastion, Alu extra, Wood extra, Steel extra, kolekcja drzwi wewnętrznych)?',
  'Jaki wzór / model i kolor?',
  'Rozmiar i kierunek otwierania?',
]

async function policzOferte(db: SupabaseClient, o: Oferta, zuzycie: Zuzycie[], userId: string | null) {
  const { data: lead } = o.lead_id ? await db.from('leady').select('id, telefon, email, nazwa, miejscowosc, zrodlo').eq('id', o.lead_id).maybeSingle() : { data: null }
  const { data: rozmowa } = o.rozmowa_id ? await db.from('rozmowy').select('transkrypcja, analiza').eq('id', o.rozmowa_id).maybeSingle() : { data: null }
  // oferta zlecona z maila klienta: zamiast transkrypcji rozmowy model dostaje treść maila
  const { data: mailZrodlowy } = o.mail_id ? await db.from('maile').select('od_nazwa, od_adres, temat, tresc, analiza').eq('id', o.mail_id).maybeSingle() : { data: null }
  const analiza: Analiza | null = o.analiza ?? (rozmowa?.analiza as Analiza | null) ?? (mailZrodlowy?.analiza as Analiza | null) ?? null
  if (!analiza) throw new Error('Oferta nie ma analizy rozmowy (ani w ofercie, ani w rozmowie, ani w mailu)')
  const notatka = (o.notatka ?? '').trim()
  const kanal: Kanal = rozmowa?.transkrypcja ? 'telefon' : mailZrodlowy ? 'mail' : notatka ? (lead?.zrodlo === 'wizyta' ? 'wizyta' : 'notatka') : 'telefon'
  const transkrypcja: string = rozmowa?.transkrypcja
    ?? (mailZrodlowy ? `(To nie była rozmowa telefoniczna. Klient napisał mail, odpowiadasz na niego mailem.)
Od: ${mailZrodlowy.od_nazwa ?? ''} <${mailZrodlowy.od_adres ?? ''}>
Temat: ${mailZrodlowy.temat ?? ''}

${(mailZrodlowy.tresc ?? '').slice(0, 12_000)}`
    : notatka ? `(To nie była rozmowa telefoniczna przez system. ${kanal === 'wizyta' ? 'Klient przyszedł do salonu Po Drzwi i rozmawiał z handlowcem osobiście.' : 'Handlowiec rozmawiał z klientem poza systemem.'} Poniżej jest skrótowa NOTATKA HANDLOWCA z tej rozmowy, nie wypowiedzi klienta. Mail ma nawiązać do tej rozmowy i jest pierwszą pisemną wiadomością do klienta.)

Notatka handlowca:
${notatka.slice(0, 6000)}`
    : '(brak transkrypcji)')
  const poprawkaTekst = (o.poprawka ?? '').trim()
  const maPozycje = Array.isArray(o.pozycje) && o.pozycje.some((p) => p && typeof p.product_id === 'number')
  const trybPoprawki = poprawkaTekst.length > 0 && (maPozycje || (!!o.product_id && Object.keys(o.wybory ?? {}).length > 0))

  // produkty do prefiltra: opublikowane drzwi
  const { data: listaDb, error: eL } = await db.from('produkty').select('id, nazwa, cena, kategorie_nazwy').eq('status', 'publish').ilike('nazwa', '%drzwi%').limit(5000)
  if (eL) throw new Error('Cennik: ' + eL.message)
  // kategoria „Konfigurator” (168 produktów, od 14.11) to osobny konfigurator sklepu bez opcji Barn2 – nie da się ich policzyć ani dodać do koszyka
  const lista = ((listaDb ?? []) as { id: number; nazwa: string; cena: number | null; kategorie_nazwy: string[] | null }[]).filter((p) => !(p.kategorie_nazwy ?? []).includes('Konfigurator'))
  if (!lista.length) throw new Error('Cennik jest pusty: uruchom import (kalkulator/wgraj_cennik.py)')
  // 27.11: w poprawce kandydaci szukają też po jej treści („w pozycji 1 zabrakło pochwytu w Otto 49”) — dotąd lista była tylko
  // z rozmowy, więc AI pisało „na liście nie ma Otto 49 z pochwytem” i poprawka nic nie zmieniała
  const kand = kandydaci(lista, trybPoprawki ? { ...analiza, poprawka_handlowca: [analiza.poprawka_handlowca, poprawkaTekst].filter(Boolean).join('\n') } : analiza)
  const zasady = await zaladujZasady(db)

  let pozycje: Poz[] = []
  let dobor!: Dobor
  // 27.11: „Zrób jeszcze raz” w poprawce = dobór od zera (dotąd szedł jako poprawka i przenosił zepsute wybory dalej)
  let odNowa = false
  let analizaDoboru: Analiza = analiza
  let poprawkaWynik: Poprawka | null = null
  let mailWzor: Mail | null = null
  let uwagiDoMaila = ''
  let niezrozumiane: string[] = []
  const kandIds = new Set(kand.map((k) => k.id))
  // 27.11: lista → słownik BEZ gubienia powtórzeń nazwy pola (Libre 31: dwa pola „Sposób otwierania”; drugie nadpisywało pierwsze
  // i sklep odrzucał drzwi „Sposób otwierania jest wymaganym polem”) → „Sposób otwierania”, „Sposób otwierania #2”
  const zWyborow = (w: { pole: string; wybor: string }[] | undefined): Record<string, string | number> => {
    const out: Record<string, string | number> = {}
    for (const x of w ?? []) {
      const baza = bazaNazwy(String(x.pole ?? ''))
      if (!baza) continue
      let k = baza
      for (let n = 2; k in out; n++) k = `${baza} #${n}`
      out[k] = x.wybor
    }
    return out
  }
  let daneP: Dane | null = null
  // produkty zastąpione poprawką — założenia doboru o nich („#31052 nie ma pól pochwytu”) są już nieaktualne
  const podmienione = new Set<number>()
  // 27.11: produkt z poprawki trafia do pozycji z tym samym wzorem (celeWgWzoru); wtedy zmiany pól idą do tych pozycji, nie do wskazanej przez model
  const nazwyProduktow = new Map(lista.map((p) => [p.id, p.nazwa]))
  const nazwaPid = (pid: number) => nazwyProduktow.get(pid) ?? ''
  let celeWymuszone: Poz[] | null = null
  const uwagiPoprawki: string[] = []
  const sprawdzKandydata = (pid: number, co: string) => { if (!kandIds.has(pid)) throw new Error(`AI ${co} produkt spoza kandydatów: #${pid}`) }

  if (trybPoprawki) {
    pozycje = pozycjeZOferty(o)
    dobor = o.dobor ?? { product_id: pozycje[0].product_id, uzasadnienie: '', wybory: [], zalozenia: o.zalozenia ?? [], domyslne: [], pewnosc: 'srednia' }
    for (let runda = 0; runda < 2; runda++) {   // druga runda tylko, gdy poprawka zmienia produkt (model widzi wtedy pola nowego produktu)
      const pids = [...new Set(pozycje.map((p) => p.product_id))]
      const dane = await zaladujDane(db, pids)
      daneP = dane
      const pr = promptPoprawki(pozycje, kand, poprawkaTekst, pids.map((pid) => opisOpcji(dane, pid)).join('\n\n'))
      const r = await claudeJson<Poprawka>(pr.system, pr.user, SCHEMA_POPRAWKA, 'high', 'poprawka')
      zuzycie.push(r.zuzycie)
      poprawkaWynik = r.dane
      const nowy = r.dane.product_id
      let cele = celePoprawki(pozycje, r.dane.pozycja)
      if (nowy) {
        const wgWzoru = celeWgWzoru(pozycje, cele, nowy, nazwaPid, poprawkaTekst)
        if (wgWzoru !== cele) {
          const nr = (xs: Poz[]) => xs.map((p) => pozycje.indexOf(p) + 1).join(', ')
          uwagiPoprawki.push(`Poprawka wskazała produkt #${nowy} (${wzorProduktu(nazwaPid(nowy)) ?? ''}) — przypięto go do pozycji ${nr(wgWzoru)} (ten sam wzór), nie do pozycji ${nr(cele)}.`)
          cele = wgWzoru
          celeWymuszone = wgWzoru
        }
      }
      if (nowy && cele.some((p) => p.product_id !== nowy)) {
        sprawdzKandydata(nowy, 'wskazało')
        for (const p of cele) { if (p.product_id !== nowy) podmienione.add(p.product_id); p.product_id = nowy }
        continue
      }
      break
    }
    const pw = poprawkaWynik!
    mailWzor = o.mail_temat && o.mail_tresc ? { temat: o.mail_temat, tresc: o.mail_tresc } : null
    uwagiDoMaila = pw.do_maila ?? ''
    if (pw.od_nowa || /\b(od nowa|jeszcze raz|zr[oó]b (to )?(jeszcze|ponownie)|przelicz (wszystko|ca[łl]o[śs][ćc]))/i.test(poprawkaTekst) && !pw.zmiany.length && !pw.usun.length && !(pw.nowe_pozycje ?? []).length) {
      odNowa = true
      analizaDoboru = { ...analiza, poprawka_handlowca: [analiza.poprawka_handlowca, poprawkaTekst].filter(Boolean).join('\n') }
    }
  }
  if (trybPoprawki && !odNowa) {
    const pw = poprawkaWynik!
    if (celeWymuszone) {
      // przekierowana poprawka (model celował w pozycję z innym wzorem): zmiany pól mogły być ułożone pod tamtą pozycję
      // (kolor, rozmiar, kierunek Libre) — tu tylko DOPISUJEMY brakujące pola, nic nie nadpisujemy, nie usuwamy i nie zmieniamy ilości
      const pominiete = new Set<string>()
      for (const p of celeWymuszone) {
        for (const z of pw.zmiany) {
          const baza = bazaNazwy(z.pole).toLowerCase()
          if (Object.keys(p.wybory).some((k) => bazaNazwy(k).toLowerCase() === baza)) { if (String(p.wybory[Object.keys(p.wybory).find((k) => bazaNazwy(k).toLowerCase() === baza)!]) !== String(z.wybor)) pominiete.add(`${z.pole}: ${z.wybor}`); continue }
          ustawWybor(p.wybory, z.pole, z.wybor, daneP, p.product_id)
        }
      }
      if (pominiete.size) uwagiPoprawki.push(`Nie nadpisano pól tej pozycji (zmiany były ułożone pod inną pozycję): ${[...pominiete].join('; ')}.`)
    } else {
      for (const p of celePoprawki(pozycje, pw.pozycja)) {
        for (const z of pw.zmiany) ustawWybor(p.wybory, z.pole, z.wybor, daneP, p.product_id)
        for (const u of pw.usun) for (const k of Object.keys(p.wybory)) if (k === u || (!/#\d+\s*$/.test(u) && bazaNazwy(k).toLowerCase() === u.trim().toLowerCase())) delete p.wybory[k]
        if ((pw.ilosc ?? 0) > 0) p.ilosc = Math.round(pw.ilosc!)
      }
    }
    for (const n of pw.nowe_pozycje ?? []) {
      sprawdzKandydata(n.product_id, 'dopisało')
      pozycje.push({ product_id: n.product_id, ilosc: Math.max(1, Math.round(n.ilosc || 1)), wybory: zWyborow(n.wybory), opis: n.opis ?? '' })
    }
    if (pw.usun_pozycje?.length) {
      const usun = new Set(pw.usun_pozycje)
      pozycje = pozycje.filter((_, i) => !usun.has(i + 1))
      if (!pozycje.length) throw new Error('Poprawka usunęła wszystkie pozycje oferty; zostaw przynajmniej jedne drzwi')
    }
    if (pozycje.length > MAKS_POZYCJI) throw new Error(`Za dużo pozycji w ofercie (${pozycje.length}, maks. ${MAKS_POZYCJI})`)
    const zmienione = new Set([...pw.zmiany.map((z) => z.pole.toLowerCase()), ...pw.usun.map((u) => u.toLowerCase())])
    // 27.11 (v14 FHU KATO): po podmianie Otto 49 #31052 → #65452 w „sprawdź” zostawało „pochwytu nie da się skonfigurować w #31052”
    // (założenia doboru wędrują z wersji na wersję) — znikają założenia o produktach drzwi, których w ofercie już nie ma
    const obecnePid = new Set(pozycje.map((p) => p.product_id))
    const dawnePid = [o.product_id, dobor.product_id, ...(o.pozycje ?? []).map((p) => p.product_id), ...(dobor.pozycje ?? []).map((p) => p.product_id), ...podmienione]
      .filter((x): x is number => typeof x === 'number' && !obecnePid.has(x))
    const zalozenia = (dobor.zalozenia ?? []).filter((a) => ![...zmienione].some((p) => a.toLowerCase().includes(p)) && !dawnePid.some((pid) => new RegExp(`#${pid}\\b`).test(a)))
    dobor = { ...dobor, zalozenia, uzasadnienie: `po poprawce handlowca: ${pw.streszczenie}` }
    niezrozumiane = pw.niezrozumiane ?? []
  }
  if (!trybPoprawki || odNowa) {
    if (!kand.length) {
      // nie ma czego liczyć: 24.11 (Tymek) — system nie zostawia handlowca z „nie dobrano”, tylko pyta o to, co pozwoli dobrać;
      // odpowiedzi wracają w analiza.odpowiedzi_handlowca i oferta liczy się od nowa
      let pytania: string[] = []
      try {
        const pp = promptPytan(analizaDoboru)
        const rp = await claudeJson<{ pytania: string[] }>(pp.system, pp.user, SCHEMA_PYTANIA, 'medium', 'pytania')
        zuzycie.push(rp.zuzycie)
        pytania = (rp.dane.pytania ?? []).map((p) => String(p).trim()).filter(Boolean).slice(0, 5)
      } catch (e) {
        console.error('pytania (brak kandydatów):', e instanceof Error ? e.message : String(e))
      }
      if (!pytania.length) pytania = PYTANIA_OGOLNE
      const koszt = sumaKosztu(zuzycie)
      await db.from('oferty').update({ status: 'do_sprawdzenia', liczenie_od: null, uwagi: 'Brak kandydatów w cenniku dla danych z rozmowy', pytania, koszt_ai_usd: koszt || o.koszt_ai_usd,
        sprawdz: [BRAK_DOBORU_TEKST, 'W danych z rozmowy nie ma linii ani modelu drzwi, po których system szuka w sklepie.'] }).eq('id', o.id)
      if (o.lead_id) await db.from('leady').update({ nastepna_akcja: 'przygotuj_oferte', akcja_opis: 'Odpowiedz na pytania systemu przy ofercie (albo dopytaj klienta) — system nie dobrał produktu.' }).eq('id', o.lead_id)
      await zdarzenie(db, { lead_id: o.lead_id, oferta_id: o.id, typ: 'brak_kandydatow', opis: 'Brak kandydatów w cenniku — system zadał pytania: ' + pytania.join(' | ').slice(0, 400), kto: userId, dane: { pytania, koszt_usd: koszt } })
      return { oferta_id: o.id, wersja: o.wersja, cena: null, koszyk_zgodny: null, koszt_usd: Number(koszt.toFixed(4)) }
    }
    const top3 = kand.slice(0, 3).map((k) => k.id)
    const dane3 = await zaladujDane(db, top3)
    const spisy = top3.map((id) => opisOpcji(dane3, id)).join('\n\n')
    const pr = promptDoboru(analizaDoboru, kand, spisy, zasady.dobor)
    const r = await claudeJson<Dobor>(pr.system, pr.user, SCHEMA_DOBOR, 'high', 'dobor')
    zuzycie.push(r.zuzycie)
    dobor = r.dane
    if (dobor.pasuje === false) {
      // zgł. #148/#149 (16.11): dotąd model MUSIAŁ wybrać kandydata i dwóm różnym klientom (mieszkanie na starej ościeżnicy, drzwi EI) wychodził ten sam „zastępczy” Otto 01
      const powod = (dobor.uzasadnienie || 'żaden produkt ze sklepu nie odpowiada potrzebie klienta').slice(0, 600)
      // 24.11 (Tymek): zamiast „nie dobrano i koniec” — pytania, po których odpowiedzi oferta liczy się od nowa
      const pytania = (dobor.pytania ?? []).map((p) => String(p).trim()).filter(Boolean).slice(0, 5)
      await db.from('oferty').update({ status: 'do_sprawdzenia', liczenie_od: null, product_id: null, produkt: null, cena_razem: null,
        uwagi: 'System nie dobrał produktu: ' + powod, pytania: pytania.length ? pytania : PYTANIA_OGOLNE, koszt_ai_usd: sumaKosztu(zuzycie),
        sprawdz: [BRAK_DOBORU_TEKST, powod] }).eq('id', o.id)
      if (o.lead_id) await db.from('leady').update({ nastepna_akcja: 'przygotuj_oferte', akcja_opis: ('Odpowiedz na pytania systemu przy ofercie (albo dopytaj klienta) — system nie dobrał produktu: ' + powod).slice(0, 500) }).eq('id', o.lead_id)
      await zdarzenie(db, { lead_id: o.lead_id, oferta_id: o.id, typ: 'brak_kandydatow', opis: ('Żaden produkt nie pasuje: ' + powod).slice(0, 500), kto: userId, dane: { pytania } })
      return { oferta_id: o.id, wersja: o.wersja, cena: null, koszyk_zgodny: null, koszt_usd: Number(sumaKosztu(zuzycie).toFixed(4)) }
    }
    // 27.11 (Otto 49 / Libre 31): model wybrał produkt spoza 3 najlepszych, którego spisu pól nie widział, i zgadywał nazwy pól
    // („Zestaw okuć” z Libre zamiast „Okucia” z Otto → drzwi bez okuć). Druga runda ze spisami produktów, które naprawdę wybrał.
    const wybrane = [...new Set([dobor.product_id, ...(dobor.pozycje ?? []).map((p) => p.product_id)].filter((x) => typeof x === 'number'))]
    if (wybrane.some((id) => !top3.includes(id)) && wybrane.every((id) => kandIds.has(id)) && wybrane.length <= MAKS_POZYCJI) {
      const daneW = await zaladujDane(db, wybrane)
      const pr2 = promptDoboru(analizaDoboru, kand, wybrane.map((id) => opisOpcji(daneW, id)).join('\n\n'), zasady.dobor)
      const r2 = await claudeJson<Dobor>(pr2.system, pr2.user + '\n\nDRUGA RUNDA: powyższe spisy pól dotyczą produktów, które wybrałeś w pierwszej rundzie '
        + '(wtedy części z nich nie widziałeś). Podaj wybory każdej pozycji DOKŁADNIE wg spisu jej produktu — nazwy pól różnią się między produktami.',
        SCHEMA_DOBOR, 'high', 'dobor2')
      zuzycie.push(r2.zuzycie)
      if (r2.dane.pasuje !== false) dobor = r2.dane
    }
    sprawdzKandydata(dobor.product_id, 'wybrało')
    // pozycje z doboru; gdy model ich nie dał (stare odpowiedzi) albo pierwsza jest pusta – product_id + wybory
    const lista = (dobor.pozycje ?? []).filter((p) => p && typeof p.product_id === 'number').slice(0, MAKS_POZYCJI)
    pozycje = lista.length
      ? lista.map((p) => ({ product_id: p.product_id, ilosc: Math.max(1, Math.round(p.ilosc || 1)), wybory: zWyborow(p.wybory), opis: p.opis ?? '' }))
      : [{ product_id: dobor.product_id, ilosc: 1, wybory: zWyborow(dobor.wybory), opis: '' }]
    if (!Object.keys(pozycje[0].wybory).length && dobor.wybory?.length) pozycje[0].wybory = zWyborow(dobor.wybory)
    for (const p of pozycje) sprawdzKandydata(p.product_id, 'wybrało do pozycji')
    if (odNowa) dobor = { ...dobor, uzasadnienie: `dobrane od nowa na prośbę handlowca („${poprawkaTekst.slice(0, 120)}”): ${dobor.uzasadnienie}` }
  }

  // cena (kod): każda pozycja osobno, potem suma
  const wiele = pozycje.length > 1
  const pref = (i: number) => (wiele ? `Poz. ${i + 1}: ` : '')
  const dane = await zaladujDane(db, [...new Set(pozycje.map((p) => p.product_id))])
  let wyniki: Wynik[] = []
  let wybory: Stan[] = []
  let nieznanePoz: string[][] = []
  const przelicz = () => {
    wyniki = []; wybory = []; nieznanePoz = []
    pozycje.forEach((p) => {
      const r = wybierzPoNazwach(dane, p.product_id, p.wybory)
      wybory.push(r.wybory)
      wyniki.push(policz(dane, p.product_id, r.wybory, p.ilosc))
      nieznanePoz.push(r.nieznane)
    })
  }
  przelicz()
  // 27.11 naprawa (Otto 49 / Libre 31): pozycje z brakującymi wymaganymi polami albo wyborami spoza spisu pól — sklep ich nie przyjmie
  // (koszyk z samym dodatkiem). Jedna runda AI z pełnym spisem pól tych produktów; co się nie uda, zostaje w „sprawdź”.
  const naprawiane = pozycje.map((p, i) => ({ i, braki: [...wyniki[i].brakujace.map((b) => `brak wymaganego pola „${b}”`), ...nieznanePoz[i].map((n) => `wybór spoza spisu pól: ${n}`)] }))
    .filter((x) => x.braki.length)
  const uwagiNaprawy: string[] = []
  if (naprawiane.length) {
    try {
      const pn = promptNaprawy(analizaDoboru, naprawiane.map(({ i, braki }) => ({ lp: i + 1, product_id: pozycje[i].product_id, opis: pozycje[i].opis, wybory: pozycje[i].wybory, braki, spis: opisOpcji(dane, pozycje[i].product_id) })), poprawkaTekst)
      const rn = await claudeJson<Naprawa>(pn.system, pn.user, SCHEMA_NAPRAWA, 'high', 'naprawa')
      zuzycie.push(rn.zuzycie)
      for (const np of rn.dane.pozycje ?? []) {
        const p = pozycje[np.lp - 1]
        if (!p || !naprawiane.some((x) => x.i === np.lp - 1) || !np.wybory?.length) continue
        p.wybory = zWyborow(np.wybory)
        if (np.uwaga?.trim()) uwagiNaprawy.push(`${pref(np.lp - 1)}${np.uwaga.trim()}`)
      }
      przelicz()
    } catch (e) {
      console.error('naprawa:', e instanceof Error ? e.message : String(e))
    }
  }
  const nieznane: string[] = nieznanePoz.flatMap((lista, i) => lista.map((n) => pref(i) + n))
  const razem = zaokr(wyniki.reduce((s, w) => s + w.razem, 0))
  const sztuk = pozycje.reduce((s, p) => s + p.ilosc, 0)
  const nazwaOferty = wiele ? `${wyniki[0].nazwa} (+${pozycje.length - 1} ${pozycje.length === 2 ? 'pozycja' : pozycje.length <= 5 ? 'pozycje' : 'pozycji'}, ${sztuk} szt.)`
    : sztuk > 1 ? `${wyniki[0].nazwa} × ${sztuk} szt.` : wyniki[0].nazwa

  // koszyk (sklep): produkty po kolei na jednej sesji
  let link: string | null = null, waznyDo: Date | null = null, koszykZgodny: boolean | null = null, koszykUwaga: string | null = null
  if (!BEZ_LINKU) {
    try {
      const k = await utworzLink(dane, pozycje.map((p, i) => ({ pid: p.product_id, wybory: wybory[i], ilosc: p.ilosc })))
      link = k.link; waznyDo = k.wazny_do
      koszykZgodny = Math.abs(k.suma_koszyka - razem) < 0.005
      if (!koszykZgodny) koszykUwaga = `Koszyk sklepu policzył ${k.suma_koszyka.toFixed(2)} zł, kalkulator ${razem.toFixed(2)} zł. Nie wysyłaj bez wyjaśnienia różnicy.`
      if (k.bledy.length) koszykUwaga = (koszykUwaga ? koszykUwaga + ' ' : '') + 'Sklep zgłosił: ' + k.bledy.join('; ')
    } catch (e) {
      koszykUwaga = 'Nie udało się utworzyć linku do koszyka: ' + (e instanceof Error ? e.message : String(e))
    }
  }

  // dostawa (poza koszykiem)
  const dostawa = ustalDostawe(analiza.dane?.dostawa, o.dostawa, poprawkaWynik?.dostawa)

  // mail (AI)
  const rozbicie = rozbicieTekst(wyniki, { opis: opisDostawy(dostawa), koszt: dostawa.koszt })
  const konfiguracja = {
    pozycje: pozycje.map((p, i) => ({ lp: i + 1, produkt: wyniki[i].nazwa, product_id: p.product_id, ilosc: p.ilosc, opis: p.opis || undefined, wybory: p.wybory,
      cena_szt: wyniki[i].razem_szt, cena_pozycji: wyniki[i].razem })),
    drzwi_razem: razem, dostawa: opisDostawy(dostawa), zalozenia: dobor.zalozenia ?? [], domyslne: dobor.domyslne ?? [],
    poza_wycena: (dobor.poza_wycena ?? '').trim(),
  }
  const waznyTxt = waznyDo ? waznyDo.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ', godz.') : null
  // #159: mail w stylu handlowca oferty (ten, kto zlecił / wpisał poprawkę → ostatnio piszący do klienta → domyślny z ustawień)
  const styl = await stylHandlowca(db, o.handlowiec ?? userId, o.lead_id)
  const pm = promptMaila(transkrypcja, analiza, konfiguracja, rozbicie, link, waznyTxt, mailWzor, uwagiDoMaila, kanal, zasady.mail, styl)
  const rm = await claudeJson<Mail>(pm.system, pm.user, SCHEMA_MAIL, 'medium', 'mail')
  zuzycie.push(rm.zuzycie)
  const mail = rm.dane

  // „sprawdź tylko to”
  const sprawdz: string[] = [...(dobor.zalozenia ?? [])]
  if (dostawa.zalozona) sprawdz.unshift(`Dostawa kurierem ${dostawa.koszt.toFixed(0)} zł przyjęta z założenia, w rozmowie nie padło, czy klient odbierze osobiście.`)
  if (koszykUwaga) sprawdz.unshift(koszykUwaga)
  sprawdz.push(...nieznane.map((n) => `Nie dopasowano wyboru „${n}”, pole zostało na domyślnym`))
  sprawdz.push(...uwagiNaprawy)
  sprawdz.push(...dane.katalogUwagi)
  wyniki.forEach((w, i) => {
    sprawdz.push(...w.brakujace.map((b) => `${pref(i)}Brak wymaganego pola: ${b}`))
    sprawdz.push(...w.uwagi.map((u) => pref(i) + u))
  })
  sprawdz.push(...uwagiPoprawki)
  sprawdz.push(...niezrozumiane.map((n) => `Poprawka niezrozumiana przez system: ${n}`))
  const mailDo = analiza.email || o.mail_do || lead?.email || null
  if (!mailDo) sprawdz.push('Brak adresu e-mail klienta')

  // zapis: pierwsza pozycja w starych polach (aplikacja), wszystkie w `pozycje`; rozbicie = dopłaty wszystkich pozycji × ilość (flat_fee raz)
  const cenaBazowa = zaokr(wyniki.reduce((s, w) => s + w.cena_bazowa * w.ilosc, 0))
  const rozbicieZapis: Pozycja[] = wyniki.flatMap((w, i) => w.pozycje.map((x) => ({
    ...x, grupa: wiele ? `Poz. ${i + 1} · ${x.grupa}` : x.grupa, kwota: x.typ === 'flat_fee' ? x.kwota : zaokr(x.kwota * w.ilosc) })))
  const pozycjeZapis: PozycjaOferty[] = pozycje.map((p, i) => ({
    lp: i + 1, product_id: p.product_id, produkt: wyniki[i].nazwa, ilosc: p.ilosc, wybory: p.wybory, opis: p.opis,
    cena_bazowa: wyniki[i].cena_bazowa, cena_szt: wyniki[i].razem_szt, cena_razem: wyniki[i].razem, rozbicie: wyniki[i].pozycje,
  }))
  const koszt = sumaKosztu(zuzycie)
  const pola = {
    product_id: pozycje[0].product_id, produkt: nazwaOferty, wybory: pozycje[0].wybory, pozycje: pozycjeZapis, zalozenia: dobor.zalozenia ?? [], sprawdz, dobor, analiza,
    cena_bazowa: cenaBazowa, cena_razem: razem, rozbicie: rozbicieZapis, koszyk_zgodny: koszykZgodny,
    link_koszyka: link, link_wazny_do: waznyDo?.toISOString() ?? null, mail_do: mailDo, mail_temat: mail.temat, mail_tresc: mail.tresc, mail_styl: stylDoZapisu(styl, true),
    dostawa: dostawa.rodzaj, dostawa_koszt: dostawa.koszt,
    koszt_ai_usd: koszt, zuzycie_tokenow: zuzycie, status: 'do_sprawdzenia', liczenie_od: null, uwagi: null as string | null, pytania: [] as string[],
  }
  const opisPozycji = pozycje.map((p, i) => `#${p.product_id} ${wyniki[i].nazwa.slice(0, 50)}${p.ilosc > 1 ? ` ×${p.ilosc}` : ''}`).join('; ')

  let ofertaId = o.id
  let wersja = o.wersja
  if (trybPoprawki) {
    wersja = o.wersja + 1
    const { data: nowa, error } = await db.from('oferty').insert({
      ...pola, lead_id: o.lead_id, rozmowa_id: o.rozmowa_id, mail_id: o.mail_id, wersja, poprzednia_id: o.id, handlowiec: o.handlowiec,
      poprawka: poprawkaTekst, poprawka_wynik: poprawkaWynik,
    }).select('id').single()
    if (error) throw new Error('Nie zapisano nowej wersji: ' + error.message)
    ofertaId = nowa.id
    await db.from('oferty').update({ status: 'robocza', liczenie_od: null }).eq('id', o.id)
    await zdarzenie(db, { lead_id: o.lead_id, oferta_id: ofertaId, typ: 'poprawka', kto: userId,
      opis: `v${o.wersja} → v${wersja}: „${poprawkaTekst.slice(0, 200)}” | ${poprawkaWynik?.streszczenie ?? ''} | cena ${o.cena_razem ?? '-'} → ${razem} zł`,
      dane: { zmiany: poprawkaWynik?.zmiany, usun: poprawkaWynik?.usun, pozycja: poprawkaWynik?.pozycja, ilosc: poprawkaWynik?.ilosc, usun_pozycje: poprawkaWynik?.usun_pozycje,
        nowe_pozycje: poprawkaWynik?.nowe_pozycje?.length ?? 0, niezrozumiane, koszt_usd: koszt } })
  } else {
    const { error } = await db.from('oferty').update(pola).eq('id', o.id)
    if (error) throw new Error('Nie zapisano oferty: ' + error.message)
    await zdarzenie(db, { lead_id: o.lead_id, oferta_id: o.id, typ: 'przeliczono', kto: userId,
      opis: `${wiele ? `${pozycje.length} pozycje: ` : ''}${opisPozycji.slice(0, 200)} | ${razem} zł | koszyk ${koszykZgodny === null ? 'brak' : koszykZgodny ? 'zgodny' : 'ROZJAZD'} | pewność ${dobor.pewnosc}`,
      dane: { koszt_usd: koszt, sprawdz, pozycje: pozycje.length, sztuk } })
  }
  if (o.lead_id) {
    await db.from('leady').update({ nastepna_akcja: 'przygotuj_oferte', akcja_opis: `Sprawdź i wyślij ofertę: ${(razem + dostawa.koszt).toFixed(0)} zł z dostawą, ${nazwaOferty.slice(0, 80)}`.slice(0, 500) }).eq('id', o.lead_id)
  }
  return { oferta_id: ofertaId, wersja, cena: razem, pozycje: pozycje.length, sztuk, dostawa: dostawa.rodzaj, dostawa_koszt: dostawa.koszt, koszyk_zgodny: koszykZgodny, koszt_usd: Number(koszt.toFixed(4)) }
}

/** Pozycje do liczenia poprawki: z `oferty.pozycje` (nowe oferty) albo z product_id + wybory (oferty sprzed 2026-11-16). */
function pozycjeZOferty(o: Oferta): Poz[] {
  const z = Array.isArray(o.pozycje) ? o.pozycje.filter((p) => p && typeof p.product_id === 'number') : []
  if (z.length) return z.map((p) => ({ product_id: p.product_id, ilosc: Math.max(1, Math.round(Number(p.ilosc) || 1)), wybory: { ...(p.wybory ?? {}) }, opis: p.opis ?? '' }))
  return [{ product_id: o.product_id!, ilosc: 1, wybory: { ...(o.wybory ?? {}) }, opis: '' }]
}

/** Zmiana z poprawki: przy kilku polach o tej samej nazwie podmienia to, do którego należy nowy wybór (wg spisu pól produktu);
 *  gdy nowy wybór należy do innego pola niż dotychczasowa wartość — dopisuje jako „Nazwa #2”. */
function ustawWybor(w: Record<string, string | number>, pole: string, wybor: string | number, dane: Dane | null, pid: number) {
  if (/#\d+\s*$/.test(pole)) { w[pole.trim()] = wybor; return }
  const baza = bazaNazwy(pole)
  const klucze = Object.keys(w).filter((k) => bazaNazwy(k).toLowerCase() === baza.toLowerCase())
  if (!klucze.length) { w[baza] = wybor; return }
  let pola: (v: string | number) => number[] = () => []
  try { if (dane?.produkt(pid)) pola = (v) => polaZWyborem(dane, pid, baza, v) } catch { /* produkt spoza danych poprawki */ }
  const nowe = pola(wybor)
  if (!nowe.length) { w[klucze[0]] = wybor; return }
  const ten = klucze.find((k) => pola(w[k]).some((id) => nowe.includes(id)))
  if (ten) { w[ten] = wybor; return }
  if (klucze.length === 1 && pola(w[klucze[0]]).length === 0) { w[klucze[0]] = wybor; return }
  let k = baza
  for (let n = 2; k in w; n++) k = `${baza} #${n}`
  w[k] = wybor
}

/** Których pozycji dotyczy poprawka: numer od 1 albo 0 = wszystkie. */
function celePoprawki(pozycje: Poz[], nr: number | undefined): Poz[] {
  const n = Math.round(nr ?? 0)
  return n >= 1 && n <= pozycje.length ? [pozycje[n - 1]] : pozycje
}

// --------------------------------------------------------------------------------------------
/** Ładuje z bazy produkty i grupy opcji potrzebne do policzenia podanych produktów (+ produkty dodatkowe z opcji typu product). */
async function zaladujDane(db: SupabaseClient, pids: number[]): Promise<Dane> {
  const { data: prod, error: eP } = await db.from('produkty').select('id, nazwa, status, cena, permalink, kategorie').in('id', pids)
  if (eP) throw new Error('Cennik produkty: ' + eP.message)
  const produkty = (prod ?? []) as Produkt[]
  if (produkty.length !== pids.length) throw new Error(`Brak w cenniku produktów: ${pids.filter((p) => !produkty.some((x) => x.id === p)).join(', ')}`)
  const kategorie = [...new Set(produkty.flatMap((p) => p.kategorie ?? []))]
  const [{ data: gr, error: eG }, karty] = await Promise.all([
    db.from('grupy_opcji').select('*').eq('visibility', 'specific').or(`products.ov.{${pids.join(',')}},categories.ov.{${kategorie.join(',') || 0}}`),
    Promise.all(produkty.map((p) => grupyZKarty(p))),
  ])
  if (eG) throw new Error('Cennik grupy: ' + eG.message)
  const grupy = (gr ?? []) as Grupa[]
  const uwagi: string[] = []
  // grupy, które karta pokazuje, a zapytanie (products/categories ze zrzutu) ich nie zwróciło — dociągnij po id
  const znane = new Set(grupy.map((g) => g.id))
  const brak = [...new Set(karty.flatMap((k) => (k ? [...k.keys()] : [])))].filter((id) => !znane.has(id))
  if (brak.length) {
    const { data: dg } = await db.from('grupy_opcji').select('*').in('id', brak)
    grupy.push(...((dg ?? []) as Grupa[]))
  }
  const poId = new Map(grupy.map((g) => [g.id, g]))
  produkty.forEach((p, i) => {
    const k = karty[i]
    if (!k) return
    for (const [gid, opcje] of k) {
      const g = poId.get(gid)
      if (!g) { uwagi.push(`Katalog CRM jest nieaktualny: sklep pokazuje przy #${p.id} grupę opcji #${gid}, której CRM nie zna — cena i koszyk mogą się nie zgadzać; odśwież katalog sklepu.`); continue }
      const wKatalogu = new Set((g.options ?? []).map((o) => o.id))
      const nowe = opcje.filter((o) => !wKatalogu.has(o))
      if (nowe.length) uwagi.push(`Katalog CRM jest nieaktualny: w grupie „${g.nazwa}” (#${p.id}) sklep ma pola, których CRM nie zna (${nowe.join(', ')}) — odśwież katalog sklepu.`)
    }
  })
  const dodatkowe = new Set<number>()
  for (const g of grupy) for (const o of g.options ?? []) for (const m of o.manual_products ?? []) if (m) dodatkowe.add(m)
  for (const x of Object.values({ 76: [42716, 43519] })) for (const m of x) dodatkowe.add(m)
  for (const p of pids) dodatkowe.delete(p)
  if (dodatkowe.size) {
    const { data: dod } = await db.from('produkty').select('id, nazwa, status, cena, permalink, kategorie').in('id', [...dodatkowe])
    produkty.push(...((dod ?? []) as Produkt[]))
  }
  const dane = new Dane(produkty, grupy)
  produkty.forEach((p, i) => { const k = karty[i]; if (k) dane.ustawGrupyZKarty(p.id, new Set(k.keys())) })
  dane.katalogUwagi = uwagi
  return dane
}

/** Grupy Barn2 (i ich pola), które karta produktu podrzwi.pl renderuje teraz. null = nie udało się pobrać (liczymy wg zrzutu). */
const kartyCache = new Map<number, { t: number; grupy: Map<number, number[]> | null }>()
async function grupyZKarty(p: Produkt): Promise<Map<number, number[]> | null> {
  if (!p.permalink) return null
  const c = kartyCache.get(p.id)
  if (c && Date.now() - c.t < 10 * 60_000) return c.grupy
  let grupy: Map<number, number[]> | null = null
  try {
    const r = await fetch(p.permalink, { headers: { 'User-Agent': 'Mozilla/5.0 (PoDrzwi oferty)' }, signal: AbortSignal.timeout(15_000) })
    if (r.ok) {
      const h = await r.text()
      const m = new Map<number, number[]>()
      for (const x of h.matchAll(/data-group-id="(\d+)"(?: data-option-id="(\d+)")?/g)) {
        const gid = Number(x[1])
        if (!m.has(gid)) m.set(gid, [])
        if (x[2] && !m.get(gid)!.includes(Number(x[2]))) m.get(gid)!.push(Number(x[2]))
      }
      grupy = m.size ? m : null
    }
  } catch (e) {
    console.error(`karta #${p.id}:`, e instanceof Error ? e.message : String(e))
  }
  kartyCache.set(p.id, { t: Date.now(), grupy })
  return grupy
}

/** Zasady domyślne firmy (crm.zasady, edytowane przez superadmina w aplikacji): 'dobor' do promptu doboru, 'mail' do promptu maila. */
async function zaladujZasady(db: SupabaseClient): Promise<{ dobor: string[]; mail: string[] }> {
  const { data, error } = await db.from('zasady').select('grupa, tresc').eq('aktywna', true).order('kolejnosc').order('created_at')
  if (error) { console.error('zasady:', error.message); return { dobor: [], mail: [] } }
  const out = { dobor: [] as string[], mail: [] as string[] }
  for (const z of data ?? []) {
    const t = String(z.tresc ?? '').trim()
    if (!t) continue
    if (z.grupa === 'mail') out.mail.push(t)
    else out.dobor.push(t)
  }
  return out
}

function sumaKosztu(z: Zuzycie[]): number {
  return z.reduce((s, x) => s + (x.input_tokens * 4 + x.output_tokens * 20) / 1_000_000, 0)
}

async function zdarzenie(db: SupabaseClient, z: { lead_id?: string | null; oferta_id?: string | null; typ: string; opis?: string; dane?: unknown; kto?: string | null }) {
  const { error } = await db.from('zdarzenia').insert({ lead_id: z.lead_id ?? null, oferta_id: z.oferta_id ?? null, typ: z.typ, opis: z.opis ?? null, dane: z.dane ?? null, kto: z.kto ?? null })
  if (error) console.error('zdarzenie:', error.message)
}
