import { describe, expect, it } from 'vitest'
// Testujemy PRAWDZIWY kod Edge Function (importy URL podmienione stubami
// w vitest.config.ts). To ta sama logika, którą wdraża się do Supabase.
import {
  combineDim,
  determineCategory,
  emptyStagesFor,
  isBastionSystem,
  isTitanSystem,
  mapExcelRow,
  typToWykonawca,
} from '../../supabase/functions/orders-excel-intake/index'

describe('determineCategory — rozpoznawanie kategorii po systemie', () => {
  it('Titan (CORE/GUARD) → STA (baza trójki)', () => {
    expect(determineCategory('CORE')).toBe('STA')
    expect(determineCategory('GUARD RC3 EI 30')).toBe('STA')
  })
  it('DISTING* → Disting, TECHNIC* → Techniczne', () => {
    expect(determineCategory('DISTING PLUS')).toBe('Disting')
    expect(determineCategory('TECHNICZNE 80')).toBe('Techniczne')
  })
  it('rodziny Bastiona: BASIC/PREMIUM/BOLD/SILENT (z wariantami)', () => {
    expect(determineCategory('BASIC LOCK PLUS')).toBe('Bastion')
    expect(determineCategory('PREMIUM RC2')).toBe('Bastion')
    expect(determineCategory('BOLD PLUS')).toBe('Bastion')
    expect(determineCategory('SILENT')).toBe('Bastion')
    expect(isBastionSystem('basic')).toBe(true)
  })
  it('ST* → ST, reszta → STA', () => {
    expect(determineCategory('ST72')).toBe('ST')
    expect(determineCategory('NORMAL')).toBe('STA')
  })
  it('spójność z aplikacją: te same słowa kluczowe Titana', () => {
    expect(isTitanSystem('GUARD RC2')).toBe(true)
    expect(isTitanSystem('NORMAL')).toBe(false)
  })
})

describe('typToWykonawca — Typ → firma fakturująca', () => {
  it('KR i C* → Center; P* → Profil; W*/Z* → WZ', () => {
    expect(typToWykonawca('KR')).toBe('Center')
    expect(typToWykonawca('CD')).toBe('Center')
    expect(typToWykonawca('PD')).toBe('Profil')
    expect(typToWykonawca('WZ')).toBe('WZ')
    expect(typToWykonawca('Z')).toBe('WZ')
    expect(typToWykonawca('')).toBe('')
  })
})

describe('combineDim', () => {
  it('obie wartości → "S×W"; jedna → ta jedna; brak → ""', () => {
    expect(combineDim('90', '2000')).toBe('90×2000')
    expect(combineDim('90', '')).toBe('90')
    expect(combineDim('', '')).toBe('')
  })
})

describe('emptyStagesFor — komplet kluczy etapów per kategoria', () => {
  it('Bastion ma etapy produkcyjne, Techniczne nie ma żadnych', () => {
    expect(Object.keys(emptyStagesFor('Bastion'))).toContain('okuwanie_skrzydla')
    expect(emptyStagesFor('Techniczne')).toEqual({})
    expect(Object.keys(emptyStagesFor('STA'))).toContain('e2_2')
    expect(Object.keys(emptyStagesFor('ST'))).toContain('osc')
  })
})

describe('mapExcelRow — mapowanie wiersza z arkusza (JSON po polsku)', () => {
  // Realny kształt wiersza Bastiona (przykład od użytkownika)
  const bastionRow = {
    'Nazwa firmy': 'ADAM KOŚCIELNY Wodzisław ŚL.',
    'Produkcja': 'ŚRODA',
    'Ilość': '2',
    'System': 'BASIC LOCK PLUS',
    'Model': 'STD-01',
    'Kolor skrzydła cał.': 'AKACJA',
    'Kolor skrzydła WF': 'BIEL',
    'Kolor ościeżnicy cał.': 'AKACJA',
    'Ościeżnica': 'DREWNIANA REGULOWANA',
    'Regulacja ościeżnicy': '150',
    'Kolor progu': 'SREBRNY',
    'Szerokość': '70',
    'Kierunek': 'PRAWE',
    'Wysokość': 'std',
    'Okucia': 'KR CENTER',
    'Wizjer': 'SREBRNY',
    'Uwagi 2': 'notatka',
    'Panel boczny klamkowy': '370×2080',
    'Panel górny': '900×400',
    'Numer zlecenia': '4145',
    'Typ': 'KR',
    'Wpisał': 'Dawid',
  }

  it('Bastion: kategoria, kolory cał., kolumny bastion_*, panele, autor', () => {
    const p = mapExcelRow(bastionRow)!
    expect(p.category).toBe('Bastion')
    expect(p.order_number).toBe('4145')
    expect(p.quantity).toBe(2)
    expect(p.wing_color).toBe('AKACJA')
    expect(p.frame_color).toBe('AKACJA')
    expect(p.threshold_color).toBe('SREBRNY')
    expect(p.bastion_frame_type).toBe('DREWNIANA REGULOWANA')
    expect(p.bastion_frame_range).toBe('150')
    expect(p.bastion_notes_2).toBe('notatka')
    expect(p.bastion_side_panel_k).toBe('370×2080')
    expect(p.bastion_top_panel).toBe('900×400')
    expect(p.entered_by).toBe('Dawid')
    expect(p.source).toBe('excel')
    expect((p.extra_fields as Record<string, unknown>).wykonawca).toBe('Center')
    expect((p.extra_fields as Record<string, unknown>).kolor_skrzydla_wf).toBe('BIEL')
  })

  it('autor: łapie warianty nazw kolumny (Operator/Handlowiec)', () => {
    const p = mapExcelRow({ 'Nazwa firmy': 'X', System: 'NORMAL', Operator: 'Kasia' })!
    expect(p.entered_by).toBe('Kasia')
  })

  it('STA: dostawki A/B ze wspólną wysokością, naświetle łączone S×W', () => {
    const p = mapExcelRow({
      'Nazwa firmy': 'X',
      'System': 'NORMAL',
      'Szerokość dostawki bocznej A': '370',
      'Wysokość dostawki': '2080',
      'Szklenie dostawki': 'MLECZNE',
      'Szerokość naświetla': '900',
      'Wysokość naświetla': '400',
    })!
    expect(p.side_panel_a).toBe('370×2080')
    expect(p.side_panel_a_glazing).toBe('MLECZNE')
    expect(p.side_panel_b).toBe('') // brak szerokości B → brak dostawki B
    expect(p.top_light).toBe('900×400')
  })

  it('śmieciowa ilość → 1; wiersz bez firmy i systemu → null (pomijany)', () => {
    const p = mapExcelRow({ 'Nazwa firmy': 'X', System: 'NORMAL', 'Ilość': 'abc' })!
    expect(p.quantity).toBe(1)
    expect(mapExcelRow({ 'Uwagi': 'samotna notatka' })).toBeNull()
  })
})
