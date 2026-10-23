import { describe, expect, it } from 'vitest'
import {
  cleanAluColor,
  detectConstructionType,
  humanizeProductionNotes,
  parseAluDateTime,
  parseAluDocument,
  parseAluLc,
  parseAluLp,
} from '../lib/aluLpParser'
import type { PdfTextPage } from '../types'
import lpFixture from './fixtures/alu/LP_0003_10_2026.json'
import lcFixture from './fixtures/alu/LC_0004_10_2026.json'

// Fixture = tekst z położeniem wyciągnięty z prawdziwych PDF-ów AluronCAD
// (scripts/pdf-text-fixture.mjs). Testy nie dotykają PDF-ów ani pdfjs.

const lpPages = (): PdfTextPage[] => structuredClone(lpFixture) as PdfTextPage[]
const lcPages = (): PdfTextPage[] => structuredClone(lcFixture) as PdfTextPage[]

describe('parseAluDocument — rozpoznanie typu', () => {
  it('LP → kind LP', () => {
    expect(parseAluDocument(lpPages())?.kind).toBe('LP')
  })
  it('LC → kind LC', () => {
    expect(parseAluDocument(lcPages())?.kind).toBe('LC')
  })
  it('inny PDF → null, pusty → null', () => {
    const other: PdfTextPage[] = [
      { pageNumber: 1, width: 595, height: 842, items: [{ str: 'Faktura VAT 12/2026', x: 30, y: 40, w: 100, h: 10 }] },
    ]
    expect(parseAluDocument(other)).toBeNull()
    expect(parseAluDocument([])).toBeNull()
  })
})

describe('parseAluLp — LP_0003_10_2026 (1 pozycja, drzwi)', () => {
  const res = parseAluLp(lpPages())

  it('nagłówek', () => {
    expect(res.header.lp_number).toBe('LP 0003/10/2026')
    expect(res.header.order_number).toBe('OF341/2026')
    expect(res.header.created_at).toBe('2026-10-23T16:59:12')
    expect(res.header.client).toBe('')
    expect(res.header.positions_count).toBe(1)
    expect(res.header.area_m2).toBe(2.2)
    expect(res.header.weight_kg).toBe(54.5)
    expect(res.header.deadline_text).toBe('Wyznaczany indywidualnie, po ustaleniu szczegółów zamówienia.')
  })

  it('jedna pozycja — opis, system, kolory, wypełnienia', () => {
    expect(res.positions).toHaveLength(1)
    const p = res.positions[0]
    expect(p.pos_no).toBe(1)
    expect(p.description).toBe('AS 75 + AS 75P - drzwi otwierane do wewnątrz')
    expect(p.construction_type).toBe('drzwi')
    expect(p.system).toBe('AS75')
    expect(p.profile_color).toBe('10/AR-RAL8019-MAT')
    expect(p.hardware_color.startsWith('9R/AR-RAL8019-MAT')).toBe(true)
    expect(p.hardware_color).not.toContain('[')
    expect(p.fillings).toContain('Blacha Aluminiowa 1')
    expect(p.fillings).toContain('Q-Tape')
    expect(p.fillings).toContain('4F/16AR/4T')
  })

  it('wymiary z ościeżnicy, ilość, ciężar, U', () => {
    const p = res.positions[0]
    expect(p.width_mm).toBe(1090)
    expect(p.height_mm).toBe(2060)
    expect(p.quantity).toBe(1)
    expect(p.weight_kg).toBe(54.54)
    expect(p.u_value).toBe(1.8)
  })

  it('uwagi produkcyjne po ludzku', () => {
    const n = res.positions[0].notes
    expect(n.okucia).toContain('WALA MEX')
    expect(n.klamka).toContain('WALA D321')
    expect(n.klamka).toContain('MEDOS D421')
    expect(n.klamka).not.toMatch(/\bNie\b/)
    expect(n.klamka).not.toMatch(/\bBrak\b/)
    expect(n.klamka?.startsWith('Zamek ')).toBe(true)
    expect(n.dodatki).toContain('GEZE TS 2000')
    expect(n.prog).toContain('P2601X')
    expect(n.inne).toBeUndefined()
  })

  it('szkło: dokładnie jedna szyba (blachy/Q-Tape pominięte)', () => {
    expect(res.positions[0].glass).toEqual([{ spec: '4/16/4 Ug=1,1', width_mm: 841, height_mm: 1022, qty: 1 }])
  })

  it('bez ostrzeżeń', () => {
    expect(res.warnings).toEqual([])
    expect(res.positions[0].warnings).toEqual([])
  })
})

