// Tekst z PDF z położeniem (renderer, pdfjs + worker Vite). Wynik = PdfTextPage[]
// — wejście parsera LP/LC aluminium (aluLpParser.ts).
//
// Ta sama logika co scripts/pdf-text-fixture.mjs (node, generowanie fixture do
// testów) — zmiany tutaj → zmień też tam, inaczej fixture rozjadą się z aplikacją.
//
// Układ współrzędnych: punkty PDF (viewport scale 1), y rośnie W DÓŁ strony
// (y = height - transform[5]), czyli tak, jak czyta się kartkę.

import { getDocument } from 'pdfjs-dist'
import type { PdfTextItem, PdfTextPage } from '../types'
import { ensurePdfJsWorker, runPdfJsExclusive } from './pdfjsSetup'

const round = (v: number): number => Math.round(v * 100) / 100

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} — przekroczono ${ms / 1000}s`)), ms),
    ),
  ])
}

export function extractPdfTextPages(data: ArrayBuffer | Uint8Array): Promise<PdfTextPage[]> {
  return runPdfJsExclusive(() => extractPdfTextPagesNow(data))
}

async function extractPdfTextPagesNow(data: ArrayBuffer | Uint8Array): Promise<PdfTextPage[]> {
  ensurePdfJsWorker()
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const pdf = await withTimeout(getDocument({ data: bytes }).promise, 20000, 'Otwieranie PDF (pdfjs)')
  const pages: PdfTextPage[] = []
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await withTimeout(pdf.getPage(p), 15000, `Strona ${p} PDF`)
      const viewport = page.getViewport({ scale: 1 })
      const content = await withTimeout(page.getTextContent(), 15000, `Tekst strony ${p} PDF`)
      const items: PdfTextItem[] = []
      for (const it of content.items) {
        if (!('str' in it)) continue
        if (!it.str || !it.str.trim()) continue
        const tx = it.transform[4]
        const ty = it.transform[5]
        items.push({
          str: it.str,
          x: round(tx),
          y: round(viewport.height - ty),
          w: round(it.width),
          h: round(it.height),
        })
      }
      pages.push({ pageNumber: p, width: round(viewport.width), height: round(viewport.height), items })
    }
    return pages
  } finally {
    await withTimeout(pdf.destroy(), 5000, 'Zamykanie PDF').catch(() => {})
  }
}
