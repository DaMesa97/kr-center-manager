// @ts-nocheck
// Lekki parser xlsx/xlsm: rozpakowuje tylko potrzebne arkusze, czyta tylko wskazane kolumny (po nagłówku z wiersza 1).
import { unzipSync, strFromU8 } from "npm:fflate@0.8.2";

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const unesc = (s) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e]);

function textOf(xml) {
  // konkatenacja wszystkich <t>..</t> (także rich text)
  let out = "", i = 0;
  for (;;) {
    const a = xml.indexOf("<t", i);
    if (a < 0) break;
    const ch = xml[a + 2];
    if (ch !== ">" && ch !== " ") { i = a + 2; continue; }
    const gt = xml.indexOf(">", a);
    if (xml[gt - 1] === "/") { i = gt + 1; continue; }
    const b = xml.indexOf("</t>", gt);
    out += xml.slice(gt + 1, b);
    i = b + 4;
  }
  return unesc(out);
}

/**
 * @param bytes Uint8Array pliku
 * @param sheetNames nazwy arkuszy do odczytu
 * @param wantedHeaders nagłówki kolumn (UPPERCASE, trim) do odczytu
 * @returns { [sheetName]: { headers: {name: colLetters}, rows: Array<Record<headerName, value>> } | null }
 */
export function readSheets(bytes, sheetNames, wantedHeaders) {
  const meta = unzipSync(bytes, { filter: (f) => f.name === "xl/workbook.xml" || f.name === "xl/_rels/workbook.xml.rels" });
  const wbXml = strFromU8(meta["xl/workbook.xml"]);
  const relXml = strFromU8(meta["xl/_rels/workbook.xml.rels"]);
  const rels = {};
  for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    let t = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (!id || !t) continue;
    t = t.startsWith("/") ? t.slice(1) : "xl/" + t;
    rels[id] = t;
  }
  const paths = {};
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unesc(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? "");
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    if (sheetNames.includes(name) && rid && rels[rid]) paths[name] = rels[rid];
  }
  const need = new Set(Object.values(paths));
  const files = unzipSync(bytes, { filter: (f) => need.has(f.name) || f.name === "xl/sharedStrings.xml" });

  // shared strings: indeks pozycji <si>, dekodowanie leniwe
  const ssXml = files["xl/sharedStrings.xml"] ? strFromU8(files["xl/sharedStrings.xml"]) : "";
  const siPos = [];
  for (let i = ssXml.indexOf("<si"); i >= 0; i = ssXml.indexOf("<si", i + 3)) {
    const c = ssXml[i + 3];
    if (c === ">" || c === " " || c === "/") siPos.push(i);
  }
  const ssCache = new Map();
  const ss = (k) => {
    if (ssCache.has(k)) return ssCache.get(k);
    const a = siPos[k];
    if (a === undefined) return null;
    const head = ssXml.indexOf(">", a);
    if (ssXml[head - 1] === "/") { ssCache.set(k, ""); return ""; }
    const b = ssXml.indexOf("</si>", head);
    const v = textOf(ssXml.slice(head + 1, b));
    ssCache.set(k, v);
    return v;
  };

  const out = {};
  for (const name of sheetNames) {
    const p = paths[name];
    if (!p || !files[p]) { out[name] = null; continue; }
    const xml = strFromU8(files[p]);
    const cellRe = /<c r="([A-Z]+)(\d+)"([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
    const rowsByNum = new Map();
    let headerCols = null; // letters -> headerName
    let wantedLetters = null;
    const headerRow = new Map();
    let m;
    while ((m = cellRe.exec(xml))) {
      const col = m[1], rowNum = +m[2];
      if (rowNum === 1) {
        // nagłówek
      } else {
        if (!wantedLetters) {
          // zbuduj mapę nagłówków po wierszu 1
          headerCols = {};
          for (const [letters, val] of headerRow) {
            const h = String(val ?? "").trim().toUpperCase();
            if (wantedHeaders.includes(h) && !Object.values(headerCols).includes(h)) headerCols[letters] = h;
          }
          wantedLetters = new Set(Object.keys(headerCols));
        }
        if (!wantedLetters.has(col)) continue;
      }
      const attrs = m[3];
      const inner = m[5];
      let v = null;
      if (inner !== undefined) {
        const t = /\bt="([^"]+)"/.exec(attrs)?.[1];
        if (t === "inlineStr") v = textOf(inner);
        else {
          const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
          if (vm) {
            const raw = vm[1];
            if (t === "s") v = ss(+raw);
            else if (t === "str" || t === "e") v = unesc(raw);
            else if (t === "b") v = raw === "1";
            else { const n = Number(raw); v = Number.isFinite(n) ? n : unesc(raw); }
          }
        }
      }
      if (rowNum === 1) { headerRow.set(col, v); continue; }
      if (v === null || v === "") continue;
      let r = rowsByNum.get(rowNum);
      if (!r) { r = {}; rowsByNum.set(rowNum, r); }
      r[headerCols[col]] = v;
    }
    if (!headerCols) {
      headerCols = {};
      for (const [letters, val] of headerRow) {
        const h = String(val ?? "").trim().toUpperCase();
        if (wantedHeaders.includes(h)) headerCols[letters] = h;
      }
    }
    out[name] = { headers: headerCols, rows: [...rowsByNum.values()] };
  }
  return out;
}

