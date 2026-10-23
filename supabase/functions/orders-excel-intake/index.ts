import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'

// =====================================================================
// orders-excel-intake
// Przyjmuje "excelowy" JSON (zamówienia wprowadzane ręcznie/przez formularz,
// przechwytywane w drodze do Excela) i wstawia je do systemu.
// Inny kształt niż konfigurator (orders-intake). Akceptuje pojedynczy
// obiekt albo tablicę obiektów.
// =====================================================================

export const safeJsonParse = (text: string): unknown => {
  try { return JSON.parse(text) } catch { return null }
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  })

// ---- Mapowania -------------------------------------------------------

// Systemy Titana (CORE/GUARD RC2/RC3 — 'GUARD RC3' łapie też 'GUARD RC3 EI 30')
export const isTitanSystem = (system: unknown): boolean => {
  const u = String(system ?? '').toUpperCase()
  return u.includes('CORE') || u.includes('GUARD RC2') || u.includes('GUARD RC3')
}

// Systemy Bastiona (poki co): BASIC / BASIC PLUS / BASIC LOCK PLUS / PREMIUM /
// PREMIUM RC2 / BOLD / BOLD PLUS / SILENT. Dopasowanie po słowie kluczowym
// (łapie warianty: 'BASIC LOCK PLUS', 'PREMIUM RC2', 'BOLD PLUS').
export const BASTION_SYSTEM_KEYWORDS = ['BASIC', 'PREMIUM', 'BOLD', 'SILENT']
export const isBastionSystem = (system: unknown): boolean => {
  const u = String(system ?? '').toUpperCase()
  return BASTION_SYSTEM_KEYWORDS.some((k) => u.includes(k))
}

// Kategoria z pola "System":
//  - CORE/GUARD (Titan) → STA (baza; potem dorabiane nogi ST+Bastion przez createTitanLegs)
//  - DISTING* → Disting
//  - TECHNIC* → Techniczne
//  - ST* (ST68/ST72…) = stalowe → ST
//  - reszta (NORMAL/BASIC…) → STA
export const determineCategory = (system: string): string => {
  const s = system.trim().toUpperCase()
  if (isTitanSystem(s)) return 'STA'
  if (s.includes('DISTING')) return 'Disting'
  if (s.includes('TECHNIC')) return 'Techniczne'
  if (isBastionSystem(s)) return 'Bastion'
  if (s.startsWith('ST')) return 'ST'
  return 'STA'
}

// "Typ" → firma fakturująca (wykonawca).
// CD/CA/C* oraz KR = Center; PD/P*/MR = Profil; WZ/W*/Z* = WZ.
export const typToWykonawca = (typ: string): string => {
  const t = typ.trim().toUpperCase()
  if (!t) return ''
  if (t === 'KR' || t.startsWith('C')) return 'Center'
  // MR = MR Profil (bot mapuje tak samo w orders-intake) — brak tej gałęzi
  // zostawił 242 Bastiony bez wykonawcy
  if (t === 'MR' || t.startsWith('P')) return 'Profil'
  if (t.startsWith('W') || t.startsWith('Z')) return 'WZ'
  return ''
}

// Wymiar "S×W" tylko gdy są obie wartości (albo pojedyncza jeśli jedna)
export const combineDim = (w: string, h: string): string => {
  const ww = w.trim(); const hh = h.trim()
  if (ww && hh) return `${ww}×${hh}`
  return ww || hh || ''
}

// #57: normalizacja zaczepu do słownika (BRAK/MECHANICZNY/ELEKTROZACZEP);
// arkusz/konfigurator wysyła "Nie" gdy zaczepu brak, historyczne "Tak" = elektrozaczep
export const normalizeZaczep = (raw: string): string => {
  const u = raw.trim().toUpperCase()
  if (u === 'NIE') return 'BRAK'
  if (u === 'TAK') return 'ELEKTROZACZEP'
  return raw
}

