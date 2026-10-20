// Resize kolumn tabel DataTable (zgłoszenie #33: "na każdej tabeli").
//
// UX: złap prawą krawędź nagłówka (kursor ↔) i ciągnij; podwójny klik na
// krawędzi = reset szerokości tej tabeli. Szerokości w localStorage.
//
// v2: szerokość przypisana do KLUCZA kolumny (th[data-col-key]), a tabela
// rozpoznawana po liście kluczy wszystkich kolumn (tableKey z DataTable).
// Dzięki temu piętrowanie (część kolumn chowa się pod inne) nie przesuwa
// szerokości na złe kolumny i nie gubi zapisu. Stary zapis v1 (po napisach
// nagłówków i indeksach) jest przenoszony przy pierwszym wyświetleniu tabeli.

const LS_KEY = 'tableColWidths.v2'
const LS_KEY_V1 = 'tableColWidths.v1'
const EDGE_PX = 7
const MIN_W = 40

type WidthMap = Record<string, Record<string, number>>

function load(key: string): WidthMap {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') as WidthMap
  } catch {
    return {}
  }
}

function saveWidths(w: WidthMap) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(w))
  } catch {
    /* brak miejsca/prywatny tryb — trudno, resize działa do odświeżenia */
  }
}

/** Komórki OSTATNIEGO wiersza nagłówka (nad nim mogą być wiersze grup z headerTop). */
function headerCells(table: HTMLTableElement): HTMLTableCellElement[] {
  const rows = table.tHead?.rows
  if (!rows || rows.length === 0) return []
  return Array.from(rows[rows.length - 1].cells)
}

const colKey = (th: HTMLTableCellElement) => th.dataset.colKey ?? ''

/** Stary zapis v1 dla tej tabeli (sygnatura z napisów nagłówków) → mapa klucz → px. */
function migrateV1(table: HTMLTableElement): Record<string, number> | null {
  const ths = headerCells(table)
  if (ths.length === 0) return null
  const sig = ths.map((th) => (th.textContent ?? '').trim().slice(0, 24)).join('|')
  const old = load(LS_KEY_V1)[sig]
  if (!old) return null
  const m: Record<string, number> = {}
  for (const [idx, px] of Object.entries(old)) {
    const k = ths[Number(idx)] && colKey(ths[Number(idx)])
    if (k) m[k] = px
  }
  return Object.keys(m).length > 0 ? m : null
}

/** Przywraca zapisane szerokości (wołane po każdym renderze tabeli). */
export function applySavedColumnWidths(table: HTMLTableElement, tableKey: string) {
  if (!tableKey) return
  const all = load(LS_KEY)
  let saved = all[tableKey]
  if (!saved) {
    const migrated = migrateV1(table)
    if (!migrated) return
    all[tableKey] = migrated
    saveWidths(all)
    saved = migrated
  }
  table.style.tableLayout = 'fixed'
  for (const th of headerCells(table)) {
    const px = saved[colKey(th)]
    if (px) th.style.width = `${px}px`
  }
}

/** Podpina resize do jednej tabeli. Zwraca cleanup. */
export function attachColumnResize(table: HTMLTableElement, getTableKey: () => string): () => void {
  let drag: { th: HTMLTableCellElement; startX: number; startW: number } | null = null
  let dragged = false
  let hovered: HTMLTableCellElement | null = null

  const thEdge = (e: MouseEvent): HTMLTableCellElement | null => {
    const th = (e.target as HTMLElement | null)?.closest?.('thead th') as HTMLTableCellElement | null
    if (!th || !table.contains(th)) return null
    const rect = th.getBoundingClientRect()
    return rect.right - e.clientX <= EDGE_PX ? th : null
  }

  // kursor ↔ przy krawędzi
  const onHover = (e: MouseEvent) => {
    if (drag) return
    const th = thEdge(e)
    if (hovered && hovered !== th) hovered.style.cursor = ''
    if (th) th.style.cursor = 'col-resize'
    hovered = th
  }

  const onMove = (e: MouseEvent) => {
    if (!drag) return
    const dx = e.clientX - drag.startX
    drag.th.style.width = `${Math.max(MIN_W, drag.startW + dx)}px`
    if (Math.abs(dx) > 2) dragged = true
    e.preventDefault()
  }

  const onUp = () => {
    if (!drag) return
    const tableKey = getTableKey()
    if (tableKey) {
      // scalanie z poprzednim zapisem: kolumny chwilowo schowane (piętrowanie) zachowują swoje szerokości
      const widths = load(LS_KEY)
      const m: Record<string, number> = { ...(widths[tableKey] ?? {}) }
      headerCells(table).forEach((cell) => {
        const k = colKey(cell)
        if (k) m[k] = Math.round(cell.getBoundingClientRect().width)
      })
      widths[tableKey] = m
      saveWidths(widths)
    }
    drag = null
    document.body.style.userSelect = ''
    document.removeEventListener('mousemove', onMove, true)
    document.removeEventListener('mouseup', onUp, true)
  }

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return
    const th = thEdge(e)
    if (!th) return
    // zamrożenie bieżących szerokości + fixed layout = przewidywalne ciąganie
    headerCells(table).forEach((cell) => {
      cell.style.width = `${cell.getBoundingClientRect().width}px`
    })
    table.style.tableLayout = 'fixed'
    drag = { th, startX: e.clientX, startW: th.getBoundingClientRect().width }
    dragged = false
    document.body.style.userSelect = 'none'
    // ruch/puszczenie łapiemy na całym dokumencie — kursor zwykle ucieka poza tabelę
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('mouseup', onUp, true)
    e.preventDefault()
    e.stopPropagation()
  }

  // klik tuż po przeciągnięciu nie może odpalić sortowania nagłówka
  const onClickCapture = (e: MouseEvent) => {
    if (dragged) {
      e.stopPropagation()
      e.preventDefault()
      dragged = false
    }
  }

  // podwójny klik na krawędzi = reset zapisanych szerokości tej tabeli
  const onDblClick = (e: MouseEvent) => {
    if (!thEdge(e)) return
    const tableKey = getTableKey()
    const widths = load(LS_KEY)
    if (tableKey && widths[tableKey]) {
      delete widths[tableKey]
      saveWidths(widths)
    }
    table.style.tableLayout = ''
    headerCells(table).forEach((cell) => {
      cell.style.width = ''
    })
    e.preventDefault()
    e.stopPropagation()
  }

  table.addEventListener('mousemove', onHover)
  table.addEventListener('mousedown', onDown, true)
  table.addEventListener('click', onClickCapture, true)
  table.addEventListener('dblclick', onDblClick, true)

  return () => {
    onUp()
    table.removeEventListener('mousemove', onHover)
    table.removeEventListener('mousedown', onDown, true)
    table.removeEventListener('click', onClickCapture, true)
    table.removeEventListener('dblclick', onDblClick, true)
  }
}