/** Inspekcja: nagłówek + kilka pierwszych wierszy każdego arkusza (do mapowania kolumn). */
export function inspectWorkbook(bytes, maxRows = 4) {
  const meta = unzipSync(bytes, { filter: (f) => f.name === "xl/workbook.xml" || f.name === "xl/_rels/workbook.xml.rels" });
  const wbXml = strFromU8(meta["xl/workbook.xml"]);
  const relXml = strFromU8(meta["xl/_rels/workbook.xml.rels"]);
  const rels = {};
  for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    let t = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (!id || !t) continue;
    rels[id] = t.startsWith("/") ? t.slice(1) : "xl/" + t;
  }
  const sheets = [];
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unesc(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? "");
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    const hidden = /\bstate="(hidden|veryHidden)"/.test(m[0]);
    if (rid && rels[rid]) sheets.push({ name, path: rels[rid], hidden });
  }
  const need = new Set(sheets.map((s) => s.path));
  const files = unzipSync(bytes, { filter: (f) => need.has(f.name) || f.name === "xl/sharedStrings.xml" });
  const ssXml = files["xl/sharedStrings.xml"] ? strFromU8(files["xl/sharedStrings.xml"]) : "";
  const siPos = [];
  for (let i = ssXml.indexOf("<si"); i >= 0; i = ssXml.indexOf("<si", i + 3)) {
    const c = ssXml[i + 3];
    if (c === ">" || c === " " || c === "/") siPos.push(i);
  }
  const ss = (k) => {
    const a = siPos[k];
    if (a === undefined) return null;
    const head = ssXml.indexOf(">", a);
    if (ssXml[head - 1] === "/") return "";
    return textOf(ssXml.slice(head + 1, ssXml.indexOf("</si>", head)));
  };
  const out = [];
  for (const s of sheets) {
    const xml = files[s.path] ? strFromU8(files[s.path]) : "";
    const dim = /<dimension ref="([^"]+)"/.exec(xml)?.[1] ?? null;
    const rows = {};
    const cellRe = /<c r="([A-Z]+)(\d+)"([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
    let m;
    while ((m = cellRe.exec(xml))) {
      const rowNum = +m[2];
      if (rowNum > maxRows) break;
      const inner = m[5];
      if (inner === undefined) continue;
      const t = /\bt="([^"]+)"/.exec(m[3])?.[1];
      let v = null;
      if (t === "inlineStr") v = textOf(inner);
      else {
        const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (vm) v = t === "s" ? ss(+vm[1]) : unesc(vm[1]);
      }
      if (v === null || v === "") continue;
      (rows[rowNum] ??= {})[m[1]] = typeof v === "string" && v.length > 60 ? v.slice(0, 60) + "…" : v;
    }
    out.push({ name: s.name, hidden: s.hidden, dim, rows });
  }
  return out;
}
