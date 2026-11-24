// excel-sync: przyjmuje plik xlsm z produkcji (Make: OneDrive -> HTTP multipart "file"), czyta arkusze zamówień
// lekkim parserem (parse.ts) i woła RPC sync_releases_from_excel (osobno dla każdej kategorii w pliku).
// Od 19.11.2026 czyta też arkusz „Reklamacje” z każdego skoroszytu i woła sync_complaints_from_excel
// (jedna strona Excel → aplikacja; układ kolumn różni się między skoroszytami, stąd aliasy nagłówków).
// Autoryzacja: nagłówek x-sync-secret = integration_settings.excel_sync_secret
// ?file=STA|DISTING|ST|BASTION  &dry_run=1  &inspect=1  &reklamacje=0 (pomiń reklamacje)
// Od 24.11.2026 czyta też KOLUMNY ETAPÓW (inicjały) z arkuszy zamówień i po dopasowaniu wierszy (items z
// sync_releases_from_excel) woła RPC sync_stages_from_excel: uzupełnia tylko puste etapy w programie.
// Tryb: integration_settings.excel_sync_etapy = off | dry (podgląd) | on. Wynik w summary.etapy tego samego przebiegu.
import { createClient } from "npm:@supabase/supabase-js@2";
import { readSheets, inspectWorkbook } from "./parse.ts";

// done = zapasowa kolumna „zrobione” (gdy WYDANIE puste); doneOptional = arkusz może jej nie mieć (np. WZ TITAN)
type Part = { category: string; sheets: Record<string, string>; nr: string; wyd: string; done?: string; doneOptional?: boolean };
const DONE = "MAGAZYN, KONTROLA ODBIORCZA";
// 20.11: Titan w ST.xlsm — hala nie wpisuje WYDANIE, ostatni etap to ETAP 4 (nagłówki porównywane wielkimi literami).
// Bez tego ST_TITAN nie zamknął żadnego zlecenia, a z nim rola Bastion (58 otwartych Titanów).
const DONE_TITAN_ST = "ETAP 4 (MONTAŻ, PAKOWANIE I KONTROLA JAKOŚCI)";
const STD = { nr: "NR. ZLECENIA", wyd: "WYDANIE" };
// TITAN (G-xx): STA = frezowanie/podcięcie skrzydła, ST = montaż i wydanie (rola Bastion zamykana razem z ST)
const TITAN = { "Zamowienia Center TITAN": "Center", "Zamowienia Profil TITAN": "Profil", "Zamowienia WZ TITAN": "WZ" };
const FILES: Record<string, Part[]> = {
  STA: [
    { category: "STA", ...STD, sheets: { "Zamowienia Profil": "Profil", "Zamowienia Center": "Center", "Zamowienia WZ": "WZ" } },
    { category: "STA_TITAN", ...STD, sheets: TITAN },
  ],
  DISTING: [{ category: "Disting", ...STD, done: DONE, sheets: { "Zamowienia Profil": "Profil", "Zamowienia Center": "Center", "Zamowienia WZ": "WZ" } }],
  ST: [
    { category: "ST", ...STD, done: DONE, sheets: { "Zamowienia Center": "Center", "Zamowienia WZ": "WZ" } },
    { category: "Techniczne", ...STD, done: DONE, sheets: { "Zamowienia techniczne": "*" } },
    { category: "ST_TITAN", ...STD, done: DONE_TITAN_ST, doneOptional: true, sheets: TITAN },
  ],
  BASTION: [{
    category: "Bastion", nr: "NUMER ZLECENIA", wyd: "ZREALIZOWANE", done: DONE,
    sheets: {
      "Zamowienia Center": "Center", "Zamowienia Profil": "Profil",
      "Zamowienia Bold Center": "Center", "Zamowienia Bold Profil": "Profil",
      "Zamowienia Center INTERIOR": "Center", "Zamowienia Profil INTERIOR": "Profil",
    },
  }],
};

