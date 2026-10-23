// Wyciąga z PDF tekst z położeniem (pdfjs, node) i zapisuje jako PdfTextPage[]
// (kontrakt w src/types.ts). Służy do generowania fixture testów parsera
// aluminium (src/__tests__/fixtures/alu/*.json) — testy nie dotykają PDF-ów.
//
// Użycie: node scripts/pdf-text-fixture.mjs <in.pdf> <out.json>
//
// Układ współrzędnych: punkty PDF (viewport scale 1), y rośnie W DÓŁ strony
// (y = height - transform[5]), czyli tak, jak czyta się kartkę. To samo robi
// src/lib/pdfText.ts w rendererze — oba muszą dawać identyczny wynik.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const round = (v) => Math.round(v * 100) / 100

export async function extractPdfTextPagesNode(data) {
  const pdf = await getDocument({ data, useSystemFonts: true }).promise
  const pages = []
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const items = []
      for (const it of content.items) {
        if (!('str' in it)) continue
        const str = it.str
        if (!str || !str.trim()) continue
        const [, , , , tx, ty] = it.transform
        items.push({
          str,
          x: round(tx),
          y: round(viewport.height - ty),
          w: round(it.width),
          h: round(it.height),
        })
      }
      pages.push({
        pageNumber: p,
        width: round(viewport.width),
        height: round(viewport.height),
        items,
      })
    }
  } finally {
    await pdf.destroy()
  }
  return pages
}

async function main() {
  const [, , inPath, outPath] = process.argv
  if (!inPath || !outPath) {
    console.error('Użycie: node scripts/pdf-text-fixture.mjs <in.pdf> <out.json>')
    process.exit(1)
  }
  const buf = await readFile(path.resolve(inPath))
  const pages = await extractPdfTextPagesNode(new Uint8Array(buf))
  await writeFile(path.resolve(outPath), JSON.stringify(pages, null, 1) + '\n', 'utf8')
  const total = pages.reduce((n, p) => n + p.items.length, 0)
  console.log(`${path.basename(inPath)}: ${pages.length} stron, ${total} elementów tekstu → ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
