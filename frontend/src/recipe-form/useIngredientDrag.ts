import { useLayoutEffect, useRef } from 'react'
import type { MouseEvent, PointerEvent as ReactPointerEvent } from 'react'

const settleOffset = (offset: number) => Math.min(20, Math.max(-20, offset))

function visibleSlots(form: HTMLFormElement) {
  return Array.from(form.querySelectorAll<HTMLElement>('[data-ingredient-slot]')).flatMap((slot) => {
    const card = slot.querySelector('fieldset')
    const leaf = slot.closest('.mm-writing-leaf')
    if (!card || !leaf || card.offsetHeight === 0) return []
    const paper = leaf.getBoundingClientRect()
    const bounds = slot.getBoundingClientRect()
    const rect = new DOMRect(bounds.left + card.offsetLeft, bounds.top + card.offsetTop, card.offsetWidth, card.offsetHeight)
    if (rect.bottom <= paper.top || rect.top >= paper.bottom) return []
    return [{ slot, card, leaf, rect, paper, index: Number(slot.dataset.ingredientSlot) }]
  })
}

const motionAllowed = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function useIngredientDrag(layout: string) {
  const stop = useRef<(() => void) | null>(null)
  const suppressClick = useRef(false)

  useLayoutEffect(() => () => stop.current?.(), [layout])

  function begin(event: ReactPointerEvent<HTMLButtonElement>, move: (index: number) => void, announceCancel: () => void) {
    if (event.button !== 0 || !event.isPrimary || stop.current) return
    suppressClick.current = false
    const handle = event.currentTarget
    const form = handle.form
    const pointer = event.pointerId
    if (!form || typeof HTMLElement.prototype.showPopover !== 'function') return

    const slots = visibleSlots(form)
    const source = slots.find(({ card }) => card.contains(handle))
    if (!source || slots.length < 2) return
    const { card, slot: sourceSlot, rect: origin, leaf: sourceLeaf, index: sourceIndex } = source

    const startX = event.clientX
    const startY = event.clientY
    const listeners = new AbortController()
    const options = { signal: listeners.signal }
    let target: typeof source | undefined
    let lifted = false

    function showTarget(next: typeof target) {
      if (next === target) return
      if (target) delete target.slot.dataset.ingredientDrop
      slots.forEach(({ card }) => card.style.removeProperty('--ingredient-shift'))
      target = next
      if (!target) return

      const direction = Math.sign(target.index - sourceIndex)
      const first = Math.min(sourceIndex, target.index)
      const last = Math.max(sourceIndex, target.index)
      target.slot.dataset.ingredientDrop = target.leaf === sourceLeaf ? 'slot' : direction > 0 ? 'after' : 'before'
      for (const item of slots) {
        if (item === source || item.index < first || item.index > last) continue
        // Cards preview their new position within a leaf. The binding stays clear until drop.
        const neighbor = slots.find(({ index }) => index === item.index - direction)
        const shift = neighbor?.leaf === item.leaf ? neighbor.rect.top - item.rect.top : -5 * direction
        item.card.style.setProperty('--ingredient-shift', shift + 'px')
      }
    }

    function cleanup() {
      stop.current = null
      listeners.abort()
      if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer)
      showTarget(undefined)
      if (!lifted) return
      if (card.matches(':popover-open')) card.hidePopover()
      card.removeAttribute('popover')
      for (const property of ['--ingredient-left', '--ingredient-top', '--ingredient-width', 'transform']) {
        card.style.removeProperty(property)
      }
      sourceSlot.style.removeProperty('block-size')
      delete document.documentElement.dataset.ingredientDragging
    }

    function track(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointer) return
      const x = moveEvent.clientX
      const y = moveEvent.clientY
      const dx = x - startX
      const dy = y - startY
      if (!lifted) {
        if (Math.hypot(dx, dy) < 5) return
        lifted = true
        suppressClick.current = true
        card.getAnimations().forEach((animation) => animation.cancel())
        sourceSlot.style.blockSize = sourceSlot.offsetHeight + 'px'
        card.style.setProperty('--ingredient-left', origin.left + 'px')
        card.style.setProperty('--ingredient-top', origin.top + 'px')
        card.style.setProperty('--ingredient-width', origin.width + 'px')
        card.setAttribute('popover', 'manual')
        card.showPopover()
        document.documentElement.dataset.ingredientDragging = 'true'
      }
      card.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
      const slot = slots.find(({ rect, paper }) =>
        x >= rect.left && x <= rect.right && y >= Math.max(rect.top - 4, paper.top) && y <= Math.min(rect.bottom + 4, paper.bottom))
      showTarget(slot === source ? undefined : slot)
    }

    function finish(up: PointerEvent) {
      if (up.pointerId !== pointer) return
      if (lifted) track(up)
      const destination = target
      const released = destination ? card.getBoundingClientRect() : undefined
      cleanup()
      if (!destination || !released) return
      move(destination.index)
      if (!motionAllowed()) return
      requestAnimationFrame(() => {
        const card = form?.querySelector<HTMLElement>(`[data-ingredient-slot="${destination.index}"] > fieldset`)
        if (!card || stop.current) return
        const settled = card.getBoundingClientRect()
        card.animate(
          [{ translate: `${settleOffset(released.left - settled.left)}px ${settleOffset(released.top - settled.top)}px`, scale: '1.015' }, { translate: '0 0', scale: '1' }],
          { duration: 160, easing: 'ease-out' },
        )
      })
    }

    function cancel() {
      cleanup()
      if (lifted) announceCancel()
    }

    stop.current = cleanup
    handle.setPointerCapture(pointer)
    handle.addEventListener('pointermove', track, options)
    handle.addEventListener('pointerup', finish, options)
    handle.addEventListener('lostpointercapture', cancel, options)
    window.addEventListener('resize', cancel, options)
    window.addEventListener('blur', cancel, options)
    window.addEventListener('scroll', cancel, { ...options, capture: true })
    document.addEventListener('keydown', (keyEvent) => {
      if (!lifted && keyEvent.key !== 'Escape') return
      keyEvent.preventDefault()
      keyEvent.stopPropagation()
      if (keyEvent.key === 'Escape') cancel()
    }, { ...options, capture: true })
  }

  function shouldOpenMove(event: MouseEvent<HTMLButtonElement>) {
    return !suppressClick.current || event.detail === 0
  }

  return { begin, shouldOpenMove, active: () => stop.current !== null }
}