export const emptyStagesFor = (category: string): Record<string, string> => {
  // Mirrory Disting Plus są ASYMETRYCZNE (spójnie z aplikacją):
  // STA trzyma dist_* (podgląd ościeżnicy), Disting trzyma sta_e3/sta_e4 (podgląd skrzydła).
  if (category === 'STA') {
    return { e1: '', e2_1: '', e2_2: '', e3: '', e4: '', e5: '', dist_e1: '', dist_e2_1: '', dist_e2_2: '', dist_e5: '' }
  }
  if (category === 'Disting') {
    return { e1: '', e2_1: '', e2_2: '', e3: '', e4: '', e5: '', sta_e3: '', sta_e4: '' }
  }
  if (category === 'ST') {
    return { cnc: '', osc: '', skr: '', mon: '', mag: '', e1: '', e2: '', e3: '', e4: '', sta_e5: '' }
  }
  if (category === 'Bastion') {
    return {
      cnc: '', okleinowanie_skrzydla: '', okuwanie_skrzydla: '', oscieznica_cnc: '', oscieznica_skrecanie: '',
      magazyn_kontrola: '', stolarnia: '', magazyn_regulowana: '', regulowana_do_zlozenia: '',
    }
  }
  return {}
}

// Rezerwacja magazynowa po utworzeniu zlecenia (best-effort — błąd nie blokuje intake'u).
// Frontend robi to samo po ręcznym zapisie; guard w RPC chroni przed dublem.
const reserveStock = async (supabase: any, orderId: number): Promise<void> => {
  try {
    const { error } = await supabase.rpc('reserve_stock_for_order', { p_order_id: orderId })
    if (error) console.error(`reserve_stock_for_order(${orderId}):`, error.message)
  } catch (e) {
    console.error(`reserve_stock_for_order(${orderId}):`, e)
  }
}

// STA Titan → dorób ST (ościeżnica) + Bastion (skrzydło do okuwania). Grupa w extra_fields.titan_group.
const createTitanLegs = async (supabase: any, orderId: number): Promise<void> => {
  const { data: base, error } = await supabase.from('orders').select('*').eq('id', orderId).single()
  if (error || !base) return
  if (!isTitanSystem(base.system)) return
  if (String(base.category) !== 'STA') return
  const ef = (base.extra_fields && typeof base.extra_fields === 'object') ? base.extra_fields as Record<string, unknown> : {}
  if (ef.titan_group) return // już rozbite

  const staId = base.id
  const group = staId
  const { id, created_at, updated_at, ...rest } = base as Record<string, unknown>

  // ST (ościeżnica)
  const stNr = await nextOrderNumber(supabase, 'ST')
  const stPayload = {
    ...rest, order_number: stNr, category: 'ST', airtable_id: '', linked_order_id: staId,
    sta_ref: String(base.order_number ?? ''), st_sheet: '', release_date: null,
    production_stages: emptyStagesFor('ST'), extra_fields: { ...ef, titan_group: group, titan_role: 'ST' },
  }
  const { row: stRow, error: stErr } = await insertOrderWithNumberRetry(supabase, stPayload, 'ST')
  if (stErr) console.error('titan ST leg failed:', stErr)
  if (stRow) await reserveStock(supabase, Number(stRow.id))

  // Bastion (skrzydło do okuwania)
  const bNr = await nextOrderNumber(supabase, 'Bastion')
  const bPayload = {
    ...rest, order_number: bNr, category: 'Bastion', airtable_id: '', linked_order_id: null, release_date: null,
    production_stages: emptyStagesFor('Bastion'), extra_fields: { ...ef, titan_group: group, titan_role: 'Bastion' },
  }
  const { row: bRow, error: bErr } = await insertOrderWithNumberRetry(supabase, bPayload, 'Bastion')
  if (bErr) console.error('titan Bastion leg failed:', bErr)
  if (bRow) await reserveStock(supabase, Number(bRow.id))

  // dopnij linki na STA
  const upd: Record<string, unknown> = { extra_fields: { ...ef, titan_group: group, titan_role: 'STA' } }
  if (stRow) { upd.linked_order_id = stRow.id; upd.st_sheet = stRow.order_number }
  await supabase.from('orders').update(upd).eq('id', staId)
}

const todayISO = (): string => new Date().toISOString().split('T')[0]

