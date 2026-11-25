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
// getOrderExtraFields) — zmiany statusów to etap 2.
// Wynik ostatniego przebiegu: crm.ustawienia bl_sync_ostatni_at / bl_sync_ostatni_wynik / bl_sync_ostatni_blad.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const JSON_H = { 'Content-Type': 'application/json' }
const odp = (status: number, dane: unknown) => new Response(JSON.stringify(dane), { status, headers: JSON_H })
const BL_URL = 'https://api.baselinker.com/connector.php'
const OKNO_DNI = 60
const MAX_STRON = 30
const MAX_DOCIAGNIETYCH = 40
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
      return odp(200, { ok: true, akcja, zapisane, znalezione: zam.length })
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
    const wynik = { ok: true, statusy, pobrane, zapisane, nowe, dociagniete, od: new Date(od * 1000).toISOString().slice(0, 10), ms: Date.now() - t0 }
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
