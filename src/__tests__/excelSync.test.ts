import { describe, expect, it } from 'vitest'
import { deriveExcelSync, type ExcelSyncOrderInfo, type ExcelSyncRun } from '../hooks/useExcelSync'

// Weryfikacja → „Do wyjaśnienia po synchronizacji z Excelem" (#116):
// reguły budowania list z wyników sync_releases_from_excel.

const info = (p: Partial<ExcelSyncOrderInfo> & { id: number }): ExcelSyncOrderInfo => ({
  order_number: String(p.id),
  category: 'STA',
  company: 'FIRMA',
  model: 'MODEL',
  source: 'excel',
  created_at: '2026-11-01T10:00:00Z',
  release_date: null,
  stock_status: null,
  cancelled: false,
  stagesDone: 0,
  stagesTotal: 5,
  ...p,
})

const run = (kategoria: string, items: ExcelSyncRun['items'], created_at = '2026-11-06T16:57:00Z'): ExcelSyncRun => ({
  id: 1,
  created_at,
  source: `make: Zamówienia ${kategoria}.xlsm`,
  kategoria,
  summary: { kategoria },
  items,
})

const NOW = new Date('2026-11-06T18:00:00Z').getTime()

describe('deriveExcelSync — duplikaty', () => {
  it('grupuje po wierszu Excela, bot na początku (ten zostaje), anulowanych nie pokazuje', () => {
    const runs = [
      run('STA', [
        { id: 10, order_number: '2727', category: 'STA', company: 'X', model: 'TORINO 11', order_date: '2026-10-08', excel_row: 'Profil 2727', how: 'nr klienta + model', wydanie: null, status: 'duplikat', powiazane_id: [11, 12] },
      ]),
    ]
    const orders = new Map<number, ExcelSyncOrderInfo>([
      [10, info({ id: 10, source: 'excel', created_at: '2026-10-08T07:10:00Z' })],
      [11, info({ id: 11, source: 'bot', created_at: '2026-10-08T06:42:00Z' })],
      [12, info({ id: 12, source: 'excel', cancelled: true })],
    ])
    const out = deriveExcelSync(runs, orders, NOW)
    expect(out.duplicates).toHaveLength(1)
    expect(out.duplicates[0].excel_row).toBe('Profil 2727')
    expect(out.duplicates[0].orders.map((o) => o.id)).toEqual([11, 10])
    expect(out.openCount).toBe(1)
  })

  it('grupa znika, gdy zostało co najwyżej jedno otwarte zlecenie', () => {
    const runs = [
      run('STA', [
        { id: 10, order_number: '2727', category: 'STA', company: 'X', model: 'M', order_date: null, excel_row: 'Profil 2727', how: 'airtable', wydanie: null, status: 'duplikat', powiazane_id: [11] },
      ]),
    ]
    const orders = new Map<number, ExcelSyncOrderInfo>([
      [10, info({ id: 10, cancelled: true })],
      [11, info({ id: 11, source: 'bot' })],
    ])
    expect(deriveExcelSync(runs, orders, NOW).duplicates).toHaveLength(0)
  })

  it('ten sam wiersz w dwóch pozycjach przebiegu daje JEDNĄ grupę', () => {
    const runs = [
      run('Bastion', [
        { id: 1, order_number: '40', category: 'Bastion', company: 'PO DRZWI', model: 'A', order_date: null, excel_row: 'Center 44', how: 'airtable', wydanie: '2026-11-06', status: 'duplikat', powiazane_id: [2] },
        { id: 2, order_number: '41', category: 'Bastion', company: 'PO DRZWI', model: 'A', order_date: null, excel_row: 'Center 44', how: 'airtable', wydanie: '2026-11-06', status: 'duplikat', powiazane_id: [1] },
      ]),
    ]
    const orders = new Map<number, ExcelSyncOrderInfo>([
      [1, info({ id: 1, category: 'Bastion' })],
      [2, info({ id: 2, category: 'Bastion' })],
    ])
    const out = deriveExcelSync(runs, orders, NOW)
    expect(out.duplicates).toHaveLength(1)
    expect(out.duplicates[0].orders).toHaveLength(2)
  })
})

describe('deriveExcelSync — anulowane w Excelu, inne, świeżość', () => {
  it('anulowane w Excelu znika po anulowaniu w aplikacji; inne znika po wydaniu', () => {
    const runs = [
      run('Disting', [
        { id: 20, order_number: '3492', category: 'Disting', company: 'S', model: 'NICOLO 01', order_date: null, excel_row: 'Profil 3202', how: 'airtable', wydanie: 'ANULOWANE', status: 'anulowane_w_excelu', powiazane_id: null },
        { id: 21, order_number: '3493', category: 'Disting', company: 'S', model: 'NICOLO 01', order_date: null, excel_row: 'Profil 3203', how: 'airtable', wydanie: 'ANULOWANE', status: 'anulowane_w_excelu', powiazane_id: null },
        { id: 22, order_number: '2771', category: 'Disting', company: 'K', model: 'OTELLO 01', order_date: null, excel_row: 'Center 2567', how: 'nr klienta + model', wydanie: 'WSTRZYMANE', status: 'inne', powiazane_id: null },
        { id: 23, order_number: '2772', category: 'Disting', company: 'K', model: 'OTELLO 01', order_date: null, excel_row: 'Center 2568', how: 'nr klienta + model', wydanie: 'WSTRZYMANE', status: 'inne', powiazane_id: null },
        // statusy robocze automatu nie trafiają do list
        { id: 24, order_number: '1', category: 'Disting', company: 'K', model: 'M', order_date: null, excel_row: 'Center 1', how: 'airtable', wydanie: null, status: 'w_realizacji', powiazane_id: null },
      ]),
    ]
    const orders = new Map<number, ExcelSyncOrderInfo>([
      [20, info({ id: 20, category: 'Disting' })],
      [21, info({ id: 21, category: 'Disting', cancelled: true })],
      [22, info({ id: 22, category: 'Disting' })],
      [23, info({ id: 23, category: 'Disting', release_date: '2026-11-05' })],
    ])
    const out = deriveExcelSync(runs, orders, NOW)
    expect(out.cancelledInExcel.map((i) => i.id)).toEqual([20])
    expect(out.other.map((i) => i.id)).toEqual([22])
    expect(out.openCount).toBe(2)
  })

  it('ostatnia synchronizacja = najnowszy przebieg; starsza niż 26 h = stale (Make raz dziennie)', () => {
    const fresh = deriveExcelSync([run('STA', [], '2026-11-06T16:57:00Z'), run('ST', [], '2026-11-06T15:00:00Z')], new Map(), NOW)
    expect(fresh.lastSyncAt).toBe('2026-11-06T16:57:00Z')
    expect(fresh.stale).toBe(false)
    const yesterday = deriveExcelSync([run('STA', [], '2026-11-05T19:00:00Z')], new Map(), NOW)
    expect(yesterday.stale).toBe(false)
    const old = deriveExcelSync([run('STA', [], '2026-11-04T19:00:00Z')], new Map(), NOW)
    expect(old.stale).toBe(true)
    expect(deriveExcelSync([], new Map(), NOW).lastSyncAt).toBeNull()
  })
})