// ── Etapy z Excela → klucze etapów w programie (production_stages). Nagłówki porównywane WIELKIMI literami,
// po wzorcu, bo między skoroszytami różnią się dopiskami. Kolejność reguł nie ma znaczenia; jedna kolumna może
// zasilać dwa klucze (Disting: CNC = frezowanie ościeżnicy e1 i skrzydła e3).
type StageRule = { key: string; re: RegExp };
const ST_RULES: StageRule[] = [
  { key: "cnc", re: /^CNC$/ },
  { key: "osc", re: /^OŚCIEŻNICA \(SKRĘCANIE/ },
  { key: "skr", re: /^SKRZYDŁO \(OKUWANIE/ },
  { key: "mon", re: /^MONTAŻ DRZWI/ },
  { key: "mag", re: /^MAGAZYN, KONTROLA/ },
];
const DISTING_RULES: StageRule[] = [
  { key: "e1", re: /^CNC$/ },
  { key: "e3", re: /^CNC$/ },
  { key: "e2_1", re: /^OŚCIEŻNICA \(SKRĘCANIE/ },
  { key: "e2_2", re: /^PAKOWANIE DOSTAWKI/ },
  { key: "e4", re: /^SKRZYDŁO \(OKUWANIE/ },
  { key: "e5", re: /^MONTAŻ DRZWI/ },
];
const STA_RULES: StageRule[] = [
  { key: "e1", re: /^ETAP 1\b/ },
  { key: "e2_1", re: /^ETAP 2\.1\b/ },
  { key: "e2_2", re: /^ETAP 2\.2\b/ },
  { key: "e3", re: /^ETAP 3\b/ },
  { key: "e4", re: /^ETAP 4\b/ },
  { key: "e5", re: /^ETAP 5\b/ },
];
// Titan w STA.xlsm: arkusz STA robi frezowanie otworów w skrzydle (e3); „podcięcie” nie ma etapu w programie
const STA_TITAN_RULES: StageRule[] = [{ key: "e3", re: /FREZOWANIE OTWORÓW/ }];
// Titan w ST.xlsm: ETAP 1 ościeżnica (e1), ETAP 2 skrzydło odebrane (e2), ETAP 3 okuwanie (e3), ETAP 4 montaż/pakowanie (e4)
const ST_TITAN_RULES: StageRule[] = [
  { key: "e1", re: /^ETAP 1 \(OŚCIEŻNICA/ },
  { key: "e2", re: /SKRZYDŁO ODEBRANE/ },
  { key: "e3", re: /^ETAP 3 \(OKUWANIE/ },
  { key: "e4", re: /^ETAP 4 \(MONTAŻ/ },
];
const BASTION_RULES: StageRule[] = [
  { key: "cnc", re: /^CNC$/ },
  { key: "okleinowanie_skrzydla", re: /^OKLEINOWANIE SKRZYDŁA/ },
  { key: "okuwanie_skrzydla", re: /^OKUWANIE SKRZYDŁA/ },
  { key: "oscieznica_cnc", re: /^OŚCIEŻNICA CNC/ },
  { key: "oscieznica_skrecanie", re: /^OŚCIEŻNICA \(SKRĘCANIE/ },
  { key: "magazyn_kontrola", re: /^MAGAZYN, KONTROLA/ },
  { key: "stolarnia", re: /^STOLARNIA/ },
  { key: "magazyn_regulowana", re: /^MAGAZYN REGULOWANE/ },
  { key: "regulowana_do_zlozenia", re: /^REGULOWANA DO ZŁOŻENIA/ },
];
const STAGE_RULES: Record<string, StageRule[]> = {
  STA: STA_RULES, STA_TITAN: STA_TITAN_RULES, Disting: DISTING_RULES, ST: ST_RULES, Techniczne: ST_RULES, ST_TITAN: ST_TITAN_RULES, Bastion: BASTION_RULES,
};
// wartość komórki etapu → wartość w programie; null = pomiń; { nietypowe } = do raportu, bez zapisu;
// { v, info } = zapisane, ale z adnotacją w raporcie (komórka z kilkoma osobami)
function stageValue(raw: unknown): { v: string | null; nietypowe?: string; info?: string } {
  if (raw == null) return { v: null };
  const t = String(raw).trim();
  if (t === "" || t === "-" || t === "—") return { v: null };
  if (/^x+$/i.test(t)) return { v: "#ND" };
  if (/^WSTRZYM/i.test(t)) return { v: "#WS:Excel" };
  if (/^[A-ZĄĆĘŁŃÓŚŹŻ]{1,3}$/i.test(t)) return { v: t.toUpperCase() };
  // 24.11 (Tymek): „S2”, „T3”, „3K”, „W1J1”, „M5S7” = litera to osoba, cyfra to numer sztuki (druga sztuka zrobił S, trzecią T).
  // Program ma jedno pole na etap: zapisujemy osobę, która zrobiła najwięcej sztuk (remis = pierwsza wpisana),
  // a komórkę z kilkoma osobami dopisujemy do raportu jako informację, nie jako brak.
  const osoby = osobyZeSztuk(t);
  if (osoby) {
    const licznik = new Map<string, number>();
    for (const o of osoby) licznik.set(o, (licznik.get(o) ?? 0) + 1);
    let best = osoby[0];
    for (const [o, n] of licznik) if (n > (licznik.get(best) ?? 0)) best = o;
    const rozne = [...licznik.keys()];
    return rozne.length > 1 ? { v: best, info: `${t.slice(0, 30)} → ${best} (kilka osób: ${rozne.join(", ")})` } : { v: best };
  }
  return { v: null, nietypowe: t.slice(0, 40) };
}

// Komórka złożona z tokenów „litery+cyfry” albo „cyfry+litery” (z opcjonalnymi spacjami/przecinkami) → lista osób w kolejności wpisu;
// null, gdy w komórce jest cokolwiek innego (np. „W-P”, „P/Z”, „BRAK ALU”).
const TOKEN_OSOBA_SZTUKA = /([A-ZĄĆĘŁŃÓŚŹŻ]{1,3})(\d{1,3})|(\d{1,3})([A-ZĄĆĘŁŃÓŚŹŻ]{1,3})/g;
function osobyZeSztuk(t: string): string[] | null {
  const u = t.toUpperCase();
  const reszta = u.replace(TOKEN_OSOBA_SZTUKA, " ").replace(/[\s,;.]+/g, "");
  if (reszta !== "") return null;
  const osoby: string[] = [];
  for (const m of u.matchAll(TOKEN_OSOBA_SZTUKA)) osoby.push(m[1] ?? m[4]);
  return osoby.length ? osoby : null;
}

// Reklamacje: kategoria aplikacji per plik + aliasy nagłówków (UPPERCASE), pierwszy znaleziony wygrywa.
// ST/Disting: NR. REKLAMACJI, DATA REKLAMACJI, PA/CA/WZ | PD/CD/WZ, NR. ZLECENIA, …, POWÓD REKLAMACJI, WPISAŁ
// Bastion: NUMER REKLAMACJI, DATA, NR KR CENTER, UWAGI 2, ZREALIZOWANE, WPISAŁ. STA: jak ST (do potwierdzenia pierwszym przebiegiem).
const COMPLAINTS_SHEET = "Reklamacje";
const COMPLAINT_CATEGORY: Record<string, string> = { STA: "STA", DISTING: "Disting", ST: "ST", BASTION: "Bastion" };
const CH: Record<string, string[]> = {
  nr: ["NR. REKLAMACJI", "NUMER REKLAMACJI", "NR REKLAMACJI"],
  data: ["DATA REKLAMACJI", "DATA"],
  wyk: ["PA/CA/WZ", "PD/CD/WZ", "WYKONAWCA"],
  nr_zlecenia: ["NR. ZLECENIA", "NR ZLECENIA", "NR KR CENTER", "NUMER ZLECENIA KR CENTER"],
  firma: ["FIRMA"],
  co: ["CO REKLAMOWANE"],
  system: ["SYSTEM"],
  model: ["MODEL"],
  kolor: ["KOLOR", "KOLOR SKRZYDŁA"],
  kolor_osc: ["KOLOR OŚCIEŻNICY", "KOLOR OŚCIEZNICY"],
  szer: ["SZEROKOŚĆ"],
  kierunek: ["KIERUNEK"],
  otwieranie: ["OTWIERANIE"],
  wysokosc: ["WYSOKOŚĆ"],
  ilosc: ["ILOŚĆ"],
  powod: ["POWÓD REKLAMACJI", "POWÓD", "UWAGI 2"],
  info: ["INFO", "UWAGI"],
  wpisal: ["WPISAŁ"],
  wydanie: ["WYDANIE", "ZREALIZOWANE"],
  // etapy naprawy → klucze etapów ST w aplikacji (cnc / osc / skr / mon / mag)
  e_cnc: ["CNC"],
  e_osc: ["OŚCIEŻNICA (SKRĘCANIE I OKUWANIE)", "OŚCIEŻNICA (SKRĘCANIE I OKUWANIE)2"],
  e_skr: ["SKRZYDŁO (OKUWANIE, MONTAŻ PAKIETU SZYBOWEGO)", "OKUWANIE SKRZYDŁA"],
  e_mon: ["MONTAŻ DRZWI (PAKOWANIE I OZNAKOWANIE)"],
  e_mag: ["MAGAZYN, KONTROLA ODBIORCZA"],
};
const COMPLAINT_HEADERS = [...new Set(Object.values(CH).flat())];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// numer seryjny daty Excela (system 1900) -> YYYY-MM-DD
const serialToIso = (v: unknown): string | null =>
  typeof v === "number" && v > 20000 && v < 80000
    ? new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10)
    : null;

// data z arkusza: numer seryjny albo tekst „DD.MM.YYYY” / „YYYY-MM-DD”
const anyToIso = (v: unknown): string | null => {
  const s = serialToIso(v);
  if (s) return s;
  if (typeof v !== "string") return null;
  const t = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
};

const str = (v: unknown): string => (v == null ? "" : String(v).trim());

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: s } = await supabase.from("integration_settings").select("value").eq("key", "excel_sync_secret").single();
    if (!s?.value || req.headers.get("x-sync-secret") !== s.value) return json({ error: "unauthorized" }, 401);

    const url = new URL(req.url);
    const fileKey = (url.searchParams.get("file") ?? url.searchParams.get("category") ?? "STA").toUpperCase();
    const dryRun = url.searchParams.get("dry_run") === "1";
    const inspect = url.searchParams.get("inspect") === "1";
    const withComplaints = url.searchParams.get("reklamacje") !== "0";
    const parts = FILES[fileKey];
    if (!parts && !inspect) return json({ error: `nieznany plik ${fileKey}` }, 400);

    let bytes: Uint8Array;
    let fileName = url.searchParams.get("source") ?? "";
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const f = form.get("file");
      if (!(f instanceof File)) return json({ error: "brak pola file" }, 400);
      bytes = new Uint8Array(await f.arrayBuffer());
      fileName = fileName || f.name;
    } else {
      bytes = new Uint8Array(await req.arrayBuffer());
    }
    if (bytes.length < 1000) return json({ error: "pusty lub zbyt mały plik" }, 400);

    if (inspect) {
      const info = inspectWorkbook(bytes, 4);
      await supabase.from("excel_sync_runs").insert({ source: `inspect: ${fileName}`, dry_run: true, rows_in: 0, summary: { sheets: info.length }, details: info });
      return json({ inspect: true, sheets: info.map((s: any) => s.name) });
    }

    const allSheets = [...new Set(parts.flatMap((p) => Object.keys(p.sheets)))];
    const headers = [...new Set(["FIRMA", "DATA", "MODEL", "AIRTABLE ID", "NUMER ZAMÓWIENIA KLIENTA", ...parts.flatMap((p) => [p.nr, p.wyd, ...(p.done ? [p.done] : [])])])];
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Warsaw" });

    // etapy (24.11): tryb z ustawień + kolumny etapów rozpoznane po nagłówkach z pierwszego wiersza każdego arkusza
    const { data: es } = await supabase.from("integration_settings").select("value").eq("key", "excel_sync_etapy").maybeSingle();
    const etapyMode = (es?.value ?? "off").trim().toLowerCase();   // off | dry | on
    const stageCols: Record<string, Array<{ key: string; header: string }>> = {};   // arkusz -> [{klucz etapu, nagłówek}]
    if (etapyMode !== "off") {
      const info = inspectWorkbook(bytes, 1) as Array<{ name: string; rows: Record<string, Record<string, unknown>> }>;
      for (const sh of info) {
        if (!allSheets.includes(sh.name)) continue;
        const row1 = Object.values(sh.rows?.["1"] ?? {}).map((v) => String(v ?? "").trim().toUpperCase()).filter(Boolean);
        for (const part of parts) {
          if (!(sh.name in part.sheets)) continue;
          const rules = STAGE_RULES[part.category] ?? [];
          const cols: Array<{ key: string; header: string }> = [];
          for (const r of rules) {
            const h = row1.find((x) => r.re.test(x));
            if (h) cols.push({ key: r.key, header: h });
          }
          stageCols[`${part.category}|${sh.name}`] = cols;
          for (const c of cols) if (!headers.includes(c.header)) headers.push(c.header);
        }
      }
    }
    const parsed = readSheets(bytes, allSheets, headers);
    const cutoff = Date.now() - 365 * 24 * 3600 * 1000;
    const results: unknown[] = [];

    for (const part of parts) {
      const rows: Record<string, unknown>[] = [];
      const perSheet: Record<string, number> = {};
      // etapy per wiersz arkusza: klucz = to, co RPC zwraca w items.excel_row (`${sheet} ${nr}`)
      const etapyByRow: Record<string, { stages: Record<string, string>; nietypowe: Array<{ etap: string; wartosc: string }> }> = {};
      const stageColsMissing: string[] = [];
      for (const [sheetName, sheet] of Object.entries(part.sheets)) {
        const p = parsed[sheetName];
        if (!p) { perSheet[sheetName] = -1; continue; }
        const cols = stageCols[`${part.category}|${sheetName}`] ?? [];
        if (etapyMode !== "off" && !cols.length) stageColsMissing.push(sheetName);
        const have = Object.values(p.headers);
        for (const h of [part.nr, "MODEL", part.wyd, "DATA", ...(part.done && !part.doneOptional ? [part.done] : [])])
          if (!have.includes(h)) return json({ error: `arkusz ${sheetName}: brak kolumny ${h}` }, 422);
        const doneCol = part.done && have.includes(part.done) ? part.done : null;
        let n = 0;
        for (const x of p.rows) {
          const nr = x[part.nr];
          if (nr === null || nr === undefined || String(nr).trim() === "") continue;
          const d = serialToIso(x["DATA"]);
          if (!d || Date.parse(d) < cutoff) continue;
          // wydanie: data -> data; "X"/"XX" -> wydane (data synchronizacji, szacunkowa);
          // brak wydania, ale zaznaczony etap MAGAZYN, KONTROLA ODBIORCZA -> wydane (szacunkowa)
          const w = x[part.wyd];
          let wyd: string | null = null, szac = false;
          if (typeof w === "number") wyd = serialToIso(w);
          else if (w != null && String(w).trim() !== "") {
            const t = String(w).trim();
            if (/^x+$/i.test(t)) { wyd = today; szac = true; } else wyd = t;
          }
          if (wyd === null && doneCol) {
            const dv = x[doneCol];
            if (dv != null && String(dv).trim() !== "" && String(dv).trim() !== "-") { wyd = today; szac = true; }
          }
          if (cols.length) {
            const stages: Record<string, string> = {};
            const nietypowe: Array<{ etap: string; wartosc: string }> = [];
            for (const c of cols) {
              const sv = stageValue(x[c.header]);
              if (sv.v) stages[c.key] = sv.v;
              else if (sv.nietypowe) nietypowe.push({ etap: c.key, wartosc: sv.nietypowe });
              if (sv.v && sv.info) nietypowe.push({ etap: c.key, wartosc: sv.info });   // zapisane, informacja w raporcie
            }
            if (Object.keys(stages).length || nietypowe.length) etapyByRow[`${sheet} ${String(nr).trim()}`] = { stages, nietypowe };
          }
          rows.push({
            sheet, nr: String(nr).trim(),
            firma: String(x["FIRMA"] ?? ""),
            model: String(x["MODEL"] ?? ""),
            wydanie: wyd,
            airtable_id: x["AIRTABLE ID"] ? String(x["AIRTABLE ID"]).trim() || null : null,
            client_no: x["NUMER ZAMÓWIENIA KLIENTA"] != null ? String(x["NUMER ZAMÓWIENIA KLIENTA"]).trim() : "",
            szac,
          });
          n++;
        }
        perSheet[sheetName] = n;
      }
      const { data: result, error } = await supabase.rpc("sync_releases_from_excel", {
        p_rows: rows, p_dry_run: dryRun, p_source: `make: ${fileName || fileKey}`, p_category: part.category,
      });
      if (error) { results.push({ category: part.category, error: error.message, perSheet }); continue; }
      const entry: Record<string, unknown> = { category: part.category, rows_sent: rows.length, perSheet, run_id: result.run_id, summary: result.summary };
      // etapy: tylko wiersze dopasowane jednoznacznie (bez duplikatów i anulowanych); program ma pierwszeństwo (RPC uzupełnia puste)
      if (etapyMode !== "off") {
        try {
          const items = ((result.items ?? []) as Array<Record<string, unknown>>)
            .filter((i) => i.status !== "duplikat" && i.status !== "anulowane_w_excelu" && etapyByRow[String(i.excel_row)])
            .map((i) => ({ id: i.id, order_number: i.order_number, excel_row: i.excel_row, ...etapyByRow[String(i.excel_row)] }));
          const { data: eres, error: eerr } = await supabase.rpc("sync_stages_from_excel", {
            p_items: items, p_dry_run: dryRun || etapyMode !== "on", p_run_id: result.run_id, p_category: part.category,
          });
          entry.etapy = eerr ? { error: eerr.message } : { ...(eres ?? {}), zmiany: undefined, rozne_lista: undefined, nietypowe_lista: undefined, kolumny_brak: stageColsMissing };
        } catch (e) {
          entry.etapy = { error: String((e as Error)?.message ?? e) };
        }
      }
      results.push(entry);
    }

    // ── Reklamacje (arkusz „Reklamacje” w tym samym skoroszycie) ─────────────────────────
    const complaintCategory = COMPLAINT_CATEGORY[fileKey];
    if (withComplaints && complaintCategory) {
      try {
        const cp = readSheets(bytes, [COMPLAINTS_SHEET], COMPLAINT_HEADERS)[COMPLAINTS_SHEET];
        if (!cp) {
          results.push({ category: `Reklamacje ${complaintCategory}`, skipped: `brak arkusza „${COMPLAINTS_SHEET}”` });
        } else {
          const have = new Set(Object.values(cp.headers) as string[]);
          const pick = (key: string) => CH[key].find((h) => have.has(h)) ?? null;
          const col: Record<string, string | null> = Object.fromEntries(Object.keys(CH).map((k) => [k, pick(k)]));
          if (!col.nr || !col.data) {
            results.push({ category: `Reklamacje ${complaintCategory}`, skipped: "brak kolumny numeru reklamacji albo daty", headers: [...have] });
          } else {
            const crow: Record<string, unknown>[] = [];
            let rowNo = 1;
            for (const x of cp.rows) {
              rowNo++;
              const g = (k: string) => (col[k] ? x[col[k] as string] : undefined);
              const nr = str(g("nr"));
              if (!nr) continue;
              const data = anyToIso(g("data"));
              if (!data || Date.parse(data) < cutoff) continue;
              const wydRaw = g("wydanie");
              const wydanie = wydRaw == null ? "" : (serialToIso(wydRaw) ?? str(wydRaw));
              crow.push({
                nr, data, wyk: str(g("wyk")), nr_zlecenia: str(g("nr_zlecenia")), firma: str(g("firma")), co: str(g("co")),
                system: str(g("system")), model: str(g("model")), kolor: str(g("kolor")), kolor_osc: str(g("kolor_osc")),
                szer: str(g("szer")), kierunek: str(g("kierunek")), otwieranie: str(g("otwieranie")), wysokosc: str(g("wysokosc")),
                ilosc: str(g("ilosc")), powod: str(g("powod")), info: str(g("info")), wpisal: str(g("wpisal")),
                wydanie,
                etapy: { cnc: str(g("e_cnc")), osc: str(g("e_osc")), skr: str(g("e_skr")), mon: str(g("e_mon")), mag: str(g("e_mag")) },
                wiersz: rowNo,
              });
            }
            const { data: cres, error: cerr } = await supabase.rpc("sync_complaints_from_excel", {
              p_rows: crow, p_category: complaintCategory, p_source: `make: ${fileName || fileKey}`, p_dry_run: dryRun,
            });
            if (cerr) {
              // błąd reklamacji: zapisz do logu, ale nie przerywaj łańcucha w Make (status 200)
              await supabase.from("excel_sync_runs").insert({ source: `make: ${fileName || fileKey}`, dry_run: dryRun, rows_in: crow.length,
                summary: { kategoria: `Reklamacje ${complaintCategory}`, blad: cerr.message }, details: [{ columns: col }] });
              results.push({ category: `Reklamacje ${complaintCategory}`, error: cerr.message, rows_sent: crow.length, columns: col });
            }
            else results.push({ category: `Reklamacje ${complaintCategory}`, rows_sent: crow.length, run_id: cres.run_id, summary: cres.summary, columns: col });
          }
        }
      } catch (e) {
        // reklamacje nie mogą wywrócić synchronizacji wydań
        results.push({ category: `Reklamacje ${complaintCategory}`, error: String((e as Error)?.message ?? e) });
      }
    }

    // tylko błąd synchronizacji wydań daje 500 (Make zatrzymuje wtedy kolejne pliki); błąd reklamacji jest w results i w logu
    const failed = results.some((r: any) => r.error && !String(r.category).startsWith("Reklamacje"));
    return json({ file: fileKey, dry_run: dryRun, results }, failed ? 500 : 200);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