// Mapuje pojedynczy wiersz excelowego JSON-a na payload zamówienia.
// Zwraca null jeśli brak kluczowych danych (firma + system).
export const mapExcelRow = (row: Record<string, unknown>): Record<string, unknown> | null => {
  const get = (k: string) => String(row[k] ?? '').trim()
  // „-” / „undefined” w uwagach = brak uwag (w tabeli wyglądało jak wpisana uwaga)
  const note = (k: string) => (/^(-+|undefined|null|none)$/i.test(get(k)) ? '' : get(k))

  const company = get('Nazwa firmy')
  const system = get('System')
  if (!company && !system) return null

  const category = determineCategory(system)
  const wykonawca = typToWykonawca(get('Typ'))

  const qtyNum = parseInt(get('Ilość'), 10)
  const quantity = Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 1

  const extra_fields: Record<string, unknown> = {}
  if (wykonawca) extra_fields.wykonawca = wykonawca
  const typRaw = get('Typ')
  if (typRaw) extra_fields.typ = typRaw

  // Bastion ma dwukolorowe skrzydło/ościeżnicę (WF = strona wewnętrzna) oraz
  // poszerzenia boczne — trzymamy w extra_fields (brak dedykowanych kolumn).
  const wingWf = get('Kolor skrzydła WF')
  const frameWf = get('Kolor ościeżnicy WF')
  const poszerzeniaBoczne = get('Poszerzenia boczne')
  if (wingWf) extra_fields.kolor_skrzydla_wf = wingWf
  if (frameWf) extra_fields.kolor_oscieznicy_wf = frameWf
  if (poszerzeniaBoczne) extra_fields.poszerzenia_boczne = poszerzeniaBoczne

  // Bastion → dedykowane kolumny tabeli (ościeżnica/regulacja/uwagi 2)
  const bastionCols: Record<string, unknown> =
    category === 'Bastion'
      ? {
          bastion_frame_type: get('Ościeżnica'),
          bastion_frame_range: get('Regulacja ościeżnicy'),
          bastion_notes_2: note('Uwagi 2'),
          bastion_collection: system,
          // Panel boczny/górny (wykończenie) — format "SZER×WYS"
          bastion_side_panel_k: get('Panel boczny klamkowy') || get('Panel boczny'),
          bastion_side_panel_p: get('Panel boczny przeciwklamkowy'),
          bastion_top_panel: get('Panel górny'),
        }
      : {}

  const zaczepValue = normalizeZaczep(get('Elektrozaczep'))

  return {
    order_number: get('Numer zlecenia'),
    company,
    order_date: todayISO(),
    production_day: get('Produkcja'),
    quantity,
    sequence: '',
    system,
    model: get('Model'),
    // ST: pojedyncze "Kolor"; STA/Disting: "Kolor skrzydła"/"Kolor ościeżnicy";
    // Bastion: "Kolor skrzydła cał."/"Kolor ościeżnicy cał." (cał. = strona zewn.)
    wing_color: get('Kolor skrzydła cał.') || get('Kolor skrzydła') || get('Kolor'),
    frame_color: get('Kolor ościeżnicy cał.') || get('Kolor ościeżnicy'),
    threshold_color: get('Kolor progu'),
    width: get('Szerokość'),
    direction: get('Kierunek'),
    opening: get('Otwieranie'),
    height: get('Wysokość'),
    glazing: get('Szklenie'),
    decorative_panel: get('Panel dekoracyjny'),
    hardware: get('Okucia'),
    handle: get('Pochwyt'),
    electric_strike: zaczepValue,
    zaczep: zaczepValue,
    peephole: get('Wizjer'),
    oslonki: get('Oslonki'),
    wentylacja: get('Wentylacja'),
    top_light: combineDim(get('Szerokość naświetla'), get('Wysokość naświetla')),
    top_light_glazing: get('Szklenie naświetla'),
    // Dostawka — obsługa obu kształtów: pojedyncza ("Szerokość dostawki")
    // oraz osobne boki A/B ("Szerokość dostawki bocznej A/B"), wspólna wysokość/szklenie.
    // Dostawka istnieje TYLKO gdy ma szerokość — sama wysokość (wspólna kolumna)
    // nie może tworzyć "dostawki-widmo" (bug znaleziony testem).
    side_panel: get('Szerokość dostawki') ? combineDim(get('Szerokość dostawki'), get('Wysokość dostawki')) : '',
    side_panel_glazing: get('Szklenie dostawki'),
    side_panel_a: get('Szerokość dostawki bocznej A')
      ? combineDim(get('Szerokość dostawki bocznej A'), get('Wysokość dostawki'))
      : '',
    side_panel_b: get('Szerokość dostawki bocznej B')
      ? combineDim(get('Szerokość dostawki bocznej B'), get('Wysokość dostawki'))
      : '',
    side_panel_a_glazing: get('Szerokość dostawki bocznej A') ? get('Szklenie dostawki') : '',
    side_panel_b_glazing: get('Szerokość dostawki bocznej B') ? get('Szklenie dostawki') : '',
    extension: get('Poszerzenie'),
    notes: note('Uwagi'),
    client_order_number: get('Numer zamówienia'),
    // Rodzaj intarsji (tylko Titan): 'INTARSJA JEDNOSTRONNA'/'jednostronna' → 'JEDNOSTRONNA'
    intarsja: (get('Rodzaj intarsji') || get('Intarsja')).toUpperCase().replace(/INTARSJA/g, '').trim(),
    // Kto wpisał zamówienie — kolumna "Wpisał" w arkuszu (warianty nazw);
    // formularz bota powinien ustawiać np. "Konfigurator". Puste = brak info.
    entered_by: get('Wpisał') || get('Wpisal') || get('Operator') || get('Handlowiec'),
    category,
    source: 'excel',
    airtable_id: '',
    production_stages: emptyStagesFor(category),
    extra_fields,
    ...bastionCols,
  }
}

