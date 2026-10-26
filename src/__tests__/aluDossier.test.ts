import { describe, expect, it } from 'vitest'
import { currentDocument, currentDocuments, documentVersions } from '../lib/aluDossier'
import type { OrderDocument } from '../types'

const doc = (over: Partial<OrderDocument>): OrderDocument => ({
  id: 1, order_id: 1, kind: 'LP', number: null, storage_path: 'p', file_name: 'f.pdf',
  uploaded_by: null, uploaded_at: '', version: 1, withdrawn_at: null, withdraw_reason: null, ...over,
})

describe('teczka: wersje dokumentów (ZKP 5.1.6)', () => {
  const docs = [
    doc({ id: 1, kind: 'LP', version: 1 }),
    doc({ id: 2, kind: 'LP', version: 2 }),
    doc({ id: 3, kind: 'LP', version: 3, withdrawn_at: '2026-10-26', withdraw_reason: 'pomyłka' }),
    doc({ id: 4, kind: 'LC', version: 1 }),
    doc({ id: 5, kind: 'ZK', version: 1, withdrawn_at: '2026-10-26', withdraw_reason: 'zły klient' }),
  ]
  it('wersje najnowsza pierwsza, także wycofane', () => {
    expect(documentVersions(docs, 'LP').map((d) => d.version)).toEqual([3, 2, 1])
  })
  it('bieżąca = najwyższa niewycofana', () => {
    expect(currentDocument(docs, 'LP')?.id).toBe(2)
    expect(currentDocument(docs, 'LC')?.id).toBe(4)
  })
  it('rodzaj tylko z wycofanymi wersjami nie ma bieżącej', () => {
    expect(currentDocument(docs, 'ZK')).toBeUndefined()
    expect(currentDocuments(docs).map((d) => d.kind).sort()).toEqual(['LC', 'LP'])
  })
})
