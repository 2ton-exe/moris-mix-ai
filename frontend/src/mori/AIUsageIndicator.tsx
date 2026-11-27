import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAIUsage } from './useAIUsage'

export function AIUsageIndicator({ userId, active = true }: { userId: string; active?: boolean }) {
  const query = useAIUsage(userId, active)
  const usage = query.isError ? undefined : query.data
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const dismissed = useRef(false)
  const closeTimer = useRef<number | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const id = useId()
  const nativePopover = typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function'
  const visible = active && open
  const fraction = usage ? usage.daily.remaining / usage.daily.limit : 0
  const state = !usage ? 'unavailable' : usage.daily.remaining === 0 ? 'exhausted' : fraction <= .2 ? 'low' : 'normal'

  function dismiss() {
    dismissed.current = true
    setOpen(false)
  }
  function show() {
    window.clearTimeout(closeTimer.current)
    if (!dismissed.current) setOpen(true)
  }
  function leave() {
    dismissed.current = false
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      if (document.activeElement !== trigger.current) setOpen(false)
    }, 250)
  }

  useEffect(() => {
    if (!active) setOpen(false)
    return () => window.clearTimeout(closeTimer.current)
  }, [active])

  useLayoutEffect(() => {
    if (!visible || !trigger.current || !popup.current) return
    const button = trigger.current
    const card = popup.current
    let frame = 0
    let lastPosition = ''
    if (nativePopover && !card.matches(':popover-open')) card.showPopover()
    function position() {
      const rect = button.getBoundingClientRect()
      const width = Math.min(250, window.innerWidth - 16)
      const height = Math.min(card.scrollHeight, window.innerHeight - 16)
      const composerTop = button.closest('.mori-chat')?.querySelector('.mori-chat-composer')?.getBoundingClientRect().top
      const preferredTop = (composerTop ?? rect.top) - height - 8
      const above = rect.top - 8
      const below = window.innerHeight - rect.bottom - 8
      const up = above >= height || above >= below
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
      const top = preferredTop >= 8 ? preferredTop : Math.max(8, Math.min(up ? rect.top - height - 8 : rect.bottom + 8, window.innerHeight - height - 8))
      const nextPosition = `${left},${top},${width}`
      if (nextPosition !== lastPosition) {
        card.style.left = `${left}px`
        card.style.top = `${top}px`
        card.style.width = `${width}px`
        lastPosition = nextPosition
      }
      frame = window.requestAnimationFrame(position)
    }
    position()
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !button.contains(event.target) && !card.contains(event.target)) dismiss()
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      dismiss()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
    }
  }, [visible, nativePopover])

  const reset = usage && `${new Intl.DateTimeFormat('en', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(usage.daily.resetAt))} PHT`
  const details = visible && <div ref={popup} id={id} className="mori-ai-usage-popover" role="tooltip" aria-label="Mori's AI usage"
    popover={nativePopover ? 'auto' : undefined} onToggle={(event) => {
      if (event.newState === 'closed' && event.currentTarget === popup.current && !event.currentTarget.matches(':popover-open')) dismiss()
    }}
    onMouseEnter={() => window.clearTimeout(closeTimer.current)} onMouseLeave={leave}>
    <strong>Mori&apos;s AI usage</strong>
    {usage ? <>
      <table><thead><tr><th scope="col">Usage</th><th scope="col">Remaining</th></tr></thead><tbody>
        <tr><th scope="row">Daily allowance</th><td>{usage.daily.remaining} of {usage.daily.limit} left</td></tr>
        <tr><th scope="row">60-second limit</th><td>{usage.shortTerm.remaining} of {usage.shortTerm.limit} left</td></tr>
      </tbody></table>
      <p>Daily reset: {reset}</p>
      {usage.daily.remaining === 0 && <p>You&apos;ve used today&apos;s AI allowance. Mori will be ready again at {reset}.</p>}
      {usage.daily.remaining > 0 && usage.shortTerm.remaining === 0 && <p>Mori needs a moment. Try again shortly.</p>}
      <p className="mori-ai-usage-note">Applies to AI-powered features.</p>
    </> : <p>{query.isPending ? 'Checking AI usage…' : 'AI usage is temporarily unavailable.'}</p>}
  </div>

  return <div className="mori-ai-usage" data-state={state}>
    <button ref={trigger} type="button" className="mori-ai-usage-trigger" aria-label="Mori's AI usage" popoverTarget={nativePopover ? id : undefined} popoverTargetAction="show" aria-expanded={visible} aria-controls={visible ? id : undefined}
      onMouseEnter={show} onMouseLeave={leave} onFocus={show}
      onBlur={() => { dismissed.current = false; setOpen(false) }}
      onClick={() => { dismissed.current = false; window.clearTimeout(closeTimer.current); setOpen(true) }}>
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="mori-ai-usage-track" cx="12" cy="12" r="9" fill="none" strokeWidth="2" />
        <circle className="mori-ai-usage-remaining" cx="12" cy="12" r="9" fill="none" strokeWidth="2" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - fraction} strokeLinecap="round" transform="rotate(-90 12 12)" />
      </svg>
    </button>
    {nativePopover ? details : details && createPortal(details, document.body)}
  </div>
}