// ---- Dedup krzyżowy bot↔excel ---------------------------------------
// Gałąź Make dopisuje zamówienia konfiguratora TAKŻE do Excela (arkusz musi
// je mieć — pracują z niego handlowcy), więc to samo zamówienie wchodziłoby
// do bazy drugi raz przy imporcie. Wiersz pomijamy, gdy istnieje świeże
// zlecenie z bota o tym samym numerze zamówienia klienta + firmie + kategorii.

// Numer klienta nadający się do porównania: min. 3 znaki i choć jedna
// litera/cyfra (odpada '-', '—', puste)
export const isComparableClientNumber = (value: unknown): boolean => {
  const n = String(value ?? '').trim().toUpperCase()
  return n.length >= 3 && /[A-Z0-9]/.test(n)
}

const BOT_TWIN_WINDOW_DAYS = 21

// Firmy z dwóch kanałów bywają zapisane różnie: bot dostaje nazwę kontrahenta
// ze słownika aliasów ('PO DRZWI'), excel surową z arkusza ('PO DRZWI ŻORY').
// Pasują, gdy są równe albo wszystkie słowa krótszej zawierają się w dłuższej.
export const companiesMatch = (a: unknown, b: unknown): boolean => {
  const tokens = (v: unknown): string[] =>
    String(v ?? '').trim().toUpperCase().split(/[\s#,]+/).filter(Boolean)
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.length === 0 || tb.length === 0) return false
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  return shorter.every((t) => longer.includes(t))
}

const findBotTwin = async (
  supabase: any,
  payload: Record<string, unknown>,
): Promise<{ id: number; order_number: string } | null> => {
  const clientNo = String(payload.client_order_number ?? '').trim().toUpperCase()
  const company = String(payload.company ?? '').trim().toUpperCase()
  if (!isComparableClientNumber(clientNo) || !company) return null

  const since = new Date(Date.now() - BOT_TWIN_WINDOW_DAYS * 86400 * 1000).toISOString()
  const { data } = await supabase
    .from('orders')
    .select('id, order_number, company, client_order_number')
    .eq('category', String(payload.category ?? ''))
    .eq('source', 'bot')
    .gte('created_at', since)
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    if (
      companiesMatch(row.company, company) &&
      String(row.client_order_number ?? '').trim().toUpperCase() === clientNo
    ) {
      return { id: Number(row.id), order_number: String(row.order_number ?? '') }
    }
  }
  return null
}

