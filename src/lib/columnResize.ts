// Resize kolumn tabel DataTable (zgłoszenie #33: "na każdej tabeli").
//
// UX: złap prawą krawędź nagłówka (kursor ↔) i ciągnij; podwójny klik na
// krawędzi = reset szerokości tej tabeli. Szerokości w localStorage,
// per "sygnatura" tabeli (lista nagłówków), więc każda tabela pamięta swoje.
// Klucz i sygnatura jak w dawnej globalnej wersji — zapisane szerokości zostają.

const LS_KEY = 'tableColWidths.v1'
const EDGE_PX = 7
const MIN_W = 40

type WidthMap = Record<string, Record<number, number>>

function loadWidths(): WidthMap {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as WidthMap
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

/** Sygnatura tabeli = nagłówki kolumn (stabilna między renderami). */
function tableSignature(table: HTMLTableElement): string {
  const ths = headerCells(table)
  if (ths.length === 0) return ''
  return ths.map((th) => (th.textContent ?? '').trim().slice(0, 24)).join('|')
}

/** Komórki OSTATNIEGO wiersza nagłówka (nad nim mogą być wiersze grup z headerTop). */
function headerCells(table: HTMLTableElement): HTMLTableCellElement[] {
  const rows = table.tHead?.rows
  if (!rows || rows.length === 0) return []
  return Array.from(rows[rows.length - 1].cells)
}

/** Przywraca zapisane szerokości (wołane po każdym renderze tabeli). */
export function applySavedColumnWidths(table: HTMLTableElement) {
  const sig = tableSignature(table)
  if (!sig) return
  const saved = loadWidths()[sig]
  if (!saved) return
  const ths = headerCells(table)
  table.style.tableLayout = 'fixed'
  for (const [idxStr, px] of Object.entries(saved)) {
    const th = ths[Number(idxStr)]
    if (th) th.style.width = `${px}px`
  }
}

/** Podpina resize do jednej tabeli. Zwraca cleanup. */
export function attachColumnResize(table: HTMLTableElement): () => void {
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
    const sig = tableSignature(table)
    if (sig) {
      const m: Record<number, number> = {}
      headerCells(table).forEach((cell, i) => {
        m[i] = Math.round(cell.getBoundingClientRect().width)
      })
      const widths = loadWidths()
      widths[sig] = m
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
    const sig = tableSignature(table)
    const widths = loadWidths()
    if (sig && widths[sig]) {
      delete widths[sig]
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
