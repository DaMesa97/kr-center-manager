// optima-ro-import — import RO (typ 308) z Optimy (KR Center + MR Profil) do aplikacji KR Center
// body.akcja:
//   "sync" (domyślnie) – okna czasowe od kursora (optima_ro_sync_state). RO z co najmniej jednym skrzydłem/ościeżnicą
//                        drzwi wewnętrznych (bez Bastiona, bez RO z samymi drzwiami Technic) → zlecenie DrzwiWewnetrzne.
//                        Stan RO z Optimy: state 3 (zrealizowane) → release_date (zlecenie zamknięte),
//                        state 4 (anulowane) → extra_fields.cancelled. Zmiany zrobione przez import mają closed_by='optima_ro'
//                        i są cofane, gdy RO w Optimie wróci do realizacji; ręcznych zamknięć nie ruszamy.
//                        Brakujące komponenty (aktywne kartoteki) zakładane w warehouse_components ze stanem 0.
//                        Gdy komponent o tej samej tożsamości już istnieje pod innym kodem → optima_component_map.
//                        RO bez zmian od ostatniego importu (to samo 'updated', są pozycje) są pomijane.
//                        Blokada per baza (optima_sync_lock); kilka okien pobieranych równolegle (OKNA_RAZEM),
//                        dokumenty przetwarzane równolegle (POOL).
//   "kartoteki"        – pobiera kartoteki towarów do optima_items_cache (stronicowanie).
//   "probe"            – podgląd surowych RO.
// Typ towaru liczy baza: optima_items_cache.interior_type (trigger, funkcja optima_interior_type).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const BAZY: Record<string, { url: string; login: string; passEnv: string; nazwa: string }> = {
  KR: { url: "https://optima.krcenter-api.pl", login: "KRCENTER2", passEnv: "OPTIMA_KR_PASS", nazwa: "KR Center" },
  MR: { url: "https://mrprofil.krcenter-api.pl", login: "MRPROFIL", passEnv: "OPTIMA_MR_PASS", nazwa: "MR Profil" },
};
const START = "2026-01-01T00:00:00Z";
const OKNO_DNI = 0.5;
const OKNA_RAZEM = 4;
const LIMIT = 50;
const LIMIT_TOW = 300;
const BUDZET_MS = 100_000;
const BUDZET_SYNC_MS = 65_000;
const POOL = 8;
const CATEGORY = "DrzwiWewnetrzne";
const STAN_ZREALIZOWANE = 3;
const STAN_ANULOWANE = 4;
const POWOD_ANUL_RO = "RO anulowane w Optimie";
const POWOD_BRAK_POZ = "RO w Optimie nie ma już pozycji drzwi wewnętrznych";

const cf = () => ({
  "CF-Access-Client-Id": Deno.env.get("CF_ACCESS_CLIENT_ID") ?? "",
  "CF-Access-Client-Secret": Deno.env.get("CF_ACCESS_CLIENT_SECRET") ?? "",
});