// ---- Auto-parowanie DISTING PLUS (jedno zlecenie → para STA+Disting) ----

// Numer z RPC (SQL, bez limitu 1000 wierszy PostgREST). Stary wariant liczył
// MAX z obciętego tysiąca — stąd duble typu STA 2388 dla każdej pary DISTING PLUS.
const nextOrderNumber = async (supabase: any, category: string): Promise<string> => {
  const { data, error } = await supabase.rpc('get_next_order_number', { p_category: category })
  if (error || !data) throw new Error(`get_next_order_number(${category}): ${error?.message ?? 'brak danych'}`)
  return String(data)
}

// Kolizja unikalnego numeru (kategoria, numer) — get_next_order_number to MAX+1
// bez rezerwacji, więc równoległe wiersze z Make dostają ten sam numer.
export const isOrderNumberCollision = (err: { code?: string; message?: string } | null | undefined): boolean =>
  !!err && (err.code === '23505' || /orders_unique_number_per_category/i.test(err.message ?? ''))

const NUMBER_RETRIES = 5

// INSERT z ponowieniem przy kolizji numeru: nowy numer z RPC + krótka losowa
// pauza (rozjeżdża równoległe wywołania). onRenumber pozwala dopisać flagę
// weryfikacji, gdy numer z arkusza musiał zostać zmieniony.
const insertOrderWithNumberRetry = async (
  supabase: any,
  payload: Record<string, unknown>,
  category: string,
  onRenumber?: (oldNumber: string, newNumber: string) => void,
): Promise<{ row: Record<string, unknown> | null; error: string | null }> => {
  for (let attempt = 0; attempt < NUMBER_RETRIES; attempt++) {
    const { data, error } = await supabase.from('orders').insert([payload]).select('id, order_number, category').single()
    if (!error && data) return { row: data, error: null }
    if (!isOrderNumberCollision(error)) return { row: null, error: error?.message ?? 'insert failed' }
    await new Promise((r) => setTimeout(r, 50 + Math.floor(Math.random() * 250)))
    const oldNumber = String(payload.order_number ?? '')
    const newNumber = await nextOrderNumber(supabase, category)
    payload.order_number = newNumber
    onRenumber?.(oldNumber, newNumber)
  }
  return { row: null, error: `kolizja numeru zlecenia (${category}) — ${NUMBER_RETRIES} prób bez powodzenia` }
}

