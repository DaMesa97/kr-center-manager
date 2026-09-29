// Druk dokumentów PDF (deklaracje DoP) przez istniejący kanał label:printHtml.
// pdfjs renderuje strony do obrazków, sklejamy w HTML 1:1 z rozmiarem strony
// PDF-a i drukujemy po cichu na wybraną drukarkę — czyli dokładnie tą samą
// drogą co etykiety. Zero zależności od zewnętrznych czytników PDF.

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

// ~180 dpi — ostry tekst deklaracji, rozsądny rozmiar danych
const RENDER_SCALE = 2.5
const PT_TO_MM = 25.4 / 72

export function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function uint8ToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

/** Strony PDF-a jako obrazki (dataURL) + rozmiar strony w mm. */
export async function renderPdfPages(
  pdfBase64: string,
): Promise<{ imgs: string[]; widthMm: number; heightMm: number }> {
  const pdf = await getDocument({ data: base64ToUint8(pdfBase64) }).promise
  const imgs: string[] = []
  let widthMm = 210
  let heightMm = 297

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const base = page.getViewport({ scale: 1 })
    if (p === 1) {
      widthMm = Math.round(base.width * PT_TO_MM * 10) / 10
      heightMm = Math.round(base.height * PT_TO_MM * 10) / 10
    }
    const viewport = page.getViewport({ scale: RENDER_SCALE })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Brak kontekstu canvas')
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    imgs.push(canvas.toDataURL('image/png'))
  }
  return { imgs, widthMm, heightMm }
}

export async function renderPdfForPrint(
  pdfBase64: string,
  title: string,
): Promise<{ html: string; widthMm: number; heightMm: number; pages: number }> {
  const { imgs, widthMm, heightMm } = await renderPdfPages(pdfBase64)

  const body = imgs
    .map(
      (src, i) =>
        `<img src="${src}" style="width:${widthMm}mm;height:${heightMm}mm;display:block;${i < imgs.length - 1 ? 'page-break-after:always;' : ''}" />`,
    )
    .join('')

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
    @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
    html, body { margin: 0; padding: 0; }
  </style></head><body>${body}</body></html>`

  return { html, widthMm, heightMm, pages: imgs.length }
}
