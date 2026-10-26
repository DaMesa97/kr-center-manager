import type { OrderDocument, OrderDocumentKind } from '../types'

// Teczka zlecenia (ZKP 5.9). Dokumenty mają wersje — nowy plik nie nadpisuje
// poprzedniego, a dokument można tylko wycofać z powodem (ZKP 5.1.6, zał. 6.34).

export const DOC_KIND_LABELS: Record<OrderDocumentKind, string> = {
  LP: 'Lista produkcyjna',
  LC: 'Lista cięć',
  ZM: 'ZM GLASS (szyby)',
  ZK: 'Zamówienie klienta',
  ZMAT: 'Zamówienie materiałów',
  MONT: 'Protokół montażu',
  INNE: 'Inny dokument',
  LM: 'Lista materiałowa',
}

/** Rodzaje dokumentów wgrywane ręcznie do teczki (LP/LC/ZM/LM idą przez import). */
export const DOSSIER_UPLOAD_KINDS: OrderDocumentKind[] = ['ZK', 'ZMAT', 'MONT', 'INNE']

const isActive = (d: OrderDocument) => !d.withdrawn_at

/** Wszystkie wersje danego rodzaju, najnowsza pierwsza (także wycofane). */
export function documentVersions(docs: OrderDocument[], kind: OrderDocumentKind): OrderDocument[] {
  return docs.filter((d) => d.kind === kind).sort((a, b) => (b.version ?? 1) - (a.version ?? 1) || b.id - a.id)
}

/** Bieżąca wersja rodzaju = najwyższa niewycofana; brak → undefined. */
export function currentDocument(docs: OrderDocument[], kind: OrderDocumentKind): OrderDocument | undefined {
  return documentVersions(docs, kind).find(isActive)
}

/** Bieżące wersje wszystkich rodzajów (po jednej na rodzaj). */
export function currentDocuments(docs: OrderDocument[]): OrderDocument[] {
  const kinds = Array.from(new Set(docs.map((d) => d.kind)))
  return kinds.map((k) => currentDocument(docs, k)).filter((d): d is OrderDocument => d !== undefined)
}