const createDistingPlusPartner = async (supabase: any, orderId: number): Promise<void> => {
  const { data: base, error } = await supabase.from('orders').select('*').eq('id', orderId).single()
  if (error || !base) return
  const sys = String(base.system ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
  if (sys !== 'DISTING PLUS') return
  if (base.linked_order_id != null) return

  const baseCat = String(base.category ?? '')
  const partnerCat = baseCat === 'Disting' ? 'STA' : baseCat === 'STA' ? 'Disting' : null
  if (!partnerCat) return

  const partnerNumber = await nextOrderNumber(supabase, partnerCat)
  const { id, created_at, updated_at, ...rest } = base as Record<string, unknown>
  const partnerPayload: Record<string, unknown> = {
    ...rest,
    order_number: partnerNumber,
    category: partnerCat,
    airtable_id: '',
    linked_order_id: base.id,
    release_date: null,
    production_stages: emptyStagesFor(partnerCat),
    disting_sheet: partnerCat === 'STA' ? String(base.order_number ?? '') : '',
    sta_sheet: partnerCat === 'Disting' ? String(base.order_number ?? '') : '',
  }
  const { row: partnerRow, error: pErr } = await insertOrderWithNumberRetry(supabase, partnerPayload, partnerCat)
  if (pErr || !partnerRow) { console.error('partner create failed:', pErr); return }

  const baseUpdate: Record<string, unknown> = { linked_order_id: partnerRow.id }
  if (baseCat === 'Disting') baseUpdate.sta_sheet = partnerRow.order_number
  else baseUpdate.disting_sheet = partnerRow.order_number
  await supabase.from('orders').update(baseUpdate).eq('id', base.id)

  await reserveStock(supabase, Number(partnerRow.id))
}

// ---- HTTP ------------------------------------------------------------

serve(async (req) => {
  const startTime = Date.now()
  if (req.method === 'OPTIONS') return jsonResponse({}, 200)
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const apiKey = req.headers.get('x-api-key') || req.headers.get('X-API-Key')
  if (!apiKey) return jsonResponse({ error: 'Missing X-API-Key header' }, 401)

  const bodyText = await req.text()
  const parsed = safeJsonParse(bodyText)
  if (!parsed) return jsonResponse({ error: 'Invalid JSON body' }, 400)
  const rows = (Array.isArray(parsed) ? parsed : [parsed]) as Record<string, unknown>[]

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceKey)

  let apiKeyId: number | null = null
  let statusCode = 500
  let responseBody: unknown = null
  let errorMessage: string | null = null

  try {
    // 1) Weryfikacja klucza API
    const { data: verifyData, error: verifyError } = await supabase.rpc('verify_api_key', { p_raw_key: apiKey })
    if (verifyError) throw new Error(`verify_api_key error: ${verifyError.message}`)
    const verification = verifyData?.[0]
    if (!verification?.is_valid) {
      statusCode = 401; responseBody = { error: 'Invalid API key' }
      return jsonResponse(responseBody, statusCode)
    }
    apiKeyId = verification.key_id
    const rateLimit = verification.rate_limit_per_minute || 60

    // 2) Rate limit
    const { data: rateLimitOk, error: rateLimitError } = await supabase.rpc('check_rate_limit', {
      p_api_key_id: apiKeyId, p_limit: rateLimit,
    })
    if (rateLimitError) throw new Error(`check_rate_limit error: ${rateLimitError.message}`)
    if (rateLimitOk === false) {
      statusCode = 429; responseBody = { error: `Rate limit exceeded (${rateLimit}/min)` }
      return jsonResponse(responseBody, statusCode)
    }

    // 3) Przetwarzanie wierszy
    const results: Array<Record<string, unknown>> = []
    for (let i = 0; i < rows.length; i++) {
      const payload = mapExcelRow(rows[i])
      if (!payload) { results.push({ index: i, status: 'skipped', reason: 'brak firmy/systemu' }); continue }

      const orderNumber = String(payload.order_number ?? '').trim()
      const category = String(payload.category ?? '')

      // Dedup po (kategoria, numer zlecenia) — ale z porównaniem TREŚCI.
      // Sam numer to za mało: bot nadaje numery w tej samej puli co arkusz,
      // więc kolizja numeru z INNYM zamówieniem wyrzucała prawdziwe zlecenia
      // jako "duplikaty" (od 1.09 zginęło tak co najmniej 125 zamówień!).
      if (orderNumber) {
        const { data: existing } = await supabase
          .from('orders')
          .select('id, model, width, company, client_order_number')
          .eq('category', category)
          .eq('order_number', orderNumber)
          .limit(1)
        const ex = (existing ?? [])[0] as
          | { id: number; model: string | null; width: string | null; company: string | null; client_order_number: string | null }
          | undefined
        if (ex) {
          const norm = (v: unknown) => String(v ?? '').trim().toUpperCase()
          const sameContent =
            norm(ex.model) === norm(payload.model) &&
            norm(ex.width) === norm(payload.width) &&
            (companiesMatch(ex.company, payload.company) ||
              (norm(ex.client_order_number) !== '' && norm(ex.client_order_number) === norm(payload.client_order_number)))
          if (sameContent) {
            // to samo zamówienie — pomijamy jak dotąd
            results.push({ index: i, status: 'duplicate', order_number: orderNumber, category })
            continue
          }
          // KONFLIKT NUMERU: inny towar pod tym numerem — nadajemy nowy numer
          // z RPC i wstawiamy z flagą do weryfikacji, zamiast cicho wyrzucać
          const newNumber = await nextOrderNumber(supabase, category)
          payload.order_number = newNumber
          payload.extra_fields = {
            ...((payload.extra_fields as Record<string, unknown>) ?? {}),
            needs_review: true,
            warnings: [
              `Numer ${orderNumber} z arkusza był już zajęty (${norm(ex.model) || 'inne zamówienie'}) — nadano numer ${newNumber}`,
            ],
            sheet_number_conflict: orderNumber,
          }
        }
      }

      // Dedup krzyżowy: to zamówienie weszło już z konfiguratora przez API
      const botTwin = await findBotTwin(supabase, payload)
      if (botTwin) {
        results.push({
          index: i, status: 'duplicate_bot', order_number: orderNumber, category,
          bot_order_id: botTwin.id, bot_order_number: botTwin.order_number,
        })
        continue
      }

      // Kolizja w chwili zapisu (równoległy wiersz zajął numer) — nowy numer
      // + flaga weryfikacji, tak jak przy konflikcie wykrytym wyżej
      const sheetNumber = orderNumber
      const { row: inserted, error: insErr } = await insertOrderWithNumberRetry(supabase, payload, category, (_old, newNumber) => {
        const ef = (payload.extra_fields as Record<string, unknown>) ?? {}
        const prevWarnings = Array.isArray(ef.warnings) ? (ef.warnings as string[]).filter((w) => !w.startsWith(`Numer ${sheetNumber} z arkusza`)) : []
        payload.extra_fields = {
          ...ef,
          needs_review: true,
          warnings: [...prevWarnings, `Numer ${sheetNumber} z arkusza był już zajęty — nadano numer ${newNumber}`],
          sheet_number_conflict: sheetNumber,
        }
      })
      if (insErr || !inserted) {
        results.push({ index: i, status: 'error', reason: insErr ?? 'insert failed' })
        continue
      }

      // DISTING PLUS → partner; STA TITAN → ST + Bastion (best-effort)
      try { await createDistingPlusPartner(supabase, Number(inserted.id)) }
      catch (pairErr) { console.error('pairing error:', pairErr) }
      try { await createTitanLegs(supabase, Number(inserted.id)) }
      catch (titanErr) { console.error('titan legs error:', titanErr) }

      // rezerwacja magazynowa (nogi rezerwują się w helperach)
      await reserveStock(supabase, Number(inserted.id))

      results.push({ index: i, status: 'created', order_id: inserted.id, order_number: inserted.order_number, category: inserted.category })
    }

    const created = results.filter((r) => r.status === 'created').length
    const duplicates = results.filter((r) => r.status === 'duplicate').length
    const botDuplicates = results.filter((r) => r.status === 'duplicate_bot').length
    const errors = results.filter((r) => r.status === 'error').length
    // Błąd zapisu = NIE sukces: Make przy kodzie 5xx ponawia wysyłkę, a wiersze
    // już zapisane wrócą jako 'duplicate' (dedup po treści) — nic się nie zdubluje.
    // Wcześniej 200 + success:true chowało odrzucone wiersze (19.10: 18 zamówień).
    statusCode = errors > 0 ? 500 : 200
    responseBody = {
      success: errors === 0,
      summary: { received: rows.length, created, duplicates, bot_duplicates: botDuplicates, errors },
      results,
    }
    if (errors > 0) errorMessage = `${errors} wiersz(y) nie zapisane`
    return jsonResponse(responseBody, statusCode)
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err)
    statusCode = 500
    responseBody = { error: 'Internal server error', detail: errorMessage }
    return jsonResponse(responseBody, statusCode)
  } finally {
    try {
      await supabase.rpc('log_api_request', {
        p_api_key_id: apiKeyId,
        p_endpoint: '/orders/excel-intake',
        p_method: 'POST',
        p_status_code: statusCode,
        p_request_body: parsed,
        p_response_body: responseBody,
        p_ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip'),
        p_user_agent: req.headers.get('user-agent'),
        p_duration_ms: Date.now() - startTime,
        p_error_message: errorMessage,
      })
    } catch (logErr) { console.error('Failed to log request:', logErr) }
  }
})
