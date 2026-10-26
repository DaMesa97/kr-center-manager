import { describe, expect, it } from 'vitest'
import { describeTraceQuery, parseTraceQuery } from '../lib/zkpTrace'
import { crc32, zipParts } from '../lib/zipStore'
import { documentState, dossierEntryNames, dossierZipName, sanitizeFileName, sortDocumentsForExport } from '../lib/dossierExport'
import type { OrderDocument } from '../types'

describe('parseTraceQuery — numer z tabliczki', () => {
  it('RRRR/ZZ/PP w różnych zapisach', () => {
    expect(parseTraceQuery('2026/01/03')).toEqual({ kind: 'construction', year: 2026, zz: 1, pp: 3 })
    expect(parseTraceQuery(' 2026 / 1 / 3 ')).toEqual({ kind: 'construction', year: 2026, zz: 1, pp: 3 })
    expect(parseTraceQuery('2026-12-104')).toEqual({ kind: 'construction', year: 2026, zz: 12, pp: 104 })
    expect(parseTraceQuery('Nr serii: 2026/07/02')).toEqual({ kind: 'construction', year: 2026, zz: 7, pp: 2 })
  })

  it('zero w numerze = nie ma takiej konstrukcji', () => {
    expect(parseTraceQuery('2026/00/03')).toBeNull()
    expect(parseTraceQuery('2026/01/00')).toBeNull()
  })

  it('zlecenie w roku, numer OF, ID z QR', () => {
    expect(parseTraceQuery('2026/05')).toEqual({ kind: 'production', year: 2026, zz: 5 })
    expect(parseTraceQuery('of341/2026')).toEqual({ kind: 'order', orderNumber: 'OF341/2026' })
    expect(parseTraceQuery('OF 341 / 2026 (2)')).toEqual({ kind: 'order', orderNumber: 'OF341/2026' })
    expect(parseTraceQuery('341/2026')).toEqual({ kind: 'order', orderNumber: 'OF341/2026' })
    expect(parseTraceQuery('15872')).toEqual({ kind: 'orderId', id: 15872 })
  })

  it('śmieci → null', () => {
    expect(parseTraceQuery('')).toBeNull()
    expect(parseTraceQuery('drzwi')).toBeNull()
  })

  it('opis do komunikatu', () => {
    expect(describeTraceQuery({ kind: 'construction', year: 2026, zz: 1, pp: 3 })).toBe('konstrukcji 2026/01/03')
    expect(describeTraceQuery({ kind: 'production', year: 2026, zz: 12 })).toBe('zlecenia 2026/12')
  })
})

describe('zipStore — ZIP bez kompresji', () => {
  it('CRC-32 zgodne ze standardem', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('nagłówki, katalog centralny i koniec archiwum', () => {
    const data = new TextEncoder().encode('zażółć')
    const parts = zipParts([{ name: 'dokumenty/łąka.txt', data, date: new Date(2026, 9, 26, 12, 0, 0) }])
    const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
    let o = 0
    for (const p of parts) {
      all.set(p, o)
      o += p.length
    }
    const v = new DataView(all.buffer)
    expect(v.getUint32(0, true)).toBe(0x04034b50)
    expect(v.getUint16(6, true)).toBe(0x0800) // UTF-8
    expect(v.getUint32(14, true)).toBe(crc32(data))
    expect(v.getUint32(18, true)).toBe(data.length)
    const end = all.length - 22
    expect(v.getUint32(end, true)).toBe(0x06054b50)
    expect(v.getUint16(end + 10, true)).toBe(1)
    const cdOffset = v.getUint32(end + 16, true)
    expect(v.getUint32(cdOffset, true)).toBe(0x02014b50)
    expect(v.getUint32(cdOffset + 42, true)).toBe(0) // plik od początku archiwum
  })
})

const doc = (over: Partial<OrderDocument>): OrderDocument => ({
  id: 1, order_id: 7, kind: 'LP', number: null, storage_path: 'x', file_name: 'lp.pdf',
  uploaded_by: null, uploaded_at: '2026-10-26T10:00:00Z', version: 1, ...over,
})

describe('eksport teczki', () => {
  it('kolejność jak w teczce, najnowsza wersja pierwsza', () => {
    const docs = [doc({ id: 1, kind: 'LP', version: 1 }), doc({ id: 2, kind: 'ZK' }), doc({ id: 3, kind: 'LP', version: 2 }), doc({ id: 4, kind: 'INNE' })]
    expect(sortDocumentsForExport(docs).map((d) => d.id)).toEqual([2, 3, 1, 4])
  })

  it('nazwy plików: numer, rodzaj, wersja, wycofany', () => {
    const names = dossierEntryNames([
      doc({ kind: 'LP', version: 2, file_name: 'OF341/2026 lista.pdf' }),
      doc({ kind: 'LP', version: 1, withdrawn_at: '2026-10-20', withdraw_reason: 'błąd' }),
    ])
    expect(names).toEqual(['dokumenty/01_LP_v2_OF341_2026 lista.pdf', 'dokumenty/02_LP_v1_WYCOFANY_lp.pdf'])
  })

  it('sanitizeFileName skraca z zachowaniem rozszerzenia', () => {
    expect(sanitizeFileName('a:b*c?.pdf')).toBe('a_b_c_.pdf')
    const long = sanitizeFileName(`${'x'.repeat(200)}.pdf`, 20)
    expect(long).toHaveLength(20)
    expect(long.endsWith('.pdf')).toBe(true)
  })

  it('stan wersji: bieżąca / archiwalna / wycofana', () => {
    const v1 = doc({ id: 1, version: 1 })
    const v2 = doc({ id: 2, version: 2 })
    const v3 = doc({ id: 3, version: 3, withdrawn_at: '2026-10-26', withdraw_reason: 'zły plik' })
    const all = [v1, v2, v3]
    expect(documentState(v2, all)).toBe('bieżąca')
    expect(documentState(v1, all)).toBe('archiwalna')
    expect(documentState(v3, all)).toBe('wycofana: zły plik')
  })

  it('nazwa paczki', () => {
    expect(dossierZipName('OF341/2026 (2)', new Date(2026, 9, 26))).toBe('Teczka_OF341-2026-(2)_2026-10-26.zip')
  })
})
