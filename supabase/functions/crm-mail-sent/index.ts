// crm-mail-sent: czytnik skrzynek pocztowych CRM Po Drzwi (IMAP), wiele skrzynek z crm.skrzynki.
//
// Dla każdej aktywnej skrzynki (hasło z sejfu: rpc haslo_skrzynki):
//   * folder Wysłane (czyta_wyslane): każdy nowy mail trafia do crm.maile (kierunek 'wychodzacy') i jest dopasowywany
//     do ofert/leadów (oferta do_sprawdzenia → 'wyslana', zadanie dopytaj zamknięte → follow_up za 3 dni, follow_up zamknięte → kolejny follow_up za 5 dni (klient w grze), historia leada);
//     27.11 (Tymek: „wysłałem ofertę, a zadanie wisi na dopytaj / wyślij ofertę”): mail wyglądający na ofertę (link do koszyka
//     podrzwi.pl albo PDF oferty/wyceny — tylko we własnej treści, bez cytatu) zamyka zadanie przygotuj_oferte / dopytaj / follow_up
//     (albo brak zadania) i planuje „Zapytaj o decyzję” za 3 dni robocze, jak trigger crm.po_wyslaniu_oferty; klient po
//     adresie także z inne_kontakty (crm.lead_po_adresach).
//   * folder Odebrane (czyta_odebrane): każdy nowy mail trafia do crm.maile (kierunek 'przychodzacy'); własne maile,
//     newslettery i automaty dostają status 'pominiety', reszta status 'nowy', a trigger w bazie zleca analizę AI
//     funkcji crm-call-ingest (akcja 'mail'), która tworzy leady, zadania i oferty tak jak dla rozmów.
// Stan synchronizacji (UIDVALIDITY, ostatni UID per folder, czasy, błąd) zapisujemy w crm.skrzynki. Pierwsze sprawdzenie
// folderu tylko zapamiętuje punkt startu (historia nie jest przetwarzana). Maksymalnie MAKS_MAILI_NA_RAZ maili na folder i przebieg.
//
// Akcje (POST JSON, pole `akcja`):
//   sprawdz_skrzynki – co 5 min z pg_cron (klucz wewnętrzny) albo ręcznie z aplikacji (JWT); opcjonalnie `skrzynka_id`
//                      (jedna skrzynka, ręcznie także nieaktywna). Alias: sprawdz_poczte.
//   test_poczty      – próbne logowanie: `skrzynka_id` (dane i hasło z bazy) i/lub host, port, login, haslo z treści;
//                      zwraca listę folderów z podpowiedzią Wysłane/Odebrane i liczbę maili w `folder` (gdy podany).
//   zalacznik        – { mail_id, nr }: załącznik maila na żądanie (skrzynka IMAP → bucket crm-zalaczniki), podpisany link 10 min.
//   alerty           – co 15 min z pg_cron: nowe zdarzenia typu 'blad' (od crm.ustawienia.alert_ostatnie_zdarzenie_id) idą jednym
//                      mailem na alert_email przez SMTP skrzynki alert_skrzynka_id (smtp.ts). test_alertu – mail próbny (superadmin/system).
//   (bez akcji)      – pojedynczy mail {do, temat, data, message_id, od} jako JSON lub formularz (stare wejście, zostaje awaryjnie).
//
// Autoryzacja: x-ingest-key (CRM_INGEST_KEY), x-internal-key (vault, rpc klucz_wewnetrzny) albo Authorization: Bearer <JWT>
// użytkownika z dostępem do CRM (rpc current_user_has_crm); superadmin rozpoznawany przez current_user_is_superadmin.
// Zwykły użytkownik CRM może testować i sprawdzać (ma własne skrzynki), zapis skrzynek pilnuje rpc ustaw_skrzynke.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { Imap, type Folder, parsujNaglowki, parsujDate } from './imap.ts'
import { polaczTls } from './imap_deno.ts'
import { parsujWiadomosc, usunCytaty, wyciagnijZalacznik, type Zalacznik } from './mime.ts'
import { wyslijSmtp } from './smtp.ts'

const JSON_H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
const CORS_H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ingest-key' }
const odp = (status: number, dane: unknown) => new Response(JSON.stringify(dane), { status, headers: JSON_H })
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const MAKS_MAILI_NA_RAZ = 40
const LIMIT_BAJTOW_ODEBRANE = 300_000
const LIMIT_BAJTOW_WYSLANE = 120_000
const MAKS_TRESCI = 50_000
const WLASNE_DOMENY = ['podrzwi.pl', 'krcenter.pl']
let kluczWewnetrzny: string | null = null

type Skrzynka = {
  id: string; nazwa: string; aktywna: boolean; host: string; port: number; login: string; ma_haslo: boolean
  user_id: string | null; handlowiec: string | null
  czyta_wyslane: boolean; folder_wyslane: string; uidvalidity_wyslane: number | null; ostatni_uid_wyslane: number | null
  czyta_odebrane: boolean; folder_odebrane: string; uidvalidity_odebrane: number | null; ostatni_uid_odebrane: number | null
  przetworzono_maili: number
}
type Mail = { do: unknown; temat: unknown; data: unknown; message_id: unknown; od: unknown; oferta?: boolean }
type Kto = 'system' | 'superadmin' | 'uzytkownik'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_H })
  if (req.method !== 'POST') return odp(405, { error: 'Tylko POST' })
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: 'crm' } })
  const kto = await autoryzuj(req, db)
  if (!kto) return odp(401, { error: 'Brak uprawnień' })

  let body: Record<string, unknown>
  try {
    const ct = req.headers.get('content-type') ?? ''
    if (ct.includes('form')) {
      const f = await req.formData()
      body = {}
      f.forEach((v, k) => { body[k] = typeof v === 'string' ? v : '' })
    } else {
      body = await req.json()
    }
  } catch { return odp(400, { error: 'Oczekiwano JSON albo formularza' }) }

  const akcja = String(body.akcja ?? '')
  try {
    if (akcja === 'sprawdz_skrzynki' || akcja === 'sprawdz_poczte') return odp(200, await sprawdzSkrzynki(db, kto, body))
    if (akcja === 'test_poczty') return odp(200, await testPoczty(db, body))
    if (akcja === 'zalacznik') return odp(200, await zalacznik(db, body))
    if (akcja === 'alerty' || akcja === 'test_alertu') return odp(200, await alerty(db, kto, akcja))
    if (akcja === 'historia_wyslanych') {
      if (kto === 'uzytkownik') return odp(403, { error: 'Historię wysłanych może wczytać tylko superadmin albo system' })
      return odp(200, await historiaWyslanych(db, body))
    }
    if (akcja) return odp(400, { error: `Nieznana akcja: ${akcja}` })
    return odp(200, await przetworzMail(db, body as Mail, null))
  } catch (e) {
    return odp(200, { ok: false, blad: e instanceof Error ? e.message : String(e) })
  }
})

