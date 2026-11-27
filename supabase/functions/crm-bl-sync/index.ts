// crm-bl-sync: zamówienia sklepu z Baselinkera do CRM Po Drzwi → Zamówienia (#144/#153, etap 1: podgląd).
//
// Wywołania (zawsze z nagłówkiem x-internal-key = klucz z vault, tak jak pozostałe funkcje CRM):
//   { "akcja": "sync" }                   – pg_cron co 15 min (crm_bl_sync), „Odśwież” na liście i zapis tokenu w Ustawieniach:
//                                           statusy BL, nazwy pól dodatkowych i wszystkie zamówienia złożone od
//                                           max(crm.ustawienia.bl_sync_od, dziś − 60 dni), także niepotwierdzone,
//                                           a do tego pojedynczo zamówienia otwartych zleceń KR Po Drzwi spoza tego okna,
//   { "akcja": "odswiez", "bl_id": 123 }  – jedno zamówienie („Odśwież z Baselinkera” w karcie).
//
// Token API Baselinkera: vault crm_bl_token (wpisuje właściciel w Ustawieniach CRM, rpc crm.ustaw_token_bl), czytany
// przez rpc crm.token_bl (tylko service_role). Funkcja tylko CZYTA z Baselinkera (getOrders, getOrderStatusList,
// getOrderExtraFields, getOrderPackages) — zmiany statusów to etap 2.
// Przesyłki (Tymek 25.11): dla zamówień z numerem paczki getOrderPackages najwyżej co godzinę, aż wszystkie doręczone /
// zwrócone / anulowane, max MAX_PACZEK zamówień na przebieg; zapis w crm.zamowienia_sklep.paczki.
// Wynik ostatniego przebiegu: crm.ustawienia bl_sync_ostatni_at / bl_sync_ostatni_wynik / bl_sync_ostatni_blad.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const JSON_H = { 'Content-Type': 'application/json' }
const odp = (status: number, dane: unknown) => new Response(JSON.stringify(dane), { status, headers: JSON_H })
const BL_URL = 'https://api.baselinker.com/connector.php'
const OKNO_DNI = 60
const MAX_STRON = 30
const MAX_DOCIAGNIETYCH = 40
const MAX_PACZEK = 40
// tracking_status z Baselinkera: 5 doręczona, 6 zwrot, 9 zagubiona, 10 anulowana — dalej nie śledzimy
const PACZKA_KONIEC = new Set([5, 6, 9, 10])
let kluczWewnetrzny: string | null = null

