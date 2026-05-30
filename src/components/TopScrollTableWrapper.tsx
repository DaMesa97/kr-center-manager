import { useRef, useEffect, useState, useCallback, type ReactNode, type MutableRefObject } from 'react'

type TopScrollOwner = 'top' | 'bottom' | null

type Props = {
  children: ReactNode
  className?: string
  tableWrapperRef?: MutableRefObject<HTMLDivElement | null>
}

export function TopScrollTableWrapper({ children, className, tableWrapperRef }: Props) {
  const topScrollRef = useRef<HTMLDivElement>(null)
  const [bottomWrapperEl, setBottomWrapperEl] = useState<HTMLDivElement | null>(null)
  const [innerWidth, setInnerWidth] = useState(0)
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
      setInnerWidth(tbl?.scrollWidth ?? wrapper.scrollWidth)
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
      <div ref={topScrollRef} className="orders-table-top-scroll" onScroll={handleTopScroll}>
        <div style={{ width: innerWidth, height: 1 }} />
      </div>
      <div ref={setBottomWrapperRef} className={className} onScroll={handleBottomScroll}>
        {children}
      </div>
    </>
  )
}