// ============================================================================================
// Przegląd skrzynek
// ============================================================================================
async function sprawdzSkrzynki(db: SupabaseClient, kto: Kto, body: Record<string, unknown>) {
  const recznie = kto !== 'system'
  const jedna = typeof body.skrzynka_id === 'string' && body.skrzynka_id ? body.skrzynka_id : null
  let q = db.from('skrzynki').select('*').order('created_at')
  if (jedna) q = q.eq('id', jedna)
  else if (!recznie) q = q.eq('aktywna', true)
  const { data, error } = await q
  if (error) throw new Error('Odczyt skrzynek: ' + error.message)
  const skrzynki = (data ?? []) as Skrzynka[]
  if (!skrzynki.length) return { ok: true, pominieto: jedna ? 'nie ma takiej skrzynki' : 'żadna skrzynka nie jest skonfigurowana', skrzynki: [] }
  const wlasne = await wlasneAdresy(db)
  const wyniki = []
  for (const s of skrzynki) {
    if (!s.aktywna && !(recznie && jedna)) { wyniki.push({ id: s.id, nazwa: s.nazwa, ok: true, pominieto: 'skrzynka wyłączona' }); continue }
    wyniki.push({ id: s.id, nazwa: s.nazwa, ...(await sprawdzSkrzynke(db, s, wlasne)) })
  }
  return { ok: wyniki.every((w) => w.ok), skrzynki: wyniki }
}

async function sprawdzSkrzynke(db: SupabaseClient, s: Skrzynka, wlasne: Set<string>) {
  const teraz = new Date().toISOString()
  const zapisz = async (zmiany: Record<string, unknown>) => { await db.from('skrzynki').update(zmiany).eq('id', s.id) }
  if (!s.ma_haslo) { await zapisz({ ostatnie_sprawdzenie_at: teraz, ostatni_blad: 'Brak hasła do skrzynki', ostatni_blad_at: teraz }); return { ok: false, blad: 'Brak hasła do skrzynki' } }
  if (!s.czyta_wyslane && !s.czyta_odebrane) return { ok: true, pominieto: 'skrzynka nie ma zaznaczonego żadnego folderu do czytania' }
  const { data: haslo } = await db.rpc('haslo_skrzynki', { p_id: s.id })
  if (typeof haslo !== 'string' || !haslo) { await zapisz({ ostatnie_sprawdzenie_at: teraz, ostatni_blad: 'Nie udało się odczytać hasła z sejfu', ostatni_blad_at: teraz }); return { ok: false, blad: 'Nie udało się odczytać hasła z sejfu' } }

  let imap: Imap | null = null
  const wynik: Record<string, unknown> = { ok: true }
  let przetworzono = 0
  try {
    imap = new Imap(await polaczTls(s.host, s.port))
    await imap.powitanie()
    await imap.login(s.login, haslo)

    if (s.czyta_wyslane) {
      const w = await synchronizujFolder(imap, s.folder_wyslane, s.uidvalidity_wyslane, s.ostatni_uid_wyslane, LIMIT_BAJTOW_WYSLANE,
        (uid, naglowki, cialo, ucieta, internal) => przetworzWychodzacy(db, s, uid, naglowki, cialo, ucieta, internal))
      await zapisz({ uidvalidity_wyslane: w.uidvalidity, ostatni_uid_wyslane: w.ostatni_uid })
      przetworzono += w.nowych
      wynik.wyslane = w.odpowiedz
    }
    if (s.czyta_odebrane) {
      const w = await synchronizujFolder(imap, s.folder_odebrane, s.uidvalidity_odebrane, s.ostatni_uid_odebrane, LIMIT_BAJTOW_ODEBRANE,
        (uid, naglowki, cialo, ucieta, internal) => przetworzPrzychodzacy(db, s, wlasne, uid, naglowki, cialo, ucieta, internal))
      await zapisz({ uidvalidity_odebrane: w.uidvalidity, ostatni_uid_odebrane: w.ostatni_uid })
      przetworzono += w.nowych
      wynik.odebrane = w.odpowiedz
    }
    await zapisz({ ostatnie_sprawdzenie_at: teraz, ostatni_sukces_at: teraz, ostatni_blad: null, ostatni_blad_at: null,
      przetworzono_maili: (s.przetworzono_maili ?? 0) + przetworzono })
    return wynik
  } catch (e) {
    const blad = e instanceof Error ? e.message : String(e)
    await zapisz({ ostatnie_sprawdzenie_at: teraz, ostatni_blad: blad.slice(0, 500), ostatni_blad_at: teraz })
    return { ...wynik, ok: false, blad }
  } finally {
    if (imap) await imap.wyloguj()
  }
}

type Przetwarzacz = (uid: number, naglowki: string, cialo: Uint8Array, ucieta: boolean, internal: Date | null) => Promise<unknown>

/** Wspólna pętla dla folderu: punkt startu przy pierwszym razie / zmianie UIDVALIDITY, potem nowe UID-y po kolei. */
async function synchronizujFolder(imap: Imap, folder: string, uidvalidity: number | null, ostatniUid: number | null, limitBajtow: number, przetworz: Przetwarzacz) {
  const stan = await imap.wybierz(folder)
  const ostatniNaSerwerze = stan.uidnext - 1
  if (uidvalidity !== stan.uidvalidity || ostatniUid === null) {
    return { uidvalidity: stan.uidvalidity, ostatni_uid: ostatniNaSerwerze, nowych: 0,
      odpowiedz: { start: true, folder, maili_w_folderze: stan.exists, od_uid: ostatniNaSerwerze + 1 } }
  }
  if (ostatniNaSerwerze <= ostatniUid) return { uidvalidity: stan.uidvalidity, ostatni_uid: ostatniUid, nowych: 0, odpowiedz: { folder, nowych: 0 } }

  const lista = await imap.naglowki(ostatniUid + 1, MAKS_MAILI_NA_RAZ)
  const wyniki: unknown[] = []
  let uid = ostatniUid
  for (const m of lista) {
    try {
      const w = await imap.wiadomosc(m.uid, limitBajtow)
      if (w) wyniki.push({ uid: m.uid, ...(await przetworz(m.uid, w.naglowki, w.cialo, w.ucieta, w.internaldate) as Record<string, unknown>) })
      else wyniki.push({ uid: m.uid, pominieto: 'serwer nie zwrócił wiadomości' })
    } catch (e) {
      // jeden zepsuty mail nie zatrzymuje reszty; zapisujemy błąd i idziemy dalej
      wyniki.push({ uid: m.uid, blad: e instanceof Error ? e.message : String(e) })
    }
    uid = m.uid
  }
  // gdy było więcej niż MAKS, resztę weźmie następne sprawdzenie; inaczej skaczemy na koniec folderu
  if (lista.length < MAKS_MAILI_NA_RAZ) uid = Math.max(uid, ostatniNaSerwerze)
  return { uidvalidity: stan.uidvalidity, ostatni_uid: uid, nowych: lista.length, odpowiedz: { folder, nowych: lista.length, wyniki } }
}

