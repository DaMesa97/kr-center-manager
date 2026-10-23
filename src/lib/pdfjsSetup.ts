// Wspólna konfiguracja workera pdfjs dla renderera (Vite/Electron).
// Używają jej pdfPrint.ts (druk DoP) i pdfText.ts (import LP/LC aluminium).
//
// ?worker = Vite tworzy prawdziwego workera modułowego (workerSrc przez ?url
// potrafił nigdy nie wystartować → getDocument wisiał bez błędu).

import { GlobalWorkerOptions } from 'pdfjs-dist'
import PdfJsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'

let started = false

/** Podpina workera pdfjs (raz na proces renderera). Wielokrotne wywołanie jest bezpieczne. */
export function ensurePdfJsWorker(): void {
  if (started) return
  GlobalWorkerOptions.workerPort = new PdfJsWorker()
  started = true
}

// Przy workerPort wszystkie dokumenty dzielą JEDEN PDFWorker, a destroy()
// dokumentu niszczy też workera — druk DoP w trakcie importu LP (i odwrotnie)
// zrywał drugą operację. Dokumenty idą więc po kolei, każdy aż do destroy().
let queue: Promise<unknown> = Promise.resolve()

export function runPdfJsExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}
