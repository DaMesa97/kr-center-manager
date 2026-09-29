// Globalny resize kolumn dla WSZYSTKICH tabel .orders-table (zgłoszenie #33
// + prośba: "na każdej tabeli"). Zero zmian w komponentach tabel:
// delegacja zdarzeń na document + MutationObserver przywracający zapisane
// szerokości po każdym renderze.
//
// UX: złap prawą krawędź nagłówka (kursor ↔) i ciągnij; podwójny klik na
// krawędzi = reset szerokości tej tabeli. Szerokości w localStorage,
// per "sygnatura" tabeli (lista nagłówków), więc każda tabela pamięta swoje.

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
  const ths = table.tHead?.rows[0]?.cells
  if (!ths || ths.length === 0) return ''
  const parts: string[] = []
  for (const th of Array.from(ths)) parts.push((th.textContent ?? '').trim().slice(0, 24))
  return parts.join('|')
}

function applySavedWidths(table: HTMLTableElement, widths: WidthMap) {
  const sig = tableSignature(table)
  if (!sig) return
  const saved = widths[sig]
  if (!saved) return
  const ths = table.tHead?.rows[0]?.cells
  if (!ths) return
  table.style.tableLayout = 'fixed'
  for (const [idxStr, px] of Object.entries(saved)) {
    const th = ths[Number(idxStr)]
    if (th) th.style.width = `${px}px`
  }
}

/** Jednorazowa inicjalizacja (wołana z App). Zwraca cleanup. */
export function initColumnResize(): () => void {
  let widths = loadWidths()
  let drag: {
    table: HTMLTableElement
    th: HTMLTableCellElement
    startX: number
    startW: number
  } | null = null
  let dragged = false

  const thEdge = (e: MouseEvent): HTMLTableCellElement | null => {
    const target = e.target as HTMLElement | null
    const th = target?.closest?.('table.orders-table thead th') as HTMLTableCellElement | null
    if (!th) return null
    const rect = th.getBoundingClientRect()
    return rect.right - e.clientX <= EDGE_PX ? th : null
  }

  const onMove = (e: MouseEvent) => {
    if (drag) {
      const dx = e.clientX - drag.startX
      const w = Math.max(MIN_W, drag.startW + dx)
      drag.th.style.width = `${w}px`
      if (Math.abs(dx) > 2) dragged = true
      e.preventDefault()
      return
    }
    // kursor ↔ przy krawędzi
    const th = thEdge(e)
    const hovered = document.querySelectorAll<HTMLTableCellElement>('th[data-col-resize-hover]')
    hovered.forEach((el) => {
      if (el !== th) {
        el.style.cursor = ''
        el.removeAttribute('data-col-resize-hover')
      }
    })
    if (th) {
      th.style.cursor = 'col-resize'
      th.setAttribute('data-col-resize-hover', '1')
    }
  }

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return
    const th = thEdge(e)
    if (!th) return
    const table = th.closest('table') as HTMLTableElement | null
    if (!table) return
    // zamrożenie bieżących szerokości + fixed layout = przewidywalne ciąganie
    const ths = Array.from(table.tHead?.rows[0]?.cells ?? [])
    ths.forEach((cell) => {
      cell.style.width = `${cell.getBoundingClientRect().width}px`
    })
    table.style.tableLayout = 'fixed'
    drag = { table, th, startX: e.clientX, startW: th.getBoundingClientRect().width }
    dragged = false
    document.body.style.userSelect = 'none'
    e.preventDefault()
    e.stopPropagation()
  }

  const onUp = () => {
    if (!drag) return
    const { table } = drag
    const sig = tableSignature(table)
    if (sig) {
      const ths = Array.from(table.tHead?.rows[0]?.cells ?? [])
      const m: Record<number, number> = {}
      ths.forEach((cell, i) => {
        m[i] = Math.round(cell.getBoundingClientRect().width)
      })
      widths[sig] = m
      saveWidths(widths)
    }
    drag = null
    document.body.style.userSelect = ''
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
    const th = thEdge(e)
    if (!th) return
    const table = th.closest('table') as HTMLTableElement | null
    if (!table) return
    const sig = tableSignature(table)
    if (sig && widths[sig]) {
      delete widths[sig]
      saveWidths(widths)
    }
    table.style.tableLayout = ''
    Array.from(table.tHead?.rows[0]?.cells ?? []).forEach((cell) => {
      cell.style.width = ''
    })
    e.preventDefault()
    e.stopPropagation()
  }

  // przywracanie szerokości po (re)renderach — debounce, żeby nie mielić DOM-u
  let raf = 0
  const observer = new MutationObserver(() => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      widths = loadWidths()
      document
        .querySelectorAll<HTMLTableElement>('table.orders-table')
        .forEach((t) => applySavedWidths(t, widths))
    })
  })
  observer.observe(document.body, { childList: true, subtree: true })

  document.addEventListener('mousemove', onMove, true)
  document.addEventListener('mousedown', onDown, true)
  document.addEventListener('mouseup', onUp, true)
  document.addEventListener('click', onClickCapture, true)
  document.addEventListener('dblclick', onDblClick, true)

  return () => {
    observer.disconnect()
    cancelAnimationFrame(raf)
    document.removeEventListener('mousemove', onMove, true)
    document.removeEventListener('mousedown', onDown, true)
    document.removeEventListener('mouseup', onUp, true)
    document.removeEventListener('click', onClickCapture, true)
    document.removeEventListener('dblclick', onDblClick, true)
  }
}