// ============================================================================================
// Mail wychodzący (folder Wysłane): zapis + dopasowanie do ofert/leadów
// ============================================================================================
async function przetworzWychodzacy(db: SupabaseClient, s: Skrzynka, uid: number, naglowkiSurowe: string, cialo: Uint8Array, ucieta: boolean, internal: Date | null) {
  const h = parsujNaglowki(naglowkiSurowe)
  const tresc = parsujWiadomosc(naglowkiSurowe, cialo, ucieta)
  const od = adresyZ(h['from'])[0] ?? s.login.toLowerCase()
  const doAdresy = adresyZ(h['to'])
  const ccAdresy = adresyZ(h['cc'])
  const data = parsujDate(h['date']) ?? internal ?? new Date()
  const messageId = (h['message-id'] ?? '').trim() || null
  const temat = h['subject'] ?? ''

  const { data: wiersz, error } = await db.from('maile').insert({
    skrzynka_id: s.id, uid, message_id: messageId, kierunek: 'wychodzacy', od_adres: od, od_nazwa: nazwaZ(h['from']),
    do_adresy: doAdresy, cc_adresy: ccAdresy, odpowiedz_na: (h['in-reply-to'] ?? '').trim() || null, temat,
    tresc: tresc.tekst.slice(0, MAKS_TRESCI), tresc_ucieta: tresc.ucieta || tresc.tekst.length > MAKS_TRESCI,
    zalaczniki: tresc.zalaczniki, data: data.toISOString(), typ: 'wlasny', status_przetwarzania: 'przetworzony',
  }).select('id').single()
  if (error) {
    if (error.code === '23505') return { temat: temat.slice(0, 80), duplikat: true }
    throw new Error('Zapis maila wychodzącego: ' + error.message)
  }
  const bezWlasnych = doAdresy.concat(ccAdresy).filter((a) => a !== od && a !== s.login.toLowerCase())
  const oferta = mailZOferta(temat, tresc.tekst, tresc.zalaczniki)
  const dop = await przetworzMail(db, { do: bezWlasnych, temat, data, message_id: messageId, od, oferta }, { mail_id: wiersz.id, skrzynka: s })
  const pierwsze = (dop.wyniki ?? []).find((w) => w.oferta_id || w.lead_id)
  await db.from('maile').update({
    lead_id: pierwsze?.lead_id ?? null, oferta_id: pierwsze?.oferta_id ?? null,
    podsumowanie: opisDopasowania(dop),
  }).eq('id', wiersz.id)
  return { temat: temat.slice(0, 80), do: bezWlasnych, ...dop }
}

function opisDopasowania(d: { pominieto?: string; duplikat?: boolean; wyniki?: Dopasowanie[] }): string {
  if (d.duplikat) return 'Mail już wcześniej przetworzony.'
  if (d.pominieto) return d.pominieto
  const czesci = (d.wyniki ?? []).map((w) => {
    if (w.oferta_id) return `Oferta v${w.wersja ?? '?'} do ${w.adres} oznaczona jako wysłana (dopasowanie po ${w.dopasowanie === 'temat' ? 'temacie' : 'adresie'}).`
    if (w.lead_id) return `Mail do klienta z bazy (${w.adres})${w.zamknieto_zadanie ? `, zadanie „${w.zamknieto_zadanie}” zamknięte` : ''}.`
    if (w.blad) return `Błąd dla ${w.adres}: ${w.blad}`
    return `${w.adres}: ${w.pominieto ?? 'bez dopasowania'}.`
  })
  return czesci.join(' ').slice(0, 1000)
}

// ============================================================================================
// Mail przychodzący (folder Odebrane): zapis, prosty filtr, resztę analizuje crm-call-ingest (trigger w bazie)
// ============================================================================================
async function przetworzPrzychodzacy(db: SupabaseClient, s: Skrzynka, wlasne: Set<string>, uid: number, naglowkiSurowe: string, cialo: Uint8Array, ucieta: boolean, internal: Date | null) {
  const h = parsujNaglowki(naglowkiSurowe)
  const tresc = parsujWiadomosc(naglowkiSurowe, cialo, ucieta)
  let od = adresyZ(h['from'])[0] ?? null
  let odNazwa = nazwaZ(h['from'])
  const doAdresy = adresyZ(h['to'])
  const ccAdresy = adresyZ(h['cc'])
  const data = parsujDate(h['date']) ?? internal ?? new Date()
  const messageId = (h['message-id'] ?? '').trim() || null
  const odpowiedzNa = (h['in-reply-to'] ?? '').trim() || null
  const temat = h['subject'] ?? ''
  // zgłoszenie z formularza kontaktowego strony (Contact Form 7 wysyła je mailem z naszej domeny): klient jest w Reply-To
  const formularz = czyFormularz(h, od, tresc.tekst)
  let nadawcaTechniczny: string | null = null
  if (formularz) {
    nadawcaTechniczny = od
    const klient = adresyZ(h['reply-to'])[0] ?? adresyZ(tresc.tekst).find((a) => !WLASNE_DOMENY.includes(a.split('@')[1] ?? '')) ?? null
    if (klient) { od = klient; odNazwa = nazwaZ(h['reply-to']) ?? imieZFormularza(tresc.tekst) }
  }
  const filtr = formularz ? (tresc.tekst.trim() ? null : { typ: 'inne', powod: 'Pusty formularz.' }) : filtrujPrzychodzacy(h, od, tresc.tekst, tresc.zalaczniki, wlasne)

  // lead po adresie nadawcy i oferta, na którą to odpowiedź (po Message-ID naszego maila)
  let leadId: string | null = null
  let ofertaId: string | null = null
  if (od && !filtr) {
    const { data: lead } = await db.from('leady').select('id').ilike('email', od).order('created_at').limit(1).maybeSingle()
    leadId = lead?.id ?? null
    if (odpowiedzNa) {
      const { data: z } = await db.from('zdarzenia').select('oferta_id, lead_id').eq('typ', 'wyslano').eq('dane->>message_id', odpowiedzNa).limit(1).maybeSingle()
      if (z?.oferta_id) { ofertaId = z.oferta_id; leadId ||= z.lead_id }
    }
  }

  const { data: wiersz, error } = await db.from('maile').insert({
    skrzynka_id: s.id, uid, message_id: messageId, kierunek: 'przychodzacy', od_adres: od, od_nazwa: odNazwa,
    do_adresy: doAdresy, cc_adresy: ccAdresy, odpowiedz_na: odpowiedzNa, temat,
    tresc: tresc.tekst.slice(0, MAKS_TRESCI), tresc_ucieta: tresc.ucieta || tresc.tekst.length > MAKS_TRESCI,
    zalaczniki: tresc.zalaczniki, data: data.toISOString(), lead_id: leadId, oferta_id: ofertaId,
    kanal: formularz ? 'formularz' : 'mail', nadawca_techniczny: nadawcaTechniczny,
    typ: filtr?.typ ?? (ofertaId ? 'odpowiedz' : null),
    status_przetwarzania: filtr ? 'pominiety' : 'nowy',
    podsumowanie: filtr?.powod ?? null,
  }).select('id').single()
  if (error) {
    if (error.code === '23505') return { od, temat: temat.slice(0, 80), duplikat: true }
    throw new Error('Zapis maila przychodzącego: ' + error.message)
  }
  return { mail_id: wiersz.id, od, temat: temat.slice(0, 80), kanal: formularz ? 'formularz' : 'mail', status: filtr ? 'pominiety' : 'nowy', typ: filtr?.typ ?? null, lead_id: leadId, oferta_id: ofertaId, zalaczniki: tresc.zalaczniki.length }
}

/** Contact Form 7 dodaje nagłówek X-WPCF7-Content-Type; awaryjnie: mail z naszej domeny z Reply-To na obcy adres albo z polami formularza w treści. */
function czyFormularz(h: Record<string, string>, od: string | null, tekst: string): boolean {
  if (h['x-wpcf7-content-type'] !== undefined) return true
  const domena = od?.split('@')[1] ?? ''
  const replyTo = adresyZ(h['reply-to'])[0]
  if (WLASNE_DOMENY.includes(domena) && replyTo && !WLASNE_DOMENY.includes(replyTo.split('@')[1] ?? '')) return true
  if (/^(\[po drzwi\]|po drzwi\b.*(formularz|wiadomo|kontakt))/i.test(h['subject'] ?? '') && /(imi[eę]|e-?mail|telefon|wiadomo[sś][cć])\s*[:：]/i.test(tekst)) return true
  return false
}