type BlProdukt = {
  order_product_id?: number; product_id?: string; variant_id?: string; name?: string; attributes?: string; sku?: string
  ean?: string; price_brutto?: number; tax_rate?: number; quantity?: number; bundle_id?: number
}
type BlZamowienie = Record<string, unknown> & {
  order_id: number; products?: BlProdukt[]; custom_extra_fields?: Record<string, unknown>
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return odp(405, { error: 'Tylko POST' })
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { db: { schema: 'crm' } })
  if (!(await autoryzowany(req, db))) return odp(401, { error: 'Brak autoryzacji' })

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* puste body = sync */ }
  const akcja = String(body.akcja ?? 'sync')

  const { data: token } = await db.rpc('token_bl')
  if (typeof token !== 'string' || !token.trim()) {
    await zapiszWynik(db, null, 'Brak tokenu API Baselinkera — wpisz go w CRM → Ustawienia → Baselinker.')
    return odp(200, { ok: false, powod: 'brak_tokenu' })
  }

  try {
    if (akcja === 'odswiez') {
      const blId = Number(body.bl_id)
      if (!Number.isFinite(blId) || blId <= 0) return odp(400, { error: 'Podaj bl_id' })
      const r = await bl(token, 'getOrders', { order_id: blId, get_unconfirmed_orders: true, include_custom_extra_fields: true })
      const zam = (r.orders as BlZamowienie[] | undefined) ?? []
      const zapisane = await zapiszZamowienia(db, zam)
      if (zam.length && zam[0].delivery_package_nr) await zapiszPaczki(db, token, blId)
      return odp(200, { ok: true, akcja, zapisane, znalezione: zam.length })
    }

    // 27.11: tylko odczyt — jakie pola / konta ma kurier w Baselinkerze (przygotowanie „Wysyłki kurierem” → createPackage)
    if (akcja === 'kurier_info') {
      const kod = String(body.courier_code ?? 'rohligsuus')
      const wynik: Record<string, unknown> = { courier_code: kod }
      for (const [nazwa, metoda, params] of [
        ['pola', 'getCourierFields', { courier_code: kod }],
        ['konta', 'getCourierAccounts', { courier_code: kod }],
        ...(Number(body.bl_id) > 0 ? [['paczki_zamowienia', 'getOrderPackages', { order_id: Number(body.bl_id) }]] : []),
      ] as Array<[string, string, Record<string, unknown>]>) {
        try { wynik[nazwa] = await bl(token, metoda, params) } catch (e) { wynik[nazwa] = { blad: e instanceof Error ? e.message : String(e) } }
      }
      return odp(200, { ok: true, ...wynik })
    }

    // 27.11: Wysyłki kurierem → przesyłka Rohlig SUUS w Baselinkerze (createPackage). Reszta (statusy, maile, etykieta) po stronie BL.
    if (akcja === 'przesylka') {
      // błąd przesyłki nie nadpisuje wyniku synchronizacji (bl_sync_ostatni_blad)
      try { return odp(200, await przesylka(db, token, body)) } catch (e) { return odp(500, { ok: false, error: e instanceof Error ? e.message : String(e) }) }
    }

    const t0 = Date.now()
    const statusy = await synchronizujStatusy(db, token)
    await synchronizujPolaDodatkowe(db, token)
    const od = await poczatekOkna(db)
    let idOd = 0
    let pobrane = 0
    let zapisane = 0
    let nowe = 0
    for (let strona = 0; strona < MAX_STRON; strona++) {
      const params: Record<string, unknown> = { date_from: od, get_unconfirmed_orders: true, include_custom_extra_fields: true }
      if (idOd > 0) params.id_from = idOd
      const r = await bl(token, 'getOrders', params)
      const zam = ((r.orders as BlZamowienie[] | undefined) ?? []).filter((z) => Number(z.order_id) >= idOd)
      if (zam.length === 0) break
      pobrane += zam.length
      const w = await zapiszZamowienia(db, zam)
      zapisane += w.zapisane
      nowe += w.nowe
      const maxId = Math.max(...zam.map((z) => Number(z.order_id)))
      if (zam.length < 100 || maxId + 1 <= idOd) break
      idOd = maxId + 1
    }
    // zamówienia otwartych zleceń KR spoza okna (np. drzwi zamówione we wrześniu, jeszcze w produkcji) — pojedynczo
    const dociagniete = await dociagnijOtwarte(db, token)
    const paczki = await odswiezPaczki(db, token)
    const wynik = { ok: true, statusy, pobrane, zapisane, nowe, dociagniete, paczki, od: new Date(od * 1000).toISOString().slice(0, 10), ms: Date.now() - t0 }
    await zapiszWynik(db, wynik, null)
    return odp(200, wynik)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await zapiszWynik(db, null, msg)
    return odp(500, { ok: false, error: msg })
  }
})

// --------------------------------------------------------------------------------------------
async function autoryzowany(req: Request, db: SupabaseClient): Promise<boolean> {
  const wew = req.headers.get('x-internal-key')
  if (!wew) return false
  if (!kluczWewnetrzny) {
    const { data } = await db.rpc('klucz_wewnetrzny')
    kluczWewnetrzny = typeof data === 'string' ? data : null
  }
  return !!kluczWewnetrzny && wew === kluczWewnetrzny
}

