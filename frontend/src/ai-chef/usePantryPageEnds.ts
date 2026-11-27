import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { PantryCardItem } from './PantryCards'

function packRows(grid: Element, first: number, continuation: number, gap: number) {
  const rows: { top: number; start: number; height: number }[] = []
  for (const [start, card] of Array.from(grid.children).entries()) {
    const { top, height } = card.getBoundingClientRect()
    if (rows.at(-1)?.top !== top) rows.push({ top, start, height })
  }

  const ends: number[] = []
  let remaining = first
  for (const { start, height } of rows) {
    if (height > remaining) {
      ends.push(start)
      remaining = continuation
    }
    remaining -= height + gap
  }
  return [...ends, grid.children.length]
}

export function usePantryPageEnds({
  pageRef, entries, cards, single, board, view, firstLeaf, turning, handoff,
}: {
  pageRef: RefObject<HTMLElement | null>
  entries: PantryCardItem[]
  cards: boolean
  single: boolean
  board: boolean
  view: 'grid' | 'list'
  firstLeaf: boolean
  turning: boolean
  handoff: boolean
}) {
  const [measuredEnds, setMeasuredEnds] = useState<{ board: boolean; ends: number[] } | null>(null)

  useLayoutEffect(() => {
    const page = pageRef.current
    const paper = page?.closest('.mm-ai-chef__paper')
    const spread = page?.closest('.mm-journal-spread')
    const footer = page?.closest('.mm-journal-page')?.querySelector('.mm-journal-page-footer')
    const heading = page?.querySelector('.mm-ai-chef__heading')
    const entry = page?.querySelector('.mm-ai-chef__entry')
    const continuation = page?.querySelector('.mm-ai-chef__pantry-pages')
    const notices = page?.querySelector('.mm-ai-chef__notices')
    const boardList = board ? page?.querySelector('.mm-ai-chef__pantry-list:not(.mm-ai-chef__measure)') : null
    const boardHeader = boardList?.querySelector('.mm-ai-chef__board-header')
    const boardPager = boardList?.querySelector('.mm-ai-chef__board-pages')
    const grid = page?.querySelector('.mm-ai-chef__measure .mm-ai-chef__card-grid')
    if (!cards || turning || handoff || !page || !paper || !spread || !footer || !heading || !continuation || !notices || !grid) return

    const measure = () => {
      const paperBounds = paper.getBoundingClientRect()
      const gridStyle = getComputedStyle(grid)
      if (paperBounds.width <= 0 || gridStyle.display !== 'grid') return
      const pageStyle = getComputedStyle(page)
      const pageGap = parseFloat(pageStyle.rowGap)
      const paperPadding = parseFloat(getComputedStyle(paper).paddingBottom)
      const bottom = single
        ? spread.getBoundingClientRect().top + (parseFloat(getComputedStyle(spread).minHeight) || spread.getBoundingClientRect().height) - footer.getBoundingClientRect().height - 12
        : paperBounds.bottom
      const noticeHeight = notices.getBoundingClientRect().height
      const contentHeight = bottom - page.getBoundingClientRect().top - paperPadding
        - parseFloat(gridStyle.paddingTop) - parseFloat(gridStyle.paddingBottom) - (noticeHeight ? noticeHeight + pageGap : 0)
      const headingHeight = heading.getBoundingClientRect().height
      const first = contentHeight - headingHeight - (entry?.getBoundingClientRect().height ?? 0) - 2 * pageGap
      const rest = contentHeight - continuation.getBoundingClientRect().height - pageGap - (single ? headingHeight + pageGap : 0)
      const gap = parseFloat(gridStyle.rowGap)
      let ends: number[]
      if (board) {
        // On preferences or an empty pantry there's no board to paginate.
        if (!boardList || !boardHeader || !boardPager || entries.length === 0) return
        const box = getComputedStyle(boardList)
        const space = first - boardHeader.getBoundingClientRect().height - parseFloat(pageStyle.paddingTop) - parseFloat(pageStyle.paddingBottom)
          - parseFloat(box.paddingTop) - parseFloat(box.paddingBottom)
          - parseFloat(box.borderTopWidth) - parseFloat(box.borderBottomWidth)
          - parseFloat(getComputedStyle(boardHeader).marginBottom)
        ends = packRows(grid, space, space, gap)
        if (ends.length > 1) {
          const withPager = space - boardPager.getBoundingClientRect().height - parseFloat(getComputedStyle(boardPager).marginTop)
          ends = packRows(grid, withPager, withPager, gap).filter((end) => end > 0)
        }
      } else {
        ends = packRows(grid, first, rest, gap)
      }
      setMeasuredEnds((current) => current?.board === board && current.ends.length === ends.length && current.ends.every((end, index) => end === ends[index]) ? current : { board, ends })
    }

    let frame: number | null = null
    const schedule = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        measure()
      })
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    for (const target of [paper, spread, footer, heading, entry, continuation, notices, grid, boardHeader, boardPager]) {
      if (target) observer?.observe(target)
    }
    window.addEventListener('resize', schedule)
    measure()
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', schedule)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [pageRef, entries, cards, single, board, view, firstLeaf, turning, handoff])

  if (cards && measuredEnds?.board === board
    && (board ? entries.length > 0 : measuredEnds.ends.at(-1) === entries.length)) return measuredEnds.ends
  if (board) return [entries.length]
  const first = single ? 1 : 2
  const continuation = single ? 2 : 4
  const ends = [Math.min(first, entries.length)]
  for (let start = first; start < entries.length; start += continuation) ends.push(Math.min(start + continuation, entries.length))
  return ends
}