/** „Imię i nazwisko: Jan Kowalski” / „Nadawca: Jan Kowalski jan@x.pl” / „Od: …” w treści formularza (adres e-mail odcinamy). */
function imieZFormularza(tekst: string): string | null {
  const m = /(?:imi[eę](?: i nazwisko)?|nazwisko|nadawca|od|name)\s*[:：]\s*([^\n<]{2,80})/i.exec(tekst)
  if (!m) return null
  const bez = m[1].replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '').replace(/\s+/g, ' ').trim()
  return bez.length >= 2 ? bez.slice(0, 60) : null
}

/** Co nie idzie do AI: własne maile, newslettery/automaty, puste. null = analizuj. */
function filtrujPrzychodzacy(h: Record<string, string>, od: string | null, tekst: string, zalaczniki: Zalacznik[], wlasne: Set<string>): { typ: string; powod: string } | null {
  if (!od) return { typ: 'inne', powod: 'Brak adresu nadawcy.' }
  const domena = od.split('@')[1] ?? ''
  if (wlasne.has(od) || WLASNE_DOMENY.includes(domena)) return { typ: 'wlasny', powod: 'Mail z własnej skrzynki/domeny.' }
  if (/mailer-daemon|postmaster/.test(od) || /^(delivery status|undeliver|mail delivery)/i.test(h['subject'] ?? '')) return { typ: 'inne', powod: 'Zwrotka serwera pocztowego.' }
  const auto = (h['auto-submitted'] ?? '').toLowerCase()
  if ((auto && auto !== 'no') || h['x-autoreply'] || h['x-autorespond'] || /^(auto|automatic)/i.test(h['x-auto-response-suppress'] ?? '')) return { typ: 'inne', powod: 'Automatyczna odpowiedź.' }
  if (h['list-unsubscribe'] || h['list-id'] || /bulk|list|junk/i.test(h['precedence'] ?? '') || /^(no-?reply|newsletter|news|noreply|notification|notifications|info@facebook|powiadomienia)/i.test(od)) {
    return { typ: 'newsletter', powod: 'Newsletter lub powiadomienie automatyczne.' }
  }
  if (!tekst.trim() && !zalaczniki.length) return { typ: 'inne', powod: 'Pusty mail.' }
  return null
}

async function wlasneAdresy(db: SupabaseClient): Promise<Set<string>> {
  const { data } = await db.from('skrzynki').select('login')
  return new Set((data ?? []).map((s) => String(s.login).toLowerCase()))
}

// ============================================================================================
// Test połączenia
// ============================================================================================
async function testPoczty(db: SupabaseClient, body: Record<string, unknown>) {
  let host = String(body.host ?? '').trim()
  let port = Number(body.port ?? 0) || 0
  let login = String(body.login ?? '').trim()
  let haslo = String(body.haslo ?? '')
  const folder = String(body.folder ?? '').trim()
  const skrzynkaId = typeof body.skrzynka_id === 'string' && body.skrzynka_id ? body.skrzynka_id : null
  if (skrzynkaId && (!host || !login || !haslo)) {
    const { data: p } = await db.from('skrzynki').select('*').eq('id', skrzynkaId).maybeSingle()
    const z = p as Skrzynka | null
    if (!z) return { ok: false, blad: 'Nie ma takiej skrzynki' }
    host ||= z.host; port ||= z.port; login ||= z.login
    if (!haslo) {
      const { data: h } = await db.rpc('haslo_skrzynki', { p_id: z.id })
      haslo = typeof h === 'string' ? h : ''
    }
  }
  if (!host || !login) return { ok: false, blad: 'Podaj serwer i login skrzynki' }
  if (!haslo) return { ok: false, blad: 'Brak hasła: wpisz je w formularzu' }
  port ||= 993
  let imap: Imap | null = null
  try {
    imap = new Imap(await polaczTls(host, port))
    await imap.powitanie()
    await imap.login(login, haslo)
    const foldery = await imap.foldery()
    const wybieralne = foldery.filter((f) => !f.flagi.some((x) => x.toLowerCase() === '\\noselect'))
    const wyslane = folderWyslane(wybieralne)
    const odebrane = folderOdebrane(wybieralne)
    let stan: { exists: number; uidnext: number } | null = null
    let bladFolderu: string | null = null
    if (folder) {
      try { stan = await imap.wybierz(folder) } catch (e) { bladFolderu = e instanceof Error ? e.message : String(e) }
    }
    return {
      ok: true, host, port, login,
      foldery: wybieralne.map((f) => ({ nazwa: f.nazwa, wyslane: f.flagi.some((x) => x.toLowerCase() === '\\sent'), odebrane: f.nazwa.toUpperCase() === 'INBOX' })),
      folder_podpowiedz: wyslane?.nazwa ?? null,
      folder_wyslane_podpowiedz: wyslane?.nazwa ?? null,
      folder_odebrane_podpowiedz: odebrane?.nazwa ?? null,
      folder_sprawdzony: folder || null,
      maili_w_folderze: stan?.exists ?? null,
      blad_folderu: bladFolderu,
    }
  } catch (e) {
    return { ok: false, blad: e instanceof Error ? e.message : String(e), dziennik: imap?.dziennik.slice(-4) ?? [] }
  } finally {
    if (imap) await imap.wyloguj()
  }
}

function folderWyslane(foldery: Folder[]): Folder | undefined {
  return foldery.find((f) => f.flagi.some((x) => x.toLowerCase() === '\\sent'))
    ?? foldery.find((f) => /^(sent|sent items|sent messages|wys[łl]ane|wys[łl]ane elementy)$/i.test(f.nazwa))
    ?? foldery.find((f) => /sent|wys[łl]ane/i.test(f.nazwa))
}

function folderOdebrane(foldery: Folder[]): Folder | undefined {
  return foldery.find((f) => f.nazwa.toUpperCase() === 'INBOX') ?? foldery.find((f) => /odebrane|inbox/i.test(f.nazwa))
}

// ============================================================================================
// Dopasowanie maila wychodzącego do ofert / leadów
// ============================================================================================
type Dopasowanie = { adres: string; oferta_id?: string; lead_id?: string; wersja?: number; dopasowanie?: string; zamknieto_zadanie?: string | null; pominieto?: string; blad?: string }
type Zrodlo = { mail_id: string; skrzynka: Skrzynka } | null

async function przetworzMail(db: SupabaseClient, body: Mail, zrodlo: Zrodlo): Promise<{ ok: boolean; pominieto?: string; duplikat?: boolean; wyniki?: Dopasowanie[] }> {
  const adresy = adresyZ(body.do)
  const temat = String(body.temat ?? '').trim()
  const data = dataZ(body.data)
  const messageId = String(body.message_id ?? '').trim() || null
  const od = String(body.od ?? '').trim().toLowerCase() || null
  if (!adresy.length) return { ok: true, pominieto: 'brak adresata spoza własnych skrzynek' }

  if (messageId) {
    const { data: juz } = await db.from('zdarzenia').select('id').in('typ', ['wyslano', 'mail_wyslany']).eq('dane->>message_id', messageId).limit(1)
    if (juz?.length) return { ok: true, duplikat: true }
  }

  const wyniki: Dopasowanie[] = []
  for (const adres of adresy) {
    try {
      wyniki.push(await dopasuj(db, adres, temat, data, messageId, od, zrodlo, body.oferta === true))
    } catch (e) {
      wyniki.push({ adres, blad: e instanceof Error ? e.message : String(e) })
    }
  }
  return { ok: true, wyniki }
}