async function bl(token: string, method: string, parameters: Record<string, unknown>): Promise<Record<string, unknown>> {
  const form = new URLSearchParams({ method, parameters: JSON.stringify(parameters) })
  const res = await fetch(BL_URL, {
    method: 'POST',
    headers: { 'X-BLToken': token, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  const txt = await res.text()
  let j: Record<string, unknown>
  try { j = JSON.parse(txt) } catch { throw new Error(`Baselinker ${method}: HTTP ${res.status}, odpowiedź nie jest JSON`) }
  if (j.status !== 'SUCCESS') throw new Error(`Baselinker ${method}: ${j.error_code ?? res.status} ${j.error_message ?? ''}`.trim())
  return j
}

async function ustaw(db: SupabaseClient, klucz: string, wartosc: string, opis: string) {
  await db.from('ustawienia').upsert({ klucz, wartosc, opis, updated_at: new Date().toISOString() }, { onConflict: 'klucz' })
}

async function zapiszWynik(db: SupabaseClient, wynik: unknown, blad: string | null) {
  await ustaw(db, 'bl_sync_ostatni_at', new Date().toISOString(), 'Ostatni przebieg crm-bl-sync (sync)')
  if (wynik) await ustaw(db, 'bl_sync_ostatni_wynik', JSON.stringify(wynik), 'Wynik ostatniego udanego przebiegu crm-bl-sync')
  await ustaw(db, 'bl_sync_ostatni_blad', blad ?? '', 'Błąd ostatniego przebiegu crm-bl-sync (puste = OK)')
}

async function poczatekOkna(db: SupabaseClient): Promise<number> {
  const { data } = await db.from('ustawienia').select('wartosc').eq('klucz', 'bl_sync_od').maybeSingle()
  const odUstawien = Date.parse(String(data?.wartosc ?? '2026-11-01') + 'T00:00:00+01:00')
  const okno = Date.now() - OKNO_DNI * 86400_000
  return Math.floor(Math.max(Number.isFinite(odUstawien) ? odUstawien : 0, okno) / 1000)
}

async function synchronizujStatusy(db: SupabaseClient, token: string): Promise<number> {
  const r = await bl(token, 'getOrderStatusList', {})
  const lista = (r.statuses as Array<{ id: number; name: string; name_for_customer?: string; color?: string }> | undefined) ?? []
  if (lista.length === 0) return 0
  const teraz = new Date().toISOString()
  const { error } = await db.from('bl_statusy').upsert(
    lista.map((s, i) => ({ id: s.id, nazwa: s.name, nazwa_klient: s.name_for_customer ?? null, kolor: s.color ?? null, kolejnosc: i, synced_at: teraz })),
    { onConflict: 'id' },
  )
  if (error) throw new Error('Zapis statusów: ' + error.message)
  return lista.length
}

async function synchronizujPolaDodatkowe(db: SupabaseClient, token: string) {
  try {
    const r = await bl(token, 'getOrderExtraFields', {})
    const pola = (r.extra_fields as Array<{ extra_field_id: number; name: string }> | undefined) ?? []
    const mapa: Record<string, string> = {}
    for (const p of pola) mapa[String(p.extra_field_id)] = p.name
    await ustaw(db, 'bl_pola_dodatkowe', JSON.stringify(mapa), 'Nazwy pól dodatkowych zamówień Baselinkera (id → nazwa), z crm-bl-sync')
  } catch {
    // nazwy pól są tylko do wyświetlania — brak nie zatrzymuje synchronizacji
  }
}

const txt = (v: unknown): string | null => {
  const s = v == null ? '' : String(v).trim()
  return s === '' || s === '-' ? null : s
}
const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const dataUnix = (v: unknown): string | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null
}

function wiersz(z: BlZamowienie) {
  const produkty = z.products ?? []
  const suma = produkty.reduce((s, p) => s + (Number(p.price_brutto) || 0) * (Number(p.quantity) || 0), 0)
  const dostawa = Number(z.delivery_price) || 0
  const punkt = [txt(z.delivery_point_name), txt(z.delivery_point_address), txt(z.delivery_point_city)].filter(Boolean).join(', ')
  return {
    bl_id: Number(z.order_id),
    shop_order_id: txt(z.shop_order_id),
    zrodlo: txt(z.order_source),
    status_id: num(z.order_status_id),
    potwierdzone: z.confirmed !== false,
    data_zlozenia: dataUnix(z.date_add),
    data_potwierdzenia: dataUnix(z.date_confirmed),
    data_statusu: dataUnix(z.date_in_status),
    klient: txt(z.delivery_fullname) ?? txt(z.invoice_fullname) ?? txt(z.user_login),
    firma: txt(z.invoice_company) ?? txt(z.delivery_company),
    email: txt(z.email),
    telefon: txt(z.phone),
    adres: txt(z.delivery_address),
    kod: txt(z.delivery_postcode),
    miasto: txt(z.delivery_city),
    dostawa_metoda: txt(z.delivery_method),
    dostawa_cena: dostawa,
    paczka_nr: txt(z.delivery_package_nr),
    punkt_odbioru: punkt || null,
    platnosc_metoda: txt(z.payment_method),
    pobranie: String(z.payment_method_cod ?? '0') === '1',
    oplacone: num(z.payment_done),
    kwota: Math.round((suma + dostawa) * 100) / 100,
    waluta: txt(z.currency) ?? 'PLN',
    pozycje: produkty.map((p) => ({
      nazwa: p.name ?? '', atrybuty: txt(p.attributes), sku: txt(p.sku), ilosc: Number(p.quantity) || 0,
      cena: Number(p.price_brutto) || 0, product_id: txt(p.product_id), order_product_id: p.order_product_id ?? null,
    })),
    uwagi_klienta: txt(z.user_comments),
    uwagi_sklepu: txt(z.admin_comments),
    pola_dodatkowe: z.custom_extra_fields && typeof z.custom_extra_fields === 'object' && !Array.isArray(z.custom_extra_fields) ? z.custom_extra_fields : {},
    strona_klienta: txt(z.order_page),
    surowe: z,
    synced_at: new Date().toISOString(),
  }
}

// Upsert zamówień; nowym (pierwszy raz w CRM) przypina klienta po telefonie / mailu, jeśli już jest w CRM.
async function zapiszZamowienia(db: SupabaseClient, zam: BlZamowienie[]): Promise<{ zapisane: number; nowe: number }> {
  if (zam.length === 0) return { zapisane: 0, nowe: 0 }
  const ids = zam.map((z) => Number(z.order_id))
  const { data: istn } = await db.from('zamowienia_sklep').select('bl_id').in('bl_id', ids)
  const byly = new Set((istn ?? []).map((r: { bl_id: number }) => Number(r.bl_id)))
  const wiersze = zam.map(wiersz)
  const { error } = await db.from('zamowienia_sklep').upsert(wiersze, { onConflict: 'bl_id' })
  if (error) throw new Error('Zapis zamówień: ' + error.message)
  let nowe = 0
  for (const w of wiersze) {
    if (byly.has(w.bl_id)) continue
    nowe++
    if (!w.email && !w.telefon) continue
    const { data: tel } = await db.rpc('telefon_e164', { p: w.telefon ?? '' })
    const { data: lead } = await db.rpc('znajdz_leada', { p_email: w.email?.toLowerCase() ?? null, p_telefon: (typeof tel === 'string' ? tel : null) ?? w.telefon })
    const l = Array.isArray(lead) ? (lead[0] as { id: string; powod: string } | undefined) : undefined
    if (l && ['telefon', 'email', 'inne_kontakty'].includes(l.powod)) {
      await db.from('zamowienia_sklep').update({ lead_id: l.id }).eq('bl_id', w.bl_id)
    }
  }
  return { zapisane: wiersze.length, nowe }
}

// Otwarte zlecenia KR Po Drzwi z numerem BL, których zamówienie nie odświeżyło się w tym przebiegu (spoza okna dat):
// getOrders po order_id, najwyżej MAX_DOCIAGNIETYCH na przebieg.
async function dociagnijOtwarte(db: SupabaseClient, token: string): Promise<number> {
  const { data: zl, error } = await db.schema('public').from('orders').select('company, client_order_number, extra_fields')
    .is('release_date', null).or('company.ilike.%PO%DRZWI%,company.ilike.%PODRZWI%').limit(1000)
  if (error || !zl) return 0
  const ids = new Set<number>()
  for (const o of zl as Array<{ client_order_number: string | null; extra_fields: Record<string, unknown> | null }>) {
    if (o.extra_fields && o.extra_fields.cancelled === true) continue
    const m = /^\s*(\d{8})(\D|$)/.exec(o.client_order_number ?? '')
    if (m) ids.add(Number(m[1]))
  }
  if (ids.size === 0) return 0
  const swiezo = new Date(Date.now() - 10 * 60_000).toISOString()
  const { data: sa } = await db.from('zamowienia_sklep').select('bl_id').in('bl_id', [...ids]).gte('synced_at', swiezo)
  for (const r of (sa ?? []) as Array<{ bl_id: number }>) ids.delete(Number(r.bl_id))
  let n = 0
  for (const id of [...ids].slice(0, MAX_DOCIAGNIETYCH)) {
    const r = await bl(token, 'getOrders', { order_id: id, get_unconfirmed_orders: true, include_custom_extra_fields: true })
    const zam = (r.orders as BlZamowienie[] | undefined) ?? []
    if (zam.length) { await zapiszZamowienia(db, zam); n++ }
  }
  return n
}

type BlPaczka = {
  package_id?: number; courier_package_nr?: string; courier_code?: string; courier_other_name?: string
  tracking_status?: number; tracking_status_date?: number; is_return?: boolean
}

async function zapiszPaczki(db: SupabaseClient, token: string, blId: number) {
  const r = await bl(token, 'getOrderPackages', { order_id: blId })
  const lista = ((r.packages as BlPaczka[] | undefined) ?? []).map((p) => ({
    nr: txt(p.courier_package_nr),
    kurier: txt(p.courier_other_name) ?? txt(p.courier_code),
    status: num(p.tracking_status) ?? 0,
    status_at: dataUnix(p.tracking_status_date),
    zwrot: p.is_return === true,
  }))
  const { error } = await db.from('zamowienia_sklep').update({ paczki: lista, paczki_at: new Date().toISOString() }).eq('bl_id', blId)
  if (error) throw new Error('Zapis przesyłek: ' + error.message)
}

// Zamówienia z numerem paczki, których przesyłki nie były sprawdzane od godziny i nie są jeszcze doręczone / zwrócone.
async function odswiezPaczki(db: SupabaseClient, token: string): Promise<number> {
  const godzine = new Date(Date.now() - 55 * 60_000).toISOString()
  const { data, error } = await db.from('zamowienia_sklep').select('bl_id, paczki, paczki_at')
    .not('paczka_nr', 'is', null).or(`paczki_at.is.null,paczki_at.lt.${godzine}`)
    .order('data_zlozenia', { ascending: false }).limit(300)
  if (error || !data) return 0
  const doSprawdzenia = (data as Array<{ bl_id: number; paczki: Array<{ status: number }> | null; paczki_at: string | null }>)
    .filter((z) => !z.paczki_at || !(z.paczki ?? []).length || (z.paczki ?? []).some((p) => !PACZKA_KONIEC.has(Number(p.status))))
    .slice(0, MAX_PACZEK)
  for (const z of doSprawdzenia) await zapiszPaczki(db, token, Number(z.bl_id))
  return doSprawdzenia.length
}

// --------------------------------------------------------------------------------------------
// Przesyłka SUUS dla wysyłki z ekranu „Wysyłki kurierem” (27.11, Tymek): tylko założenie przesyłki w Baselinkerze —
// statusy, maile do klienta i etykieta (mail do magazynu) dzieją się w BL automatycznie, list przewozowy z portalu SUUS.
// Ustalenia: każda paleta osobno, waga 100 kg, paleta jednorazowa (JED), pionowa 120×80×220, pozioma 210×100×50;
// ubezpieczenie zawsze na kwotę zamówienia; pobranie, gdy w BL zaznaczone pobranie: kwota − wpłacone.
// Wejście: { akcja: 'przesylka', shipment_id } (z bazy: rpc zlec_przesylke_bl przez pg_net) albo
// { akcja: 'przesylka', dry_run: true, symulacja: { bl_order_id, ship_date, delivery_date?, pallets_vertical, pallets_horizontal, notes? } }
// — składa zlecenie bez wysyłania (test).
const SUUS_KOD = 'rohligsuus'
const SUUS_KONTO = 37840
const PALETA_WAGA = 100
const PALETA_RODZAJ = 'JED'
const PALETA_PION = { size_length: 120, size_width: 80, size_height: 220 }
const PALETA_POZIOM = { size_length: 210, size_width: 100, size_height: 50 }

type Wysylka = {
  id: number; bl_order_id: number | null; ship_date: string | null; delivery_date: string | null
  pallets_vertical: number; pallets_horizontal: number; notes: string | null; bl_package_id: string | null; status: string
}

/** RRRR-MM-DD + n dni roboczych (bez sobót i niedziel). */
function plusDniRobocze(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  let dodane = 0
  while (dodane < n) {
    d.setUTCDate(d.getUTCDate() + 1)
    const dz = d.getUTCDay()
    if (dz !== 0 && dz !== 6) dodane++
  }
  return d.toISOString().slice(0, 10)
}
/** Data → znacznik czasu dla pól typu „date” w BL (10:00 UTC tego dnia). */
const znacznik = (iso: string) => Math.floor(Date.parse(iso + 'T10:00:00Z') / 1000)

async function przesylka(db: SupabaseClient, token: string, body: Record<string, unknown>) {
  const pub = db.schema('public')
  const dryRun = body.dry_run === true
  let s: Wysylka
  if (dryRun && body.symulacja && typeof body.symulacja === 'object') {
    const x = body.symulacja as Record<string, unknown>
    s = {
      id: 0, bl_order_id: Number(x.bl_order_id) || null, ship_date: String(x.ship_date ?? '') || null, delivery_date: (x.delivery_date as string) ?? null,
      pallets_vertical: Number(x.pallets_vertical) || 0, pallets_horizontal: Number(x.pallets_horizontal) || 0, notes: (x.notes as string) ?? null,
      bl_package_id: null, status: 'zaplanowana',
    }
  } else {
    const id = Number(body.shipment_id)
    if (!Number.isFinite(id) || id <= 0) throw new Error('Podaj shipment_id')
    const { data, error } = await pub.from('order_shipments').select('id, bl_order_id, ship_date, delivery_date, pallets_vertical, pallets_horizontal, notes, bl_package_id, status').eq('id', id).maybeSingle()
    if (error || !data) throw new Error('Nie ma wysyłki ' + id)
    s = data as Wysylka
    if (s.bl_package_id) return { ok: true, juz_jest: true, bl_package_id: s.bl_package_id }
  }
  const blad = async (msg: string, req?: unknown) => {
    if (!dryRun && s.id) await pub.from('order_shipments').update({ bl_status: 'blad', bl_error: msg.slice(0, 500), ...(req ? { bl_request: req } : {}) }).eq('id', s.id)
    return { ok: false, error: msg }
  }
  if (!s.bl_order_id) return await blad('Brak numeru zamówienia BaseLinker — przesyłkę załóż ręcznie w BL')
  if (!s.ship_date) return await blad('Brak daty wysyłki')
  const palety = [
    ...Array.from({ length: Math.max(0, s.pallets_vertical) }, () => ({ weight: PALETA_WAGA, ...PALETA_PION, parcel_type: PALETA_RODZAJ })),
    ...Array.from({ length: Math.max(0, s.pallets_horizontal) }, () => ({ weight: PALETA_WAGA, ...PALETA_POZIOM, parcel_type: PALETA_RODZAJ })),
  ]
  if (palety.length === 0) return await blad('Wysyłka bez palet — dodaj co najmniej jedną paletę')

  const r = await bl(token, 'getOrders', { order_id: s.bl_order_id, get_unconfirmed_orders: true })
  const z = ((r.orders as BlZamowienie[] | undefined) ?? [])[0]
  if (!z) return await blad(`Nie ma zamówienia ${s.bl_order_id} w Baselinkerze`)
  const suma = Math.round(((z.products ?? []).reduce((a, p) => a + (Number(p.price_brutto) || 0) * (Number(p.quantity) || 0), 0) + (Number(z.delivery_price) || 0)) * 100) / 100
  const wplacone = Number(z.payment_done) || 0
  const pobranie = String(z.payment_method_cod ?? '0') === '1' ? Math.max(0, Math.round((suma - wplacone) * 100) / 100) : 0
  const doreczenie = s.delivery_date || plusDniRobocze(s.ship_date, 2)

  const fields: Array<{ id: string; value: unknown }> = [
    { id: 'package_type', value: PALETA_RODZAJ },
    { id: 'insurance', value: suma },
    { id: 'pickup_date', value: znacznik(s.ship_date) },
    { id: 'dropoff_date', value: znacznik(doreczenie) },
    { id: 'reference_number', value: `PD-WYS-${s.id || 'TEST'}` },
    { id: 'package_description', value: 'Drzwi' },
  ]
  if (pobranie > 0) fields.push({ id: 'cod', value: pobranie })
  if (s.notes && s.notes.trim()) fields.push({ id: 'package_remarks', value: s.notes.trim().slice(0, 200) })
  const req = { order_id: s.bl_order_id, courier_code: SUUS_KOD, account_id: SUUS_KONTO, fields, packages: palety }
  if (dryRun) return { ok: true, dry_run: true, zamowienie: { suma, wplacone, pobranie_zaznaczone: String(z.payment_method_cod ?? '0') === '1', doreczenie }, request: req }

  try {
    const w = await bl(token, 'createPackage', req)
    const { error } = await pub.from('order_shipments').update({
      bl_package_id: String(w.package_id ?? ''), bl_package_number: String(w.package_number ?? w.courier_inner_number ?? ''),
      bl_status: 'utworzona', bl_error: null, bl_created_at: new Date().toISOString(), bl_request: req, delivery_date: doreczenie,
    }).eq('id', s.id)
    if (error) throw new Error('Przesyłka założona w BL, ale nie zapisano numeru: ' + error.message)
    return { ok: true, bl_package_id: w.package_id, bl_package_number: w.package_number }
  } catch (e) {
    return await blad(e instanceof Error ? e.message : String(e), req)
  }
}
