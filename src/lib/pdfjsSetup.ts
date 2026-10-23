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
