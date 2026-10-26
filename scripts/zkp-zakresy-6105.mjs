// Lista numerów katalogowych dopuszczonych w zakresach AS 75EI z zał. 6.10.5.
//
// Użycie (po nowym wydaniu załącznika):
//   1. wyciągnij tekst z .docx (word/document.xml, komórki tabel rozdzielone „ | ”),
//   2. node scripts/zkp-zakresy-6105.mjs "<plik .txt>"
//   3. wgraj migrate/zkp_05b_zakresy_6105.sql (zastępuje całą listę w zkp_range_components).
//
// Reguła: kod jest „na liście” zakresu, jeśli występuje w części B–G pod nagłówkiem
// „Zakres:” obejmującym ten zakres (w tabeli albo w warunkach). Część A (zakresy) i H
// (odbiór dostaw) pomijane. Kod z „XX” na końcu = dowolny kolor.
import { readFileSync, writeFileSync } from 'node:fs'

const inFile = process.argv[2]
if (!inFile) {
  console.error('Podaj plik tekstowy zał. 6.10.5')
  process.exit(1)
}

const RANGES = ['EI30', 'EI30S', 'EI60', 'EI60S', 'S']
const CODE_RE = /\b([A-Z]\d{3,4}(?:XX)?)\b/g
const map = new Map()
let section = ''
let current = []

for (const raw of readFileSync(inFile, 'utf8').split('\n')) {
  const line = raw.trim().replace(/^\|\s*/, '')
  const sec = /^([A-H])(\.\d+(?:\.\d+)?)?\.?\s/.exec(line)
  if (sec && line.length < 200) {
    section = sec[1] + (sec[2] ?? '')
    if (!sec[2]) current = []
  }
  if (/^Zakres(y)?:/.test(line)) {
    current = [...new Set([...line.matchAll(/\b(EI30S|EI60S|EI30|EI60|S)\b(?=\s*\()/g)].map((m) => m[1]))]
    continue
  }
  if (!current.length || section.startsWith('A') || section.startsWith('H')) continue
  for (const m of line.matchAll(CODE_RE)) {
    const e = map.get(m[1]) ?? { ranges: new Set(), sections: new Set() }
    for (const r of current) e.ranges.add(r)
    e.sections.add(section)
    map.set(m[1], e)
  }
}

const codes = [...map.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([code, e]) => ({ code, ranges: RANGES.filter((r) => e.ranges.has(r)), sections: [...e.sections].sort() }))

const today = new Date().toISOString().slice(0, 10)
writeFileSync(
  'docs/zkp/as75ei_zakresy.json',
  JSON.stringify(
    {
      source: 'Zał. 6.10.5 Identyfikacja komponentów ALURON AS 75EI — raporty CERTBUD 1131/ALURON/2020/K-1/8, K-2/8, 3060_1556/K/2',
      note: 'Numer katalogowy jest „na liście” zakresu, jeśli występuje w części B–G załącznika pod nagłówkiem „Zakres:” tego zakresu (w tabeli lub w warunkach). Kod z XX = dowolny kolor.',
      generated: today,
      codes,
    },
    null,
    1,
  ),
)

const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const rows = codes.flatMap((c) => c.ranges.map((r) => `  (${q(r)}, ${q(c.code)}, array[${c.sections.map(q).join(', ')}]::text[])`))
writeFileSync(
  'migrate/zkp_05b_zakresy_6105.sql',
  `-- =====================================================================
-- ZKP AS 75EI — numery katalogowe dopuszczone w zakresach (zał. 6.10.5)
-- WYGENEROWANE (scripts/zkp-zakresy-6105.mjs, ${today}) — nie edytować ręcznie.
-- Po nowym wydaniu 6.10.5: wygenerować ponownie i wgrać (zastępuje całą listę).
-- Wymaga: zkp_05_karta_wyrobu.sql.
-- =====================================================================
begin;
delete from public.zkp_range_components;
insert into public.zkp_range_components (range_code, code, sections) values
${rows.join(',\n')};
commit;
select range_code, count(*) from public.zkp_range_components group by 1 order by 1;
`,
)
console.log(`kodów: ${codes.length}, wierszy: ${rows.length}`)