describe('parseAluLp — odporność', () => {
  it('dwie pozycje rozdzielone po stopce `OF (N)`', () => {
    const pages = lpPages()
    const second = structuredClone(pages).map((p, i) => {
      const page: PdfTextPage = { ...p, pageNumber: pages.length + i + 1 }
      for (const it of page.items) {
        if (it.str === 'OF341/2026 (1)') it.str = 'OF341/2026 (2)'
        if (it.str.startsWith('Poz.: 1 ')) it.str = 'Poz.: 2 AS 75 - okno uchylne'
      }
      return page
    })
    const res = parseAluLp([...pages, ...second])
    expect(res.positions.map((p) => p.pos_no)).toEqual([1, 2])
    expect(res.positions[1].description).toBe('AS 75 - okno uchylne')
    expect(res.positions[1].construction_type).toBe('okno')
    expect(res.positions[1].glass).toHaveLength(1)
    // nagłówek mówi o 1 pozycji — rozjazd ma być zgłoszony, nie przemilczany
    expect(res.warnings.some((w) => w.includes('odczytano 2'))).toBe(true)
  })

  it('sama strona z rysunkiem (brak sekcji) → warnings, bez wyjątku', () => {
    const res = parseAluLp([lpPages()[0]])
    expect(res.positions).toHaveLength(1)
    const p = res.positions[0]
    expect(p.description).toContain('drzwi')
    expect(p.width_mm).toBeNull()
    expect(p.height_mm).toBeNull()
    expect(p.glass).toEqual([])
    expect(p.notes).toEqual({})
    expect(p.warnings.some((w) => w.includes('Profile'))).toBe(true)
    expect(p.warnings.some((w) => w.includes('Szklenie'))).toBe(true)
    expect(p.warnings.some((w) => w.includes('Uwagi produkcyjne'))).toBe(true)
  })

  it('pusty dokument → puste pola + warning', () => {
    const res = parseAluLp([])
    expect(res.positions).toEqual([])
    expect(res.header.lp_number).toBe('')
    expect(res.warnings.length).toBeGreaterThan(0)
  })
})

describe('parseAluLc — LC_0004_10_2026', () => {
  it('numer LC, zlecenie, klient', () => {
    const res = parseAluLc(lcPages())
    expect(res.lc_number).toBe('LC 0004/10/2026')
    expect(res.order_number).toBe('OF341/2026')
    expect(res.client).toBe('')
  })
})

describe('detectConstructionType', () => {
  it('rozpoznaje drzwi / okno / ściankę / inne', () => {
    expect(detectConstructionType('AS 75 + AS 75P - drzwi otwierane do wewnątrz')).toBe('drzwi')
    expect(detectConstructionType('AS 75 - okno uchylno-rozwierane')).toBe('okno')
    expect(detectConstructionType('Okna stałe AS 75')).toBe('okno')
    expect(detectConstructionType('Ścianka stała AS 75')).toBe('scianka')
    expect(detectConstructionType('witryna sklepowa')).toBe('scianka')
    expect(detectConstructionType('Fasada MB-SR50')).toBe('scianka')
    expect(detectConstructionType('Przegroda szklana')).toBe('scianka')
    expect(detectConstructionType('Panel wypełniający')).toBe('inne')
    expect(detectConstructionType('')).toBe('inne')
  })
})

describe('humanizeProductionNotes', () => {
  it('klamka: zamek + lista bez „Nie”/„Brak”', () => {
    const n = humanizeProductionNotes({
      klamka: 'zapadkowo-zasuwkowy (KO / 2.6-11)+WALA D321+MEDOS D421 35/65 klasa A+Nie+Brak',
    })
    expect(n.klamka).toBe('Zamek zapadkowo-zasuwkowy (KO / 2.6-11), WALA D321, MEDOS D421 35/65 klasa A')
  })
  it('klamka z własnym słowem „zamek” nie dostaje drugiego', () => {
    expect(humanizeProductionNotes({ klamka: 'Zamek hakowy+Nie' }).klamka).toBe('Zamek hakowy')
  })
  it('próg: powtórzona etykieta wylatuje, wielka litera', () => {
    expect(humanizeProductionNotes({ prog: 'Próg aluminiowy P2601X' }).prog).toBe('Aluminiowy P2601X')
    expect(humanizeProductionNotes({ prog: 'Próg: Próg aluminiowy P2601X' }).prog).toBe('Aluminiowy P2601X')
  })
  it('okucia / dodatki bez zmian poza porządkami', () => {
    const n = humanizeProductionNotes({
      okucia: '3 zawiasy trzyskrzydelkowe nawierzchniowe WALA MEX',
      dodatki: 'Samozamykacz  GEZE TS 2000;  -',
    })
    expect(n.okucia).toBe('3 zawiasy trzyskrzydelkowe nawierzchniowe WALA MEX')
    expect(n.dodatki).toBe('Samozamykacz GEZE TS 2000')
  })
  it('puste i same „Nie”/„Brak” → brak klucza', () => {
    expect(humanizeProductionNotes({})).toEqual({})
    expect(humanizeProductionNotes({ klamka: 'Nie', dodatki: 'Brak+Nie', prog: '', okucia: '  ' })).toEqual({})
  })
})

describe('pomocnicze', () => {
  it('parseAluDateTime', () => {
    expect(parseAluDateTime('23.10.2026 16:59:12')).toBe('2026-10-23T16:59:12')
    expect(parseAluDateTime('23.10.2026 9:05')).toBe('2026-10-23T09:05:00')
    expect(parseAluDateTime('23.10.2026')).toBe('2026-10-23')
    expect(parseAluDateTime('')).toBeNull()
    expect(parseAluDateTime('brak')).toBeNull()
  })
  it('cleanAluColor', () => {
    expect(cleanAluColor('9R/AR-RAL8019-MAT [Aluron Color Collectoin 2 okucia];92 [brazowy]')).toBe(
      '9R/AR-RAL8019-MAT; 92 brązowy',
    )
    expect(cleanAluColor('10/AR-RAL8019-MAT')).toBe('10/AR-RAL8019-MAT')
    expect(cleanAluColor('')).toBe('')
  })
})
