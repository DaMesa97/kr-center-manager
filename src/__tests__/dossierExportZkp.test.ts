import { describe, expect, it } from 'vitest'
import { buildDossierTocDefinition, zkpGeneratedEntryName, type ZkpGeneratedDoc } from '../lib/dossierExport'
import type { AluOrderTrace } from '../lib/aluTraceData'

// D61: eksport teczki ZKP z kartami wyrobu, protokołami 6.17.5 i deklaracjami generowanymi z programu
describe('D61: dokumenty ZKP w paczce teczki', () => {
  it('nazwy plików: folder, prefiks, „/” w numerze → „-”, sufiks', () => {
    expect(zkpGeneratedEntryName('karta', '2026/12/04')).toBe('karty_wyrobu_6.25/Karta_wyrobu_2026-12-04.pdf')
    expect(zkpGeneratedEntryName('protokol', 'PB/2026/12/04/2', 'OTWARTY')).toBe('protokoly_6.17.5/Protokol_PB-2026-12-04-2_OTWARTY.pdf')
    expect(zkpGeneratedEntryName('deklaracja', 'DWU 3/2026', 'WYCOFANA')).toBe('deklaracje_6.9/DWU_3-2026_WYCOFANA.pdf')
  })

  const trace = {
    order: { id: 7, order_number: 'OF1/2026', company: 'Firma', release_date: null, extra_fields: { alu: { realizacja: 'wysylka' } } },
    positions: [],
    constructions: [],
    documents: [],
    production: null,
    dossier: [],
    isZkp: true,
    zkpOverride: null,
  } as unknown as AluOrderTrace
  const base = { trace, docs: [], entryNames: [], failed: new Set<number>(), exportedAt: new Date(2026, 10, 28), exportedBy: '', appVersion: 'test' }

  it('spis treści: część 4 z wygenerowanymi plikami i nowa notka', () => {
    const generated: ZkpGeneratedDoc[] = [
      { kind: 'karta', name: zkpGeneratedEntryName('karta', '2026/12/01'), ident: '2026/12/01', state: 'ZWOLNIONY' },
      { kind: 'deklaracja', name: zkpGeneratedEntryName('deklaracja', 'DWU/1/2026'), ident: 'DWU/1/2026', state: 'wydana', failed: true },
    ]
    const text = JSON.stringify(buildDossierTocDefinition({ ...base, generated }).content)
    expect(text).toContain('4. Dokumenty ZKP wygenerowane z programu — 2')
    expect(text).toContain('karty_wyrobu_6.25/Karta_wyrobu_2026-12-01.pdf')
    expect(text).toContain('NIE WYGENEROWANO')
    expect(text).not.toContain('dopóki program ich nie generuje')
  })

  it('bez części 4 (stara paczka) — dawna notka', () => {
    const text = JSON.stringify(buildDossierTocDefinition(base).content)
    expect(text).not.toContain('4. Dokumenty ZKP')
    expect(text).toContain('dopóki program ich nie generuje')
  })
})
