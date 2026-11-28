import { describe, expect, it } from 'vitest'
import { scopeByCategory } from '../lib/permissions'
import { scopeExcelRuns, type ExcelSyncRun, type ExcelSyncItem } from '../hooks/useExcelSync'

// D11 (28.11.2026): kierownik działu widzi w Weryfikacji tylko swoje kategorie.
describe('D11: Weryfikacja zawężona do kategorii kierownika działu', () => {
  const rows = [
    { id: 1, category: 'STA' },
    { id: 2, category: 'Bastion' },
    { id: 3, category: null },
  ]

  it('kierownik działu — tylko przypisane kategorie', () => {
    expect(scopeByCategory(rows, 'kierownik_dzialu', ['STA']).map((r) => r.id)).toEqual([1])
    expect(scopeByCategory(rows, 'kierownik_dzialu', []).map((r) => r.id)).toEqual([])
  })

  it('admin / kierownik produkcji — bez zawężenia (ta sama tablica)', () => {
    expect(scopeByCategory(rows, 'admin', ['STA'])).toBe(rows)
    expect(scopeByCategory(rows, 'kierownik_produkcji', null)).toBe(rows)
  })

  it('synchronizacja Excela — pozycje spoza kategorii odpadają, puste przebiegi znikają', () => {
    const item = (id: number, category: string): ExcelSyncItem => ({
      id, order_number: String(id), category, company: null, model: null, order_date: null,
      excel_row: null, how: null, wydanie: null, status: 'inne', powiazane_id: null,
    })
    const runs: ExcelSyncRun[] = [
      { id: 1, created_at: '2026-11-28', source: null, kategoria: 'STA', summary: {}, items: [item(1, 'STA'), item(2, 'Disting')] },
      { id: 2, created_at: '2026-11-28', source: null, kategoria: 'Bastion', summary: {}, items: [item(3, 'Bastion')] },
    ]
    const s = scopeExcelRuns(runs, ['STA'])
    expect(s).toHaveLength(1)
    expect(s[0].items.map((i) => i.id)).toEqual([1])
    expect(scopeExcelRuns(runs, null)).toBe(runs)
  })
})
