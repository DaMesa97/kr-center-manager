import { useRef, useEffect, useState, useCallback, type CSSProperties, type ReactNode, type MutableRefObject } from 'react'

type TopScrollOwner = 'top' | 'bottom' | null

type Props = {
  children: ReactNode
  className?: string
  style?: CSSProperties
  tableWrapperRef?: MutableRefObject<HTMLDivElement | null>
}

export function TopScrollTableWrapper({ children, className, style, tableWrapperRef }: Props) {
  const topScrollRef = useRef<HTMLDivElement>(null)
  const [bottomWrapperEl, setBottomWrapperEl] = useState<HTMLDivElement | null>(null)
  const [innerWidth, setInnerWidth] = useState(0)
  const [overflowing, setOverflowing] = useState(true)
  const syncingRef = useRef<TopScrollOwner>(null)

  const setBottomWrapperRef = useCallback(
    (node: HTMLDivElement | null) => {
      setBottomWrapperEl(node)
      if (tableWrapperRef) {
        const ref = tableWrapperRef as unknown as { current: HTMLDivElement | null }
        ref.current = node
      }
    },
    [tableWrapperRef]
  )

  useEffect(() => {
    const update = () => {
      const wrapper = bottomWrapperEl
      if (!wrapper) return
      const tbl = wrapper.querySelector('table')
      const w = tbl?.scrollWidth ?? wrapper.scrollWidth
      setInnerWidth(w)
      // bez przepełnienia pasek tylko zawadza — chowamy
      setOverflowing(w > wrapper.clientWidth + 2)
    }

    update()

    const ro = new ResizeObserver(update)
    const wrapper = bottomWrapperEl
    if (wrapper) {
      ro.observe(wrapper)
      const tbl = wrapper.querySelector('table')
      if (tbl) ro.observe(tbl)
    }
    window.addEventListener('resize', update)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [bottomWrapperEl])

  const handleTopScroll = useCallback(() => {
    if (syncingRef.current === 'bottom') return
    const top = topScrollRef.current
    const bottom = bottomWrapperEl
    if (!top || !bottom) return
    syncingRef.current = 'top'
    bottom.scrollLeft = top.scrollLeft
    setTimeout(() => {
      syncingRef.current = null
    }, 0)
  }, [bottomWrapperEl])

  const handleBottomScroll = useCallback(() => {
    if (syncingRef.current === 'top') return
    const top = topScrollRef.current
    const bottom = bottomWrapperEl
    if (!top || !bottom) return
    syncingRef.current = 'bottom'
    top.scrollLeft = bottom.scrollLeft
    setTimeout(() => {
      syncingRef.current = null
    }, 0)
  }, [bottomWrapperEl])

  return (
    <>
      <div
        ref={topScrollRef}
        className="orders-table-top-scroll"
        style={overflowing ? undefined : { display: 'none' }}
        onScroll={handleTopScroll}
      >
        <div style={{ width: innerWidth, height: 1 }} />
      </div>
      <div ref={setBottomWrapperRef} className={className} style={style} onScroll={handleBottomScroll}>
        {children}
      </div>
    </>
  )
}
