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
  const [textChunkSize, setTextChunkSize] = useState(600)
  const [layout, setLayout] = useState<{ pages: string[][]; capacity: number; width: number; key: string } | null>(null)
  const measuredGeometry = useRef('')

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
      if (body.clientHeight <= 0 || width <= 0) return
      if (capacity <= 0 || width <= 0) {
        flushSync(() => { setMeasurable(false); setLayout(null); setReadyKey(null) })
        return
      }
      const geometry = `${contentKey}:${single}:${capacity}:${width}`
      if (geometry !== measuredGeometry.current) {
        measuredGeometry.current = geometry
        if (textChunkSize !== 600) {
          flushSync(() => { setTextChunkSize(600); setLayout(null); setReadyKey(null) })
          return
        }
      }
      setMeasurable(true)
      bank.style.width = `${width}px`
      if (!bank.children.length) return
      const items = Array.from(bank.children).map((element) => {
        const unit = element as HTMLElement
        const heading = unit.querySelector<HTMLElement>('.mm-unit-heading')!
        return { id: unit.dataset.unit!, section: unit.dataset.section!, height: unit.getBoundingClientRect().height,
          headingHeight: heading.getBoundingClientRect().height + 8,
          splittable: unit.dataset.splittable === 'true',
          }
      })
      if (items.some((item) => !item.height)) return
      if (items.some((item) => item.splittable && item.height > capacity) && textChunkSize > 1) {
        flushSync(() => { setTextChunkSize(Math.max(1, Math.floor(textChunkSize * .7))); setLayout(null); setReadyKey(null) })
        return
      }
      const next = { pages: paginateReading(items, capacity), capacity, width, key: contentKey }
      // Publish the measured bank and its boundaries together before the next
      // paint; a key press must not use the previous viewport's page map.
      flushSync(() => {
        setLayout((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
        setReadyKey(contentKey)
      })
    }
    const schedule = () => {
      if (disposed) return
      setReadyKey(null)
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    // Measure only after the reading font settles so page breaks match what readers see.
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
  }, [contentKey, single, measurable, textChunkSize])

  return { bodyRef, leftRef, bankRef, measurable, ready: readyKey === contentKey, textChunkSize, layout: layout?.key === contentKey ? layout : null }
}
