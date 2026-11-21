import { useLayoutEffect, useRef } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { X } from 'lucide-react'
import pantryBottle from '../assets/stickers/pantry-bottle.svg'
import peppercorns from '../assets/stickers/peppercorns.svg'
import { IngredientEmoji } from '../recipe-form/IngredientEmojiView'

export interface PantryCardItem {
  id: number
  name: string
}

interface PantryCardsProps {
  items: PantryCardItem[]
  onRemove?: (id: number) => void
  disabled?: boolean
  animate?: boolean
  renderActions?: (item: PantryCardItem) => ReactNode
}

function cardIllustration(name: string) {
  if (/^(?:(?:apple cider|balsamic|rice|white|red wine) )?vinegar$|^olive oil$/i.test(name)) return pantryBottle
  if (/^(?:(?:black|white) )?pepper(?:corns?)?$/i.test(name)) return peppercorns
  return undefined
}

export function PantryCards({ items, onRemove, disabled, animate, renderActions }: PantryCardsProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const previousPositions = useRef<Map<string, DOMRect> | null>(null)

  useLayoutEffect(() => {
    const positions = previousPositions.current
    previousPositions.current = null
    if (!positions || !listRef.current) return

    for (const card of listRef.current.querySelectorAll<HTMLElement>('[data-pantry-ingredient]')) {
      const previous = positions.get(card.dataset.pantryIngredient ?? '')
      if (!previous) continue
      const current = card.getBoundingClientRect()
      const x = previous.left - current.left
      const y = previous.top - current.top
      if (x || y) card.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'none' }], { duration: 180, easing: 'ease-out' })
    }
  }, [items])

  function remove(id: number, event: MouseEvent<HTMLButtonElement>) {
    const list = listRef.current
    const card = event.currentTarget.closest('li')
    if (animate && list && card && typeof card.animate === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const visible = list.querySelectorAll<HTMLElement>('[data-pantry-ingredient]')
      previousPositions.current = new Map(Array.from(visible, (item) => [
        item.dataset.pantryIngredient ?? '', item.getBoundingClientRect(),
      ]))
      const copy = card.cloneNode(true)
      if (copy instanceof HTMLElement) {
        copy.removeAttribute('data-pantry-ingredient')
        copy.classList.add('mm-ai-chef__card-exit')
        copy.inert = true
        copy.setAttribute('aria-hidden', 'true')
        Object.assign(copy.style, {
          top: `${card.offsetTop}px`,
          left: `${card.offsetLeft}px`,
          width: `${card.offsetWidth}px`,
          height: `${card.offsetHeight}px`,
        })
        list.append(copy)
        const exit = copy.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.96)' }], { duration: 140, easing: 'ease-out' })
        void exit.finished.then(() => copy.remove(), () => copy.remove())
      }
    }
    onRemove?.(id)
  }

  return <ul className="mm-ai-chef__card-grid" ref={listRef} role="list">
    {items.map((item) => {
      const { id, name } = item
      const illustration = onRemove && cardIllustration(name)
      const removeButton = <button className="mm-ai-chef__remove" type="button" disabled={disabled}
        aria-label={`Remove ${name}`} title={renderActions ? `Remove ${name}` : undefined} onClick={(event) => remove(id, event)}>
        {renderActions ? <X size={15} aria-hidden="true" /> : <span><span className="mm-ai-chef__remove-mark" aria-hidden="true">× </span>Remove</span>}
      </button>
      return <li key={id} data-tone={id % 6} data-long-name={name.length > 48 ? 'extended' : name.length > 30 ? 'compact' : undefined} data-pantry-ingredient={onRemove ? id : undefined} data-pantry-tools={!!renderActions || undefined}>
        {!onRemove ? <span className="recipe-ingredient-emoji" />
          : illustration
            ? <img className="recipe-ingredient-emoji" src={illustration} alt="" loading="lazy" />
            : <IngredientEmoji name={name} />}
        <span className="mm-ai-chef__ingredient-name">{name}</span>
        {renderActions ? <div className="mm-ai-chef__ingredient-actions">{renderActions(item)}{removeButton}</div> : removeButton}
      </li>
    })}
  </ul>
}