async function dopasuj(db: SupabaseClient, adres: string, temat: string, data: Date, messageId: string | null, od: string | null, zrodlo: Zrodlo, jestOferta = false): Promise<Dopasowanie> {
  const dane = { zrodlo: 'imap', message_id: messageId, od, temat, data: data.toISOString(), mail_id: zrodlo?.mail_id ?? null, skrzynka_id: zrodlo?.skrzynka.id ?? null }
  const okno = { od: new Date(data.getTime() - 30 * 86400_000).toISOString(), do: new Date(data.getTime() + 10 * 60_000).toISOString() }
  const { data: wszystkie } = await db.from('oferty').select('id, lead_id, wersja, mail_temat, created_at, handlowiec, rodzaj, brutto, plik_pdf, sprawdz')
    .ilike('mail_do', adres).eq('status', 'do_sprawdzenia').gte('created_at', okno.od).lte('created_at', okno.do)
    .order('created_at', { ascending: false }).limit(10)
  // 27.11 (testy agentów): tylko oferty, które da się wysłać — z kwotą, a oferta z montażem z PDF-em. Oferta „Brakuje cen”
  // albo sklepowa bez produktu nie może sama zostać „wysłana” przez zwykły mail do klienta (np. pytanie o grubość muru).
  const oferty = (wszystkie ?? []).filter((o: { rodzaj?: string | null; brutto?: number | null; plik_pdf?: string | null; sprawdz?: unknown }) => {
    const s0 = Array.isArray(o.sprawdz) && typeof o.sprawdz[0] === 'string' ? String(o.sprawdz[0]) : ''
    if (/^(BRAK CEN|BŁĄD|BLAD)/i.test(s0) || /nie znalazł w sklepie produktu/i.test(s0)) return false
    if (!(Number(o.brutto) > 0)) return false
    if (o.rodzaj === 'oficjalna' && !o.plik_pdf) return false
    return true
  })
  if (oferty.length) {
    const t = normalizujTemat(temat)
    const zTematem = oferty.find((o) => { const mt = normalizujTemat(o.mail_temat ?? ''); return mt && t && (t.includes(mt) || mt.includes(t)) })
    const o = zTematem ?? oferty[0]
    const zmiany: Record<string, unknown> = { status: 'wyslana', wyslano_at: data.toISOString() }
    // skrzynka osobista = wiemy, kto wysłał
    if (zrodlo?.skrzynka.user_id) { zmiany.sprawdzil = zrodlo.skrzynka.user_id; if (!o.handlowiec) zmiany.handlowiec = zrodlo.skrzynka.user_id }
    const { data: zm, error } = await db.from('oferty').update(zmiany).eq('id', o.id).eq('status', 'do_sprawdzenia').select('id')
    if (error) throw new Error('Nie oznaczono oferty: ' + error.message)
    if (!zm?.length) return { adres, oferta_id: o.id, pominieto: 'oferta zmieniła status w międzyczasie' }
    await db.from('zdarzenia').insert({
      lead_id: o.lead_id, oferta_id: o.id, typ: 'wyslano',
      opis: `Wykryto wysłany mail „${temat.slice(0, 120)}” do ${adres}${zTematem ? '' : ' (temat inny niż w ofercie, dopasowano po adresie)'}${zrodlo?.skrzynka.handlowiec ? `, skrzynka: ${zrodlo.skrzynka.handlowiec}` : ''}.`,
      dane: { ...dane, dopasowanie: zTematem ? 'temat' : 'adres' },
    })
    return { adres, oferta_id: o.id, lead_id: o.lead_id ?? undefined, wersja: o.wersja, dopasowanie: zTematem ? 'temat' : 'adres' }
  }

  // klient po adresie: e-mail albo inne_kontakty (połączeni klienci); gdy kilku pasuje — najstarszy z tym e-mailem
  const { data: poAdresie } = await db.rpc('lead_po_adresach', { p_adresy: [adres] })
  const q = typeof poAdresie === 'string' && poAdresie
    ? db.from('leady').select('id, nastepna_akcja, status').eq('id', poAdresie)
    : db.from('leady').select('id, nastepna_akcja, status').ilike('email', adres).order('created_at').limit(1)
  const { data: lead } = await q.maybeSingle()
  if (!lead) return { adres, pominieto: 'adres spoza bazy' }
  let zamknieto: string | null = null
  const ZADANIA_PRZED_OFERTA = [null, 'przygotuj_oferte', 'dopytaj', 'follow_up']
  if (jestOferta && ZADANIA_PRZED_OFERTA.includes(lead.nastepna_akcja) && !['wygrany', 'przegrany'].includes(String(lead.status ?? ''))) {
    // 27.11: handlowiec wysłał ofertę ze swojej poczty (nie przez „Wyślij” w CRM) — zadanie jak po wysłaniu oferty w aplikacji
    const termin = await terminRoboczy(db, dataWarszawa(3, true))
    const zmiany: Record<string, unknown> = {
      nastepna_akcja: 'follow_up', nastepny_krok: termin, akcja_od: new Date().toISOString(),
      akcja_opis: `Zapytaj klienta o decyzję w sprawie oferty wysłanej ${dataPL(data)} (mail „${temat.slice(0, 80)}”).`,
    }
    if (lead.status === 'nowy') zmiany.status = 'oferta'
    let u = db.from('leady').update(zmiany).eq('id', lead.id)
    u = lead.nastepna_akcja ? u.eq('nastepna_akcja', lead.nastepna_akcja) : u.is('nastepna_akcja', null)
    const { data: z } = await u.select('id')
    if (z?.length) {
      zamknieto = lead.nastepna_akcja ?? null
      await db.from('zdarzenia').insert({ lead_id: lead.id, typ: 'zadanie_zrobione',
        opis: `Wysłano ofertę mailem „${temat.slice(0, 120)}”${lead.nastepna_akcja ? ` (zadanie ${lead.nastepna_akcja})` : ''}.`,
        dane: { ...dane, akcja: lead.nastepna_akcja, oferta_z_poczty: true } })
      await db.from('zdarzenia').insert({ lead_id: lead.id, typ: 'follow_up_zaplanowany',
        opis: `Oferta wysłana z poczty; „Zapytaj o decyzję” ${termin.split('-').reverse().slice(0, 2).join('.')}.`,
        dane: { zrodlo: 'imap', message_id: messageId, termin, oferta_z_poczty: true } })
    }
  } else if (lead.nastepna_akcja === 'dopytaj' || lead.nastepna_akcja === 'follow_up') {
    // po odpowiedzi na „dopytaj” klient ma odpisać: jeśli nie odpisze, za 3 dni przypomnienie (szkic zrobi cron crm_szkice_dzis);
    // odpowiedź klienta w międzyczasie nadpisze to zadanie przez analizę maila.
    // 27.11 (testy agentów): zamknięty follow_up klienta w grze planuje kolejne „Zapytaj o decyzję” za 5 dni roboczych —
    // wcześniej czyścił zadanie i klient (także z ofertą) wypadał z „Do zrobienia” na zawsze (20 takich 27.11).
    const poDopytaniu = lead.nastepna_akcja === 'dopytaj'
    const wGrze = !['wygrany', 'przegrany'].includes(String(lead.status ?? ''))
    const termin = await terminRoboczy(db, dataWarszawa(poDopytaniu ? 3 : 5, true))
    const zmiany = poDopytaniu
      ? { nastepna_akcja: 'follow_up', nastepny_krok: termin, akcja_od: new Date().toISOString(),
          akcja_opis: `Klient nie odpowiedział na pytania z ${dataPL(data)}. Przypomnij się (szkic maila jest na karcie klienta).` }
      : wGrze
        ? { nastepna_akcja: 'follow_up', nastepny_krok: termin, akcja_od: new Date().toISOString(),
            akcja_opis: `Klient nie odpowiedział na mail z ${dataPL(data)} („${temat.slice(0, 60)}”). Zapytaj ponownie o decyzję albo zamknij sprawę („Nie zamówi”).` }
        : { nastepna_akcja: null, nastepny_krok: null, akcja_opis: null, akcja_od: null }
    const { data: z } = await db.from('leady').update(zmiany).eq('id', lead.id).eq('nastepna_akcja', lead.nastepna_akcja).select('id')
    if (z?.length) {
      zamknieto = lead.nastepna_akcja
      await db.from('zdarzenia').insert({ lead_id: lead.id, typ: 'zadanie_zrobione', opis: `Wysłano mail „${temat.slice(0, 120)}” (zadanie ${lead.nastepna_akcja}).`,
        dane: { ...dane, akcja: lead.nastepna_akcja } })
      if (poDopytaniu) {
        await db.from('zdarzenia').insert({ lead_id: lead.id, typ: 'follow_up_zaplanowany',
          opis: `Odpowiedź z pytaniami wysłana; jeśli klient nie odpisze, follow-up ${termin.split('-').reverse().slice(0, 2).join('.')}.`,
          dane: { zrodlo: 'imap', message_id: messageId, termin } })
      } else if (wGrze) {
        await db.from('zdarzenia').insert({ lead_id: lead.id, typ: 'follow_up_zaplanowany',
          opis: `Mail do klienta wysłany; kolejne „Zapytaj o decyzję” ${termin.split('-').reverse().slice(0, 2).join('.')}.`,
          dane: { zrodlo: 'imap', message_id: messageId, termin } })
      }
    }
  }
  await db.from('zdarzenia').insert({ lead_id: lead.id, typ: 'mail_wyslany', opis: `Mail do klienta: „${temat.slice(0, 120)}”.`, dane })
  return { adres, lead_id: lead.id, zamknieto_zadanie: zamknieto }
}

