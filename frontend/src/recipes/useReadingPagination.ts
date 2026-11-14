import { useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { paginateReading } from './readingPagination'

/** Observe fixed paper capacity and the unpaginated measurement bank, never results. */
export function useReadingPagination(contentKey: string, single: boolean) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const bankRef = useRef<HTMLDivElement>(null)
  const [measurable, setMeasurable] = useState(false)
  const [readyKey, setReadyKey] = useState<string | null>(null)
  const [layout, setLayout] = useState<{ pages: string[][]; capacity: number; width: number; oversized: string[]; contentLimits: Record<string, number>; key: string } | null>(null)

  useLayoutEffect(() => {
    const body = bodyRef.current
    const left = leftRef.current
    const bank = bankRef.current
    if (!body || !bank) return
    let disposed = false
    let fontsReady = false
    let frame = 0
    const measure = () => {
      if (disposed || !fontsReady) return
      const liveLeft = leftRef.current
      const capacity = Math.floor(Math.min(body.clientHeight, !single && liveLeft ? liveLeft.clientHeight : Infinity)) - 8
      const width = Math.floor(Math.min(body.clientWidth, !single && liveLeft ? liveLeft.clientWidth : Infinity)) - 8
      // A zero-sized portal/body has not joined the physical shell yet.
      if (capacity <= 0 || width <= 0) return
      if (capacity < 160 || width < 80) {
        flushSync(() => { setMeasurable(false); setLayout(null); setReadyKey(contentKey) })
        return
      }
      setMeasurable(true)
      bank.style.width = `${width}px`
      if (!bank.children.length) return
      const items = Array.from(bank.children).map((element) => {
        const unit = element as HTMLElement
        const heading = unit.querySelector<HTMLElement>('.mm-unit-heading')!
        return { id: unit.dataset.unit!, section: unit.dataset.section!, height: unit.getBoundingClientRect().height,
          headingHeight: heading.getBoundingClientRect().height + 8,
          noticeHeight: unit.querySelector<HTMLElement>('.mm-long-entry')!.getBoundingClientRect().height + 8,
          overhead: unit.getBoundingClientRect().height - unit.querySelector<HTMLElement>('.mm-unit-content')!.getBoundingClientRect().height }
      })
      if (items.some((item) => !item.height)) return
      const next = { pages: paginateReading(items, capacity), capacity, width,
        oversized: items.filter((item) => item.height > capacity).map((item) => item.id),
        contentLimits: Object.fromEntries(items.map((item) => [item.id, Math.max(24, capacity - item.overhead - item.noticeHeight - 4)])), key: contentKey }
      // Publish the measured bank and its boundaries together before the next
      // paint; a key press must not use the previous viewport's page map.
      flushSync(() => {
        setLayout((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
        setReadyKey(contentKey)
      })
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    // Before fonts settle, keep the complete recipe in a bounded scrolling body.
    void (document.fonts?.ready ?? Promise.resolve()).then(() => { fontsReady = true; schedule() })
    document.fonts?.addEventListener('loadingdone', schedule)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    observer?.observe(body)
    if (left) observer?.observe(left)
    observer?.observe(bank)
    window.addEventListener('resize', schedule)
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer?.disconnect()
      document.fonts?.removeEventListener('loadingdone', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [contentKey, single, measurable])

  return { bodyRef, leftRef, bankRef, measurable, ready: readyKey === contentKey, layout: layout?.key === contentKey ? layout : null }
}
