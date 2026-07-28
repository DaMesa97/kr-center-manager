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
// CD/CA/C* oraz KR = Center; PD/P* = Profil; WZ/W*/Z* = WZ.
export const typToWykonawca = (typ: string): string => {
  const t = typ.trim().toUpperCase()
  if (!t) return ''
  if (t === 'KR' || t.startsWith('C')) return 'Center'
  if (t.startsWith('P')) return 'Profil'
  if (t.startsWith('W') || t.startsWith('Z')) return 'WZ'
  return ''
}

// Wymiar "S×W" tylko gdy są obie wartości (albo pojedyncza jeśli jedna)
export const combineDim = (w: string, h: string): string => {
  const ww = w.trim(); const hh = h.trim()
  if (ww && hh) return `${ww}×${hh}`
  return ww || hh || ''
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
  const { data: stRow } = await supabase.from('orders').insert([stPayload]).select('id, order_number').single()

  // Bastion (skrzydło do okuwania)
  const bNr = await nextOrderNumber(supabase, 'Bastion')
  const bPayload = {
    ...rest, order_number: bNr, category: 'Bastion', airtable_id: '', linked_order_id: null, release_date: null,
    production_stages: emptyStagesFor('Bastion'), extra_fields: { ...ef, titan_group: group, titan_role: 'Bastion' },
  }
  await supabase.from('orders').insert([bPayload])

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
          bastion_notes_2: get('Uwagi 2'),
          bastion_collection: system,
          // Panel boczny/górny (wykończenie) — format "SZER×WYS"
          bastion_side_panel_k: get('Panel boczny klamkowy') || get('Panel boczny'),
          bastion_side_panel_p: get('Panel boczny przeciwklamkowy'),
          bastion_top_panel: get('Panel górny'),
        }
      : {}

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
    electric_strike: get('Elektrozaczep'),
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
    notes: get('Uwagi'),
    client_order_number: get('Numer zamówienia'),
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

// ---- Auto-parowanie DISTING PLUS (jedno zlecenie → para STA+Disting) ----

const nextOrderNumber = async (supabase: any, category: string): Promise<string> => {
  const { data } = await supabase.from('orders').select('order_number').eq('category', category)
  let maxN = 0
  for (const r of data ?? []) {
    const n = Number((r as { order_number?: unknown }).order_number)
    if (Number.isFinite(n) && n > maxN) maxN = n
  }
  return String(maxN + 1)
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
  const { data: partnerRow, error: pErr } = await supabase
    .from('orders').insert([partnerPayload]).select('id, order_number').single()
  if (pErr || !partnerRow) { console.error('partner create failed:', pErr?.message); return }

  const baseUpdate: Record<string, unknown> = { linked_order_id: partnerRow.id }
  if (baseCat === 'Disting') baseUpdate.sta_sheet = partnerRow.order_number
  else baseUpdate.disting_sheet = partnerRow.order_number
  await supabase.from('orders').update(baseUpdate).eq('id', base.id)
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

      // Dedup po (kategoria, numer zlecenia) — nie wstawiamy dwa razy
      if (orderNumber) {
        const { data: existing } = await supabase
          .from('orders').select('id').eq('category', category).eq('order_number', orderNumber).limit(1)
        if (existing && existing.length > 0) {
          results.push({ index: i, status: 'duplicate', order_number: orderNumber, category })
          continue
        }
      }

      const { data: inserted, error: insErr } = await supabase
        .from('orders').insert([payload]).select('id, order_number, category').single()
      if (insErr || !inserted) {
        results.push({ index: i, status: 'error', reason: insErr?.message ?? 'insert failed' })
        continue
      }

      // DISTING PLUS → partner; STA TITAN → ST + Bastion (best-effort)
      try { await createDistingPlusPartner(supabase, Number(inserted.id)) }
      catch (pairErr) { console.error('pairing error:', pairErr) }
      try { await createTitanLegs(supabase, Number(inserted.id)) }
      catch (titanErr) { console.error('titan legs error:', titanErr) }

      results.push({ index: i, status: 'created', order_id: inserted.id, order_number: inserted.order_number, category: inserted.category })
    }

    statusCode = 200
    const created = results.filter((r) => r.status === 'created').length
    const duplicates = results.filter((r) => r.status === 'duplicate').length
    const errors = results.filter((r) => r.status === 'error').length
    responseBody = { success: true, summary: { received: rows.length, created, duplicates, errors }, results }
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