// Data w Polsce jako RRRR-MM-DD, przesunięta o `plusDni`; `roboczy` = sobota/niedziela → poniedziałek (firma pracuje pn–pt, zasada właściciela 2026-11-15;
// w bazie to samo robi trigger leady_termin_roboczy, tu liczymy, żeby zdarzenie pokazywało ten sam termin).
function dataWarszawa(plusDni = 0, roboczy = false): string {
  const d = new Date(Date.now() + plusDni * 86400_000)
  const [dd, mm, rr] = d.toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric' }).split('.')
  const dzien = new Date(Date.UTC(Number(rr), Number(mm) - 1, Number(dd)))
  if (roboczy) while (dzien.getUTCDay() === 0 || dzien.getUTCDay() === 6) dzien.setUTCDate(dzien.getUTCDate() + 1)
  return dzien.toISOString().slice(0, 10)
}
function dataPL(d: Date): string {
  return d.toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit' })
}
/** Termin przepuszczony przez crm.termin_roboczy() (weekendy + święta z crm.dni_wolne), żeby zdarzenie miało tę samą datę, co zadanie. */
async function terminRoboczy(db: SupabaseClient, data: string): Promise<string> {
  try {
    const { data: t } = await db.rpc('termin_roboczy', { p_data: data })
    return typeof t === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : data
  } catch { return data }
}

