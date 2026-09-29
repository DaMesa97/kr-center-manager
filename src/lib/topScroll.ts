// Globalny GÓRNY pasek przewijania dla KAŻDEGO .table-wrapper w apce
// (zgłoszenie: "przewijanie horyzontalne zjebane na Naświetlach/Reklamacjach —
// zróbcie jak w zamówieniach"). Zamiast dotykać kilkunastu widoków:
// MutationObserver znajduje wrappery i dokleja im zsynchronizowany pasek,
// dokładnie jak TopScrollTableWrapper w tabelach zamówień. Wrappery, które
// JUŻ mają pasek z komponentu React, są pomijane.

type Pair = {
  bar: HTMLDivElement
  sizer: HTMLDivElement
  ro: ResizeObserver
  cleanup: () => void
}

const pairs = new WeakMap<HTMLElement, Pair>()
const knownBars = new Set<HTMLDivElement>()

function attach(wrapper: HTMLElement) {
  if (pairs.has(wrapper)) return
  // pomiń wrappery obsłużone przez komponent TopScrollTableWrapper
  const prev = wrapper.previousElementSibling
  if (prev?.classList.contains('orders-table-top-scroll')) return
  if (!wrapper.parentElement) return

  const bar = document.createElement('div')
  bar.className = 'orders-table-top-scroll'
  const sizer = document.createElement('div')
  sizer.style.height = '1px'
  bar.appendChild(sizer)
  wrapper.parentElement.insertBefore(bar, wrapper)
  knownBars.add(bar)

  let syncing: 'top' | 'bottom' | null = null
  const onBar = () => {
    if (syncing === 'bottom') return
    syncing = 'top'
    wrapper.scrollLeft = bar.scrollLeft
    setTimeout(() => { syncing = null }, 0)
  }
  const onWrapper = () => {
    if (syncing === 'top') return
    syncing = 'bottom'
    bar.scrollLeft = wrapper.scrollLeft
    setTimeout(() => { syncing = null }, 0)
  }
  bar.addEventListener('scroll', onBar)
  wrapper.addEventListener('scroll', onWrapper)

  const update = () => {
    const tbl = wrapper.querySelector('table')
    const w = tbl?.scrollWidth ?? wrapper.scrollWidth
    sizer.style.width = `${w}px`
    // bez przepełnienia pasek tylko zawadza — chowamy
    bar.style.display = w > wrapper.clientWidth + 2 ? '' : 'none'
  }
  update()
  const ro = new ResizeObserver(update)
  ro.observe(wrapper)
  const tbl = wrapper.querySelector('table')
  if (tbl) ro.observe(tbl)

  pairs.set(wrapper, {
    bar, sizer, ro,
    cleanup: () => {
      ro.disconnect()
      bar.removeEventListener('scroll', onBar)
      wrapper.removeEventListener('scroll', onWrapper)
      bar.remove()
      knownBars.delete(bar)
    },
  })
}

export function initTopScroll(): () => void {
  let raf = 0
  const sweep = () => {
    // dołącz do nowych wrapperów
    document.querySelectorAll<HTMLElement>('div.table-wrapper').forEach(attach)
    // sprzątnij paski po wrapperach zdjętych z DOM
    for (const bar of Array.from(knownBars)) {
      const next = bar.nextElementSibling as HTMLElement | null
      if (!bar.isConnected) {
        knownBars.delete(bar)
        continue
      }
      if (!next || !next.classList.contains('table-wrapper') || !next.isConnected) {
        bar.remove()
        knownBars.delete(bar)
      }
    }
  }
  const observer = new MutationObserver(() => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(sweep)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  sweep()

  return () => {
    observer.disconnect()
    cancelAnimationFrame(raf)
    knownBars.forEach((b) => b.remove())
    knownBars.clear()
  }
}