async function token(baza: string) {
  const b = BAZY[baza];
  const r = await fetch(b.url + "/api/Token", {
    method: "POST",
    headers: { ...cf(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: b.login, password: Deno.env.get(b.passEnv) ?? "", grant_type: "password" }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`token ${baza} ${r.status} ${t.slice(0, 200)}`);
  const j = JSON.parse(t);
  return j.access_token ?? j.token;
}

let apiMs = 0, apiN = 0;
async function apiGet(baza: string, tok: string, path: string, qs: Record<string, string>) {
  const u = new URL(BAZY[baza].url + path);
  for (const [k, v] of Object.entries(qs)) u.searchParams.set(k, v);
  for (let proba = 0; proba < 3; proba++) {
    const t0 = Date.now();
    const r = await fetch(u, { headers: { ...cf(), Authorization: "Bearer " + tok } });
    const t = await r.text();
    apiMs += Date.now() - t0; apiN++;
    if (r.status === 404) return [];
    if (r.ok) { try { const j = JSON.parse(t); return Array.isArray(j) ? j : (j ? [j] : []); } catch { return []; } }
    if (r.status < 500 && r.status !== 429) throw new Error(`${path} ${r.status} ${t.slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, 2000 * (proba + 1)));
  }
  throw new Error(`${path} nie odpowiada`);
}

const iso = (d: Date) => d.toISOString().slice(0, 19);

async function pula<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const x = items[i++]; await fn(x); }
  });
  await Promise.all(workers);
}

// ---------- karty towarów ----------
type Info = { grupa: string | null; typ: string | null; aktywny: boolean; nazwa: string; jm: string | null };
const cacheTow = new Map<string, Info>();
const SEL = "code,group_name,is_interior,interior_type,inactive,name,unit,item_id";

function wierszTowaru(baza: string, it: any) {
  return {
    baza, code: it.code, name: it.name, group_name: it.defaultGroup ?? null, item_id: it.id, unit: it.unit ?? null,
    inactive: !!it.inactive, barcode: it.barcode || null, description: it.description || null,
    optima_updated: it.updated ?? null, fetched_at: new Date().toISOString(),
  };
}

function infoZWiersza(c: any): Info {
  let typ: string | null = c.interior_type ?? null;
  if (c.is_interior === false) typ = null;
  if (c.is_interior === true && !typ) typ = "door_accessory";
  return { grupa: c.group_name ?? null, typ, aktywny: !c.inactive, nazwa: c.name, jm: c.unit ?? null };
}

async function rozgrzejCache(baza: string, docs: any[]) {
  const kody = [...new Set(docs.flatMap((d) => (d.elements ?? []).map((e: any) => e.code)).filter(Boolean))]
    .filter((k) => !cacheTow.has(`${baza}|${k}`));
  for (let i = 0; i < kody.length; i += 200) {
    const { data } = await sb.from("optima_items_cache").select(SEL).eq("baza", baza).in("code", kody.slice(i, i + 200));
    for (const c of data ?? []) if (c.item_id != null) cacheTow.set(`${baza}|${c.code}`, infoZWiersza(c));
  }
}

async function infoTowaru(baza: string, tok: string, el: any): Promise<Info> {
  const k = `${baza}|${el.code}`;
  if (cacheTow.has(k)) return cacheTow.get(k)!;
  let { data: c } = await sb.from("optima_items_cache").select(SEL).eq("baza", baza).eq("code", el.code).maybeSingle();
  if (!c || c.item_id == null) {
    let it: any = null;
    try { it = (await apiGet(baza, tok, "/api/Items/0", { "itemFilter.id": String(el.itemId) }))[0] ?? null; } catch (_) { it = null; }
    const w = it ? wierszTowaru(baza, it) : { baza, code: el.code, name: el.name };
    await sb.from("optima_items_cache").upsert(w, { onConflict: "baza,code" });
    ({ data: c } = await sb.from("optima_items_cache").select(SEL).eq("baza", baza).eq("code", el.code).maybeSingle());
  }
  const i = infoZWiersza(c ?? { name: el.name });
  cacheTow.set(k, i);
  return i;
}

async function kartoteki(baza: string, startMs: number) {
  const { data: st } = await sb.from("optima_items_scan").select("*").eq("baza", baza).maybeSingle();
  let offset = st?.next_offset ?? 0;
  if (st?.done) return { baza, done: true, offset };
  const tok = await token(baza);
  let zapisane = 0, done = false;
  while (Date.now() - startMs < BUDZET_MS) {
    const items = await apiGet(baza, tok, "/api/Items/0", { "itemFilter.limit": String(LIMIT_TOW), "itemFilter.offset": String(offset) });
    const wiersze = items.filter((i: any) => i?.code).map((i: any) => wierszTowaru(baza, i));
    if (wiersze.length) {
      const { error } = await sb.from("optima_items_cache").upsert(wiersze, { onConflict: "baza,code" });
      if (error) throw new Error("upsert cache: " + error.message);
    }
    zapisane += wiersze.length;
    offset += LIMIT_TOW;
    if (items.length < LIMIT_TOW) { done = true; break; }
    await sb.from("optima_items_scan").upsert({ baza, next_offset: offset, done: false, updated_at: new Date().toISOString() });
  }
  await sb.from("optima_items_scan").upsert({ baza, next_offset: offset, done, updated_at: new Date().toISOString() });
  return { baza, zapisane, offset, done };
}

// ---------- komponenty magazynu ----------
function polaDrzwi(nazwa: string, typ: string) {
  const n = (nazwa ?? "").replace(/\s+/g, " ").trim();
  const out: Record<string, string | null> = { door_size: null, door_direction: null, door_model: null, door_color: null, door_frame_type: null };
  const m = n.match(/\b(\d{2,3})([LP])\.?$/);
  if (m) { out.door_size = m[1]; out.door_direction = m[2]; }
  if (typ === "door_wing") {
    const w = n.match(/^(?:SKRZYDŁO (?:WEW |NSTD |BEZPRZYLGOWE (?:WEW )?)?|DRZWI )?(.+?\b\d{2}[A-Z]?)\b (.*?)(?: \d{2,3}[LP]\.?)?$/);
    if (w) { out.door_model = w[1]; out.door_color = w[2] || null; }
  }
  if (typ === "door_frame") {
    if (/REGULOWAN|TUNEL|O\.R |\b(OR|ORS)\d/i.test(n)) out.door_frame_type = "adjustable";
    else if (/PROST|STAŁA/i.test(n)) out.door_frame_type = "simple";
  }
  return out;
}

async function zapewnijKomponenty(baza: string, pozycje: any[]) {
  const kandydaci = pozycje.filter((p) => p.aktywny);
  if (!kandydaci.length) return;
  const kody = [...new Set(kandydaci.map((p) => p.kod))];
  const { data: ist } = await sb.from("warehouse_components").select("code").in("code", kody);
  const { data: zmap } = await sb.from("optima_component_map").select("optima_code").in("optima_code", kody);
  const jest = new Set([...(ist ?? []).map((x) => x.code), ...(zmap ?? []).map((x) => x.optima_code)]);
  const widziane = new Set<string>();
  for (const p of kandydaci) {
    if (jest.has(p.kod) || widziane.has(p.kod)) continue;
    widziane.add(p.kod);
    const pola = polaDrzwi(p.nazwa, p.typ);
    const wiersz = {
      code: p.kod, name: p.nazwa, unit: p.jednostka || "szt", category: "DRZWI WEWNĘTRZNE", product_category: p.typ,
      is_active: true, notes: `Import z kartotek Optimy (${BAZY[baza].nazwa})`, ...pola,
    };
    const { error } = await sb.from("warehouse_components").insert(wiersz);
    if (!error) continue;
    if (error.code === "23505" && /code_key/.test(error.message)) continue;
    if (error.code === "23505") {
      let q = sb.from("warehouse_components").select("id").eq("product_category", p.typ);
      for (const f of ["door_model", "door_color", "door_size", "door_direction", "door_frame_type"]) {
        const v = (pola as any)[f];
        q = v == null ? q.is(f, null) : q.eq(f, v);
      }
      const { data: dup } = await q.limit(1).maybeSingle();
      if (dup) { await sb.from("optima_component_map").upsert({ optima_code: p.kod, component_id: dup.id }); continue; }
      const { error: e2 } = await sb.from("warehouse_components").insert({ ...wiersz, door_model: null, door_color: null, door_size: null, door_direction: null, door_frame_type: null });
      if (e2 && !(e2.code === "23505" && /code_key/.test(e2.message))) throw new Error("komponent " + p.kod + ": " + e2.message);
      continue;
    }
    throw new Error("komponent " + p.kod + ": " + error.message);
  }
}

// zamknięcie / anulowanie / ponowne otwarcie wg stanu RO w Optimie
function zastosujStan(doc: any, ef: Record<string, unknown>, releaseDate: string | null, brakPozycji: boolean) {
  const stan = Number(doc.state);
  const zImportu = ef.closed_by === "optima_ro";
  let rd: string | null | undefined = undefined; // undefined = nie zmieniaj
  if (brakPozycji) {
    ef.cancelled = true; ef.cancelled_reason = POWOD_BRAK_POZ;
  } else if (stan === STAN_ANULOWANE) {
    // 28.11 (testy, runda 6): anulowanie przez import NIE ustawia już closed_by — inaczej po powrocie RO do realizacji
    // ręczne „Wydaj” z programu było brane za zamknięcie importem i kasowane (release_date = null). Osobny znacznik.
    if (ef.cancelled !== true) { ef.cancelled = true; ef.cancelled_reason = POWOD_ANUL_RO; ef.cancelled_by_import = true; }
  } else if (ef.cancelled_reason === POWOD_ANUL_RO || ef.cancelled_reason === POWOD_BRAK_POZ) {
    delete ef.cancelled; delete ef.cancelled_reason; delete ef.cancelled_by_import;
  }
  if (!brakPozycji && stan === STAN_ZREALIZOWANE) {
    if (!releaseDate) { rd = (doc.updated ?? doc.documentIssueDate ?? new Date().toISOString()).slice(0, 10); ef.closed_by = "optima_ro"; }
  } else if (releaseDate && zImportu && stan !== STAN_ZREALIZOWANE) {
    rd = null; // RO wróciło do realizacji → otwieramy zlecenie zamknięte przez import
  }
  if (ef.closed_by === "optima_ro" && !ef.cancelled && (rd === null || (rd === undefined && !releaseDate))) delete ef.closed_by;
  return rd;
}

// ---------- zlecenia ----------
async function zapiszZlecenie(baza: string, doc: any, pozycje: any[]) {
  const key = `${baza}:${doc.id}`;
  const { data: ist } = await sb.from("orders").select("id, extra_fields, source_metadata, release_date").eq("source", "optima_ro")
    .eq("source_metadata->>optima_key", key).maybeSingle();

  const glowne = pozycje.filter((p) => (p.typ === "door_wing" || p.typ === "door_frame") && !/^DRZWI TECHNIC/i.test(p.nazwa ?? ""));
  const brakPozycji = glowne.length === 0;
  if (brakPozycji && !ist) return "pominięte";

  if (ist && !brakPozycji && ist.source_metadata?.updated === doc.updated) {
    const { count } = await sb.from("order_internal_door_items").select("id", { count: "exact", head: true }).eq("order_id", ist.id);
    if ((count ?? 0) > 0) return "bez zmian";
  }

  if (!brakPozycji) await zapewnijKomponenty(baza, pozycje);

  const payer = doc.payer ?? {};
  const rec = doc.recipient ?? {};
  const meta = {
    optima_key: key, baza: BAZY[baza].nazwa, document_id: doc.id, full_number: doc.fullNumber,
    status: doc.status, state: doc.state, updated: doc.updated, created: doc.created,
    reservation_date: doc.documentReservationDate, payer_code: payer.code,
    recipient: { code: rec.code, name: rec.name1, city: rec.city, street: [rec.street, rec.houseNumber].filter(Boolean).join(" "), post_code: rec.postCode },
  };
  const qty = pozycje.filter((p) => p.typ === "door_wing").reduce((s, p) => s + Math.round(p.ilosc), 0);
  const wiersz: Record<string, unknown> = {
    category: CATEGORY, source: "optima_ro", order_number: doc.fullNumber, erp_ro_number: doc.fullNumber,
    erp_status: "POMYŚLNY", erp_updated_at: new Date().toISOString(),
    company: payer.name1 || payer.code || null, client_order_number: doc.foreignNumber || null,
    order_date: (doc.documentIssueDate ?? doc.created ?? "").slice(0, 10) || null,
    quantity: qty || null, notes: doc.description || null,
    entered_by: `Optima API (${BAZY[baza].nazwa})`, source_metadata: meta,
  };

  const ef = { ...((ist?.extra_fields as Record<string, unknown>) ?? {}) };
  const rd = zastosujStan(doc, ef, ist?.release_date ?? null, brakPozycji);
  wiersz.extra_fields = ef;
  if (rd !== undefined) wiersz.release_date = rd;

  let orderId: number;
  if (ist) {
    const { error } = await sb.from("orders").update(wiersz).eq("id", ist.id);
    if (error) throw new Error("update orders: " + error.message);
    orderId = ist.id;
    if (brakPozycji) return "anulowane";
  } else {
    const { data, error } = await sb.from("orders").insert(wiersz).select("id").single();
    if (error) throw new Error("insert orders: " + error.message);
    orderId = data.id;
  }

  const kody = [...new Set(pozycje.map((p) => p.kod))];
  const { data: mapa } = await sb.from("optima_component_map").select("optima_code, component_id").in("optima_code", kody);
  const { data: komp } = await sb.from("warehouse_components").select("id, code").in("code", kody);
  const mapaKomp = new Map<string, number>((komp ?? []).map((k) => [k.code, k.id]));
  for (const m of mapa ?? []) mapaKomp.set(m.optima_code, m.component_id);
  await sb.from("order_internal_door_items").delete().eq("order_id", orderId);
  const items = pozycje.map((p) => ({
    order_id: orderId, component_id: mapaKomp.get(p.kod) ?? null,
    quantity: Math.max(1, Math.round(p.ilosc)), optima_code: p.kod, optima_name: p.nazwa, optima_group: p.grupa,
    optima_element_id: p.elId, unit: p.jednostka, notes: p.opis || null, item_type: p.typ,
  }));
  if (items.length) {
    const { error } = await sb.from("order_internal_door_items").insert(items);
    if (error) throw new Error("insert items: " + error.message);
  }
  return ist ? "zaktualizowane" : "nowe";
}

async function przetworzDokument(baza: string, tok: string, doc: any, stat: Record<string, number>) {
  const pozycje: any[] = [];
  for (const el of doc.elements ?? []) {
    if (!el.code) continue;
    const info = await infoTowaru(baza, tok, el);
    if (info.typ) {
      pozycje.push({ kod: el.code, nazwa: el.name ?? info.nazwa, grupa: info.grupa, typ: info.typ, aktywny: info.aktywny,
        ilosc: Number(el.quantity ?? 1), jednostka: el.unit ?? info.jm, opis: el.description, elId: el.id });
    }
  }
  const wynik = await zapiszZlecenie(baza, doc, pozycje);
  stat[wynik] = (stat[wynik] ?? 0) + 1;
}

async function okno(baza: string, tok: string, od: Date, do_: Date, stat: Record<string, number>, bledy: string[]) {
  let offset = 0;
  while (true) {
    const docs = await apiGet(baza, tok, "/api/Documents/0", {
      "documentFilter.type": "308", "documentFilter.u_dateFrom": iso(od), "documentFilter.u_dateTo": iso(do_),
      "documentFilter.limit": String(LIMIT), "documentFilter.offset": String(offset),
    });
    await rozgrzejCache(baza, docs);
    await pula(docs, POOL, async (d: any) => {
      try { await przetworzDokument(baza, tok, d, stat); stat.ro++; }
      catch (e) { bledy.push(`${d.fullNumber}: ${String(e).slice(0, 200)}`); }
    });
    if (docs.length < LIMIT) return;
    offset += LIMIT;
  }
}

async function sync(baza: string, startMs: number) {
  const { data: st } = await sb.from("optima_ro_sync_state").select("*").eq("baza", baza).maybeSingle();
  let kursor = new Date(st?.last_u_date ?? START);
  const tok = await token(baza);
  const stat: Record<string, number> = { ro: 0 };
  const teraz = new Date();
  const bledy: string[] = [];
  const zapiszStan = () => sb.from("optima_ro_sync_state").update({ last_u_date: kursor.toISOString(), last_run_at: new Date().toISOString(), last_result: { ...stat, api_ms: apiMs, api_n: apiN, bledy: bledy.slice(0, 20) } }).eq("baza", baza);
  while (Date.now() - startMs < BUDZET_SYNC_MS && kursor < teraz) {
    const okna: [Date, Date][] = [];
    let a = kursor;
    for (let i = 0; i < OKNA_RAZEM && a < teraz; i++) {
      const b = new Date(Math.min(a.getTime() + OKNO_DNI * 86400000, teraz.getTime()));
      okna.push([a, b]); a = b;
    }
    const wyniki = await Promise.allSettled(okna.map(([od, do_]) => okno(baza, tok, od, do_, stat, bledy)));
    let nowy = okna[okna.length - 1][1];
    for (let i = 0; i < wyniki.length; i++) {
      const w = wyniki[i];
      if (w.status === "rejected") { nowy = okna[i][0]; bledy.push(`okno ${iso(okna[i][0])}: ${String(w.reason).slice(0, 300)}`); break; }
    }
    const blad = nowy.getTime() !== okna[okna.length - 1][1].getTime();
    kursor = nowy;
    await zapiszStan();
    if (blad) break;
  }
  await zapiszStan();
  return { baza, kursor: kursor.toISOString(), ...stat, api_ms: apiMs, api_n: apiN, bledy: bledy.slice(0, 20) };
}

Deno.serve(async (req) => {
  const { data: ok } = await sb.rpc("optima_sync_key_ok", { k: req.headers.get("x-internal-key") ?? "" });
  if (!ok) return new Response("forbidden", { status: 403 });
  const body = await req.json().catch(() => ({}));
  const start = Date.now();
  apiMs = 0; apiN = 0;
  try {
    const bazy: string[] = body.baza ? [body.baza] : ["KR", "MR"];
    if (body.akcja === "probe") {
      const tok = await token(bazy[0]);
      const docs = await apiGet(bazy[0], tok, "/api/Documents/0", { "documentFilter.type": "308", "documentFilter.u_dateFrom": body.from ?? "2026-11-20", "documentFilter.limit": String(body.limit ?? 1) });
      return Response.json({ docs, api_ms: apiMs });
    }
    const wyniki = [];
    for (const b of bazy) {
      try {
        if (body.akcja === "kartoteki") { wyniki.push(await kartoteki(b, start)); continue; }
        const { data: lock } = await sb.rpc("optima_sync_lock", { p_baza: b, p_sec: 175 });
        if (!lock) { wyniki.push({ baza: b, pominiete: "trwa inny przebieg" }); continue; }
        try { wyniki.push(await sync(b, start)); }
        finally { await sb.rpc("optima_sync_unlock", { p_baza: b }); }
      } catch (e) { wyniki.push({ baza: b, blad: String(e).slice(0, 300) }); }
    }
    return Response.json({ wyniki, ms: Date.now() - start });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