// ============================================================================================
// Historia wysłanych: ostatnie N maili z folderu Wysłane sprzed punktu startu, zapisane jako próbki stylu handlowca
// (crm.maile, kierunek wychodzacy, bez dopasowania do ofert i zadań – to stare maile). Woła superadmin z aplikacji
// albo system: { akcja: 'historia_wyslanych', skrzynka_id, ile?: 30 (max 100) }.
// ============================================================================================
async function historiaWyslanych(db: SupabaseClient, body: Record<string, unknown>) {
  const id = String(body.skrzynka_id ?? '').trim()
  const ile = Math.max(1, Math.min(Number(body.ile ?? 30) || 30, 100))
  if (!id) return { ok: false, blad: 'Brakuje: skrzynka_id' }
  const { data: s } = await db.from('skrzynki').select('*').eq('id', id).maybeSingle()
  if (!s) return { ok: false, blad: 'Nie ma takiej skrzynki' }
  if (!s.ma_haslo) return { ok: false, blad: 'Brak hasła do skrzynki' }
  const { data: haslo } = await db.rpc('haslo_skrzynki', { p_id: s.id })
  if (typeof haslo !== 'string' || !haslo) return { ok: false, blad: 'Nie udało się odczytać hasła z sejfu' }
  let imap: Imap | null = null
  try {
    imap = new Imap(await polaczTls(s.host, s.port))
    await imap.powitanie()
    await imap.login(s.login, haslo)
    const stan = await imap.wybierz(s.folder_wyslane)
    const koniec = s.ostatni_uid_wyslane ?? (stan.uidnext - 1)
    const start = Math.max(1, koniec - ile * 3)
    const lista = (await imap.naglowki(start, ile * 3 + 1)).filter((m) => m.uid <= koniec).slice(-ile)
    let zapisano = 0, duplikaty = 0, pominieto = 0
    const bledy: string[] = []
    for (const m of lista) {
      try {
        const w = await imap.wiadomosc(m.uid, LIMIT_BAJTOW_WYSLANE)
        if (!w) { pominieto++; continue }
        const h = parsujNaglowki(w.naglowki)
        const tresc = parsujWiadomosc(w.naglowki, w.cialo, w.ucieta)
        const od = adresyZ(h['from'])[0] ?? s.login.toLowerCase()
        const doAdresy = adresyZ(h['to'])
        const obcy = doAdresy.concat(adresyZ(h['cc'])).filter((a) => a !== od && !WLASNE_DOMENY.some((dom) => a.endsWith('@' + dom)))
        if (!obcy.length || tresc.tekst.trim().length < 80) { pominieto++; continue }
        const { data: lead } = await db.from('leady').select('id').ilike('email', obcy[0]).limit(1).maybeSingle()
        const { error } = await db.from('maile').insert({
          skrzynka_id: s.id, uid: m.uid, message_id: (h['message-id'] ?? '').trim() || null, kierunek: 'wychodzacy', od_adres: od, od_nazwa: nazwaZ(h['from']),
          do_adresy: doAdresy, cc_adresy: adresyZ(h['cc']), odpowiedz_na: (h['in-reply-to'] ?? '').trim() || null, temat: h['subject'] ?? '',
          tresc: tresc.tekst.slice(0, MAKS_TRESCI), tresc_ucieta: tresc.ucieta || tresc.tekst.length > MAKS_TRESCI, zalaczniki: tresc.zalaczniki,
          data: (parsujDate(h['date']) ?? w.internaldate ?? new Date()).toISOString(), typ: 'wlasny', status_przetwarzania: 'przetworzony',
          lead_id: lead?.id ?? null, podsumowanie: 'Historia wysłanych (próbka stylu), bez dopasowania do zadań.',
        })
        if (error) { if (error.code === '23505') duplikaty++; else bledy.push(`uid ${m.uid}: ${error.message}`) } else zapisano++
      } catch (e) {
        bledy.push(`uid ${m.uid}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    return { ok: true, skrzynka: s.login, folder: s.folder_wyslane, sprawdzono: lista.length, zapisano, duplikaty, pominieto, bledy }
  } catch (e) {
    return { ok: false, blad: e instanceof Error ? e.message : String(e) }
  } finally {
    if (imap) await imap.wyloguj()
  }
}

// ============================================================================================
async function autoryzuj(req: Request, db: SupabaseClient): Promise<Kto | null> {
  const klucz = Deno.env.get('CRM_INGEST_KEY')
  if (klucz && req.headers.get('x-ingest-key') === klucz) return 'system'
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
    if (ma !== true) return null
    const { data: su } = await jakoUzytkownik.rpc('current_user_is_superadmin')
    return su === true ? 'superadmin' : 'uzytkownik'
  }
  return null
}

function adresyZ(x: unknown): string[] {
  const out = new Set<string>()
  const dodaj = (s: unknown) => {
    for (const m of String(s ?? '').matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) out.add(m[0].toLowerCase())
  }
  if (Array.isArray(x)) for (const el of x) dodaj(typeof el === 'object' && el ? (el as Record<string, unknown>).address ?? JSON.stringify(el) : el)
  else dodaj(x)
  return [...out]
}

/** „"Jan Kowalski" <jan@x.pl>” → Jan Kowalski; sam adres → null */
function nazwaZ(from: string | undefined): string | null {
  if (!from) return null
  const m = /^\s*"?([^"<]*?)"?\s*<[^>]+>/.exec(from)
  const n = (m?.[1] ?? '').trim()
  return n || null
}

function dataZ(x: unknown): Date {
  if (x instanceof Date) return x
  const d = new Date(String(x ?? ''))
  return isNaN(d.getTime()) ? new Date() : d
}

function normalizujTemat(t: string): string {
  return t.toLowerCase().replace(/^(\s*(re|odp|fwd?|pd|fw)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim()
}

// -------------------------------------------------------------------------------------------- alerty o błędach (SMTP)
/** Nowe zdarzenia 'blad' od ostatniego alertu → jeden mail na alert_email. Błąd wysyłki trafia do ustawień (alert_ostatni_blad), nie do zdarzeń (żeby nie zapętlić). */
async function alerty(db: SupabaseClient, kto: Kto, akcja: string) {
  if (akcja === 'test_alertu' && kto === 'uzytkownik') return { ok: false, blad: 'Mail próbny może wysłać tylko superadmin albo system' }
  const u = await ustawienia(db)
  const adresy = (u.alert_email ?? '').split(',').map((a) => a.trim()).filter(Boolean)
  if (!adresy.length) return { ok: false, blad: 'Brak adresu w crm.ustawienia (alert_email)' }
  const skrzynkaId = u.alert_skrzynka_id
  if (!skrzynkaId) return { ok: false, blad: 'Brak skrzynki do wysyłki alertów (alert_skrzynka_id)' }
  const { data: s } = await db.from('skrzynki').select('id, host, login, ma_haslo').eq('id', skrzynkaId).maybeSingle()
  if (!s?.ma_haslo) return { ok: false, blad: 'Skrzynka alertów nie istnieje albo nie ma hasła' }
  const port = Number(u.alert_smtp_port ?? '465') || 465

  let temat: string
  let tresc: string
  let ostatnieId = Number(u.alert_ostatnie_zdarzenie_id ?? '0') || 0
  if (akcja === 'test_alertu') {
    temat = 'CRM Po Drzwi: mail próbny alertów'
    tresc = `To jest mail próbny z CRM Po Drzwi.\nAlerty o błędach systemu będą przychodzić na ten adres co najwyżej raz na 15 minut.\n\nWysłano ${new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })} przez skrzynkę ${s.login} (${s.host}:${port}).`
  } else {
    const { data: bledy } = await db.from('zdarzenia').select('id, lead_id, oferta_id, typ, opis, dane, created_at').eq('typ', 'blad').gt('id', ostatnieId).order('id').limit(50)
    if (!bledy?.length) return { ok: true, nowych: 0 }
    const leadIds = [...new Set(bledy.map((b) => b.lead_id).filter(Boolean))] as string[]
    const nazwy = new Map<string, string>()
    if (leadIds.length) {
      const { data: l } = await db.from('leady').select('id, nazwa, telefon, email').in('id', leadIds)
      for (const x of l ?? []) nazwy.set(x.id, x.nazwa || x.telefon || x.email || x.id)
    }
    const [{ count: rozmowyBlad }, { count: maileBlad }] = await Promise.all([
      db.from('rozmowy').select('id', { count: 'exact', head: true }).eq('status_przetwarzania', 'blad'),
      db.from('maile').select('id', { count: 'exact', head: true }).eq('status_przetwarzania', 'blad'),
    ])
    const { data: skrz } = await db.from('skrzynki').select('login, ostatni_blad, ostatni_blad_at').eq('aktywna', true).not('ostatni_blad', 'is', null)
    const linie = bledy.map((b) => {
      const kiedy = new Date(b.created_at).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      const kogo = b.lead_id ? ` [${nazwy.get(b.lead_id) ?? b.lead_id}]` : ''
      return `${kiedy}${kogo}: ${(b.opis ?? '').slice(0, 400)}`
    })
    temat = `CRM Po Drzwi: ${bledy.length} ${bledy.length === 1 ? 'nowy błąd' : bledy.length < 5 ? 'nowe błędy' : 'nowych błędów'} systemu`
    tresc = `Nowe błędy w CRM Po Drzwi (od ostatniego alertu):\n\n${linie.join('\n')}\n\n`
      + `Stan: rozmowy z błędem czekające na ponowienie: ${rozmowyBlad ?? 0}, maile z błędem: ${maileBlad ?? 0}.`
      + (skrz?.length ? `\nSkrzynki z błędem: ${skrz.map((x) => `${x.login} (${(x.ostatni_blad ?? '').slice(0, 120)})`).join('; ')}` : '')
      + `\n\nSystem ponawia nieudane analizy co 15 minut (maks. 6 prób na rozmowę, 4 na mail). Szczegóły w aplikacji: CRM → Błędy systemu.`
      + `\nJeśli błędy dotyczą rozmów z Ringostatu, sprawdź też, czy Make nie wyłączył scenariusza (wyłącza się po 3 błędach z rzędu).`
    ostatnieId = Math.max(...bledy.map((b) => Number(b.id)))
  }

  const { data: haslo } = await db.rpc('haslo_skrzynki', { p_id: s.id })
  if (typeof haslo !== 'string' || !haslo) return { ok: false, blad: 'Nie odczytano hasła skrzynki alertów' }
  try {
    const odpSmtp = await wyslijSmtp(s.host, port, s.login, haslo, { od: s.login, do: adresy, temat, tresc })
    const teraz = new Date().toISOString()
    await db.from('ustawienia').upsert([
      { klucz: 'alert_ostatni_at', wartosc: teraz, updated_at: teraz },
      { klucz: 'alert_ostatni_blad', wartosc: null, updated_at: teraz },
      ...(akcja === 'alerty' ? [{ klucz: 'alert_ostatnie_zdarzenie_id', wartosc: String(ostatnieId), updated_at: teraz }] : []),
    ], { onConflict: 'klucz' })
    return { ok: true, wyslano_do: adresy, temat, smtp: odpSmtp.slice(0, 120), ...(akcja === 'alerty' ? { do_zdarzenia_id: ostatnieId } : {}) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await db.from('ustawienia').upsert({ klucz: 'alert_ostatni_blad', wartosc: msg.slice(0, 500), updated_at: new Date().toISOString() }, { onConflict: 'klucz' })
    console.error('alert SMTP:', msg)
    return { ok: false, blad: msg }
  }
}

async function ustawienia(db: SupabaseClient): Promise<Record<string, string | null>> {
  const { data } = await db.from('ustawienia').select('klucz, wartosc')
  const out: Record<string, string | null> = {}
  for (const r of data ?? []) out[r.klucz] = r.wartosc
  return out
}

// ============================================================================================
// 27.11: czy mail wychodzący to oferta (wysłana z poczty handlowca, nie przez CRM): link do koszyka podrzwi.pl albo PDF
// oferty / wyceny. Liczy się tylko własna treść — cytat poprzedniej wiadomości (odpowiedź „Re: Oferta…”) nie.
// ============================================================================================
export function mailZOferta(temat: string, tekst: string, zalaczniki: Zalacznik[]): boolean {
  const wlasna = usunCytaty(String(tekst ?? '').replace(/\r/g, ''))
  if (/podrzwi\.pl\/koszyk/i.test(wlasna)) return true
  const pdfy = (zalaczniki ?? []).filter((z) => /pdf/i.test(z.typ ?? '') || /\.pdf$/i.test(z.nazwa ?? ''))
  if (!pdfy.length) return false
  if (pdfy.some((z) => /ofert|wycen|kalkulac/i.test(z.nazwa ?? ''))) return true
  return /ofert|wycen/i.test(String(temat ?? '').replace(/^\s*((re|odp|fw|fwd|pd)\s*:\s*)+/i, '')) || /ofert|wycen/i.test(wlasna)
}

// ============================================================================================
// Załącznik maila na żądanie (27.11, Tymek: „żeby w mailach w CRM móc wyświetlać załączniki”)
// ============================================================================================
// { akcja: 'zalacznik', mail_id, nr } → { ok, url (podpisany, 10 min), nazwa, typ }. Plik leży w bucket crm-zalaczniki
// (<mail_id>/<nr>-<nazwa>); pierwszy raz pobieramy wiadomość ze skrzynki IMAP (folder wg kierunku, UID z crm.maile),
// sprawdzamy Message-ID, wycinamy załącznik nr (kolejność jak crm.maile.zalaczniki) i zapisujemy. Mail usunięty ze
// skrzynki / przebudowana skrzynka → czytelny błąd (otwórz w poczcie).
const BUCKET_ZAL = 'crm-zalaczniki'
const MAKS_ZALACZNIK = 25_000_000
const MAKS_WIADOMOSC = 40_000_000

function bezpiecznaNazwa(n: string): string {
  const s = String(n || 'plik').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  return (s || 'plik').slice(-100)
}

async function zalacznik(db: SupabaseClient, body: Record<string, unknown>) {
  const mailId = String(body.mail_id ?? '').trim()
  const nr = Number(body.nr)
  if (!mailId || !Number.isInteger(nr) || nr < 0) return { ok: false, blad: 'Podaj mail_id i nr załącznika' }
  const { data: m } = await db.from('maile').select('id, skrzynka_id, uid, kierunek, message_id, zalaczniki').eq('id', mailId).maybeSingle()
  if (!m) return { ok: false, blad: 'Nie ma takiego maila' }
  const lista = (Array.isArray(m.zalaczniki) ? m.zalaczniki : []) as Zalacznik[]
  const z = lista[nr]
  if (!z) return { ok: false, blad: 'Nie ma takiego załącznika' }
  const sciezka = `${m.id}/${nr}-${bezpiecznaNazwa(z.nazwa)}`
  const wynik = async () => {
    const { data: s } = await db.storage.from(BUCKET_ZAL).createSignedUrl(sciezka, 600)
    return s?.signedUrl ? { ok: true, url: s.signedUrl, nazwa: z.nazwa, typ: z.typ, z_pamieci: true } : null
  }
  const juz = await wynik()
  if (juz) return juz
  if (!m.skrzynka_id || !m.uid) return { ok: false, blad: 'Ten mail nie przyszedł przez skrzynkę CRM — załącznik otwórz w poczcie' }
  if ((Number(z.rozmiar) || 0) > MAKS_ZALACZNIK) return { ok: false, blad: 'Załącznik większy niż 25 MB — otwórz go w poczcie' }
  const { data: s } = await db.from('skrzynki').select('id, host, port, login, ma_haslo, folder_wyslane, folder_odebrane').eq('id', m.skrzynka_id).maybeSingle()
  if (!s?.ma_haslo) return { ok: false, blad: 'Skrzynka tego maila nie ma hasła w CRM' }
  const { data: haslo } = await db.rpc('haslo_skrzynki', { p_id: s.id })
  if (typeof haslo !== 'string' || !haslo) return { ok: false, blad: 'Nie udało się odczytać hasła skrzynki z sejfu' }
  let imap: Imap | null = null
  try {
    imap = new Imap(await polaczTls(s.host, s.port), 60_000)
    await imap.powitanie()
    await imap.login(s.login, haslo)
    await imap.wybierz(m.kierunek === 'wychodzacy' ? s.folder_wyslane : s.folder_odebrane)
    const w = await imap.wiadomosc(Number(m.uid), MAKS_WIADOMOSC)
    if (!w) return { ok: false, blad: 'Tego maila nie ma już w skrzynce (usunięty albo przeniesiony) — załącznika nie da się pobrać' }
    const mid = (parsujNaglowki(w.naglowki)['message-id'] ?? '').trim()
    if (m.message_id && mid && mid !== String(m.message_id).trim()) return { ok: false, blad: 'Skrzynka zmieniła numerację maili — otwórz ten załącznik w poczcie' }
    if (w.ucieta) return { ok: false, blad: 'Mail jest za duży (ponad 40 MB) — otwórz załącznik w poczcie' }
    const x = wyciagnijZalacznik(w.naglowki, w.cialo, nr)
    if (!x || x.bajty.length === 0) return { ok: false, blad: 'Nie udało się wyciąć załącznika z maila' }
    const { error } = await db.storage.from(BUCKET_ZAL).upload(sciezka, x.bajty, { contentType: x.typ || 'application/octet-stream', upsert: true })
    if (error) return { ok: false, blad: 'Nie zapisano załącznika: ' + error.message }
  } finally {
    if (imap) await imap.wyloguj()
  }
  return (await wynik()) ?? { ok: false, blad: 'Nie utworzono linku do załącznika' }
}
