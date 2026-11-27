import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { InputHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { ingredientUnits, normalizeIngredientUnit } from '../../../supabase/functions/_shared/ingredient-units.ts'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  id: string
  value: string
  onChange: (value: string) => void
}

export function IngredientUnitCombobox({ id, value, onChange, onFocus, onBlur, onKeyDown, ...props }: Props) {
  const uid = useId()
  const anchor = `--unit-${uid.replace(/[^a-z0-9-]/gi, '')}`
  const input = useRef<HTMLInputElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const wrapper = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [announcement, setAnnouncement] = useState('')
  const nativePopover = typeof HTMLElement !== 'undefined' && Object.hasOwn(HTMLElement.prototype, 'popover') && typeof HTMLElement.prototype.showPopover === 'function'
  const query = value.trim()
  const canonical = ingredientUnits.find((entry) => entry.unit === normalizeIngredientUnit(query))
  const matches = !query ? ingredientUnits.slice(0, 6) : canonical ? [canonical]
    : ingredientUnits.filter((entry) => [entry.unit, entry.plural, ...entry.aliases].some((alias) => alias.toLowerCase().includes(query.toLowerCase())))
  const options = matches.map((entry) => ({ value: entry.unit, label: entry.unit }))
  if (query && !canonical) options.push({ value: query, label: `Use "${query}"` })
  const highlighted = options[active]
  const listId = `${uid}-units`

  function close() { setOpen(false); setActive(-1) }
  function select(selected: string) { onChange(selected); close() }

  useLayoutEffect(() => { input.current?.style.setProperty('anchor-name', anchor) }, [anchor])
  useLayoutEffect(() => {
    if (!open || !input.current || !popup.current) return
    const list = popup.current
    const field = input.current
    list.style.setProperty('position-anchor', anchor)
    function position() {
      const rect = field.getBoundingClientRect()
      const width = Math.min(Math.max(rect.width, 180), window.innerWidth - 16)
      const below = window.innerHeight - rect.bottom - 12
      const above = rect.top - 12
      const height = Math.min(240, Math.max(below, above))
      const up = below < Math.min(240, list.scrollHeight) && above > below
      list.style.setProperty('--unit-width', `${width}px`)
      list.style.setProperty('--unit-left', `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`)
      list.style.setProperty('--unit-top', `${up ? Math.max(8, rect.top - Math.min(height, list.scrollHeight) - 4) : rect.bottom + 4}px`)
      list.style.setProperty('--unit-height', `${Math.max(44, height)}px`)
    }
    if (nativePopover && !list.matches(':popover-open')) list.showPopover()
    position()
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target) && !list.contains(event.target)) close()
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [open, nativePopover, anchor, options.length])

  useLayoutEffect(() => {
    if (!open || !popup.current || active < 0) return
    const list = popup.current
    const option = list.querySelector<HTMLElement>(`[id="${listId}-${active}"]`)
    if (!option) return
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight
  }, [open, active, listId])

  useEffect(() => {
    const timer = window.setTimeout(() => setAnnouncement(open ? `${options.length} unit suggestions available.` : ''), 150)
    return () => window.clearTimeout(timer)
  }, [open, options.length])

  const suggestions = open && <div ref={popup} id={listId} className="recipe-unit-options" role="listbox" aria-label="Unit suggestions"
    popover={nativePopover ? 'auto' : undefined} onToggle={(event) => { if (event.newState === 'closed') close() }}>
    {options.map((option, index) => <div key={option.value} role="option" id={`${listId}-${index}`} aria-selected={index === active}
      onPointerDown={(event) => event.preventDefault()} onMouseMove={() => setActive(index)} onClick={() => select(option.value)}>{option.label}</div>)}
  </div>

  return <div className="recipe-unit-combobox" ref={wrapper}>
    <input {...props} id={id} ref={input} type="text" role="combobox" autoComplete="off" maxLength={100}
      placeholder="Select or type" value={value} aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={open}
      aria-controls={open ? listId : undefined} aria-activedescendant={open && highlighted ? `${listId}-${active}` : undefined}
      onFocus={(event) => { setOpen(true); setActive(-1); onFocus?.(event) }} onClick={() => setOpen(true)}
      onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(-1) }}
      onBlur={(event) => { onChange(normalizeIngredientUnit(value) ?? ''); close(); onBlur?.(event) }}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (event.defaultPrevented || event.nativeEvent.isComposing) return
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          setOpen(true)
          setActive(event.key === 'ArrowDown' ? (open ? active + 1 : 0) % options.length : (open && active > 0 ? active - 1 : options.length - 1))
        } else if (event.key === 'Enter' && open && highlighted) {
          event.preventDefault()
          select(highlighted.value)
        } else if (event.key === 'Escape' && open) {
          event.preventDefault()
          event.stopPropagation()
          close()
        } else if (event.key === 'Tab') close()
      }} />
    <ChevronDown className="recipe-unit-combobox__chevron" size={14} aria-hidden="true" />
    {nativePopover ? suggestions : suggestions && createPortal(suggestions, document.body)}
    <span className="visually-hidden" role="status">{announcement}</span>
  </div>
}
