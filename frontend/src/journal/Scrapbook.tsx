import type { ComponentPropsWithRef, CSSProperties } from 'react'

export type TapeVariant = 'masking' | 'sage' | 'mustard' | 'burgundy' | 'cream'
export type PaperSurface = 'parchment' | 'fresh' | 'kraft' | 'ruled'

/** Decorative only; position relative to the card, away from interactive content. */
export function Tape({ variant = 'masking', className = '', style }: {
  variant?: TapeVariant; className?: string; style?: CSSProperties
}) {
  return <span aria-hidden="true" className={`mm-tape mm-tape--${variant} ${className}`} style={style} />
}

export function PaperCard({ surface = 'parchment', tape, className = '', children, ...props }:
  ComponentPropsWithRef<'div'> & { surface?: PaperSurface; tape?: TapeVariant }) {
  return <div {...props} className={`mm-paper-card mm-surface--${surface} ${className}`}>
    {tape && <Tape variant={tape} className="mm-paper-card__tape" />}
    {children}
  </div>
}

/** An opt-in material surface; it does not control viewport size or scrolling. */
export function JournalSurface({ material, className = '', ...props }:
  ComponentPropsWithRef<'div'> & { material: 'wood' | 'leather' }) {
  return <div {...props} className={`mm-surface--${material} ${className}`} />
}

export function ScrapbookButton({ tone = 'burgundy', size = 'standard', presentation, type = 'button', className = '', ...props }:
  ComponentPropsWithRef<'button'> & {
    tone?: 'burgundy' | 'paper' | 'sage'
    size?: 'small' | 'standard' | 'large'
    presentation?: 'ghost' | 'page-turn' | 'icon'
  }) {
  return <button {...props} type={type} className={`mm-button mm-button--${tone} mm-button--${size}${presentation ? ` mm-button--${presentation}` : ''} ${className}`} />
}

/** A visual tag, not a form label. Use a native label for form controls. */
export function ScrapLabel({ tone = 'sage', className = '', ...props }:
  ComponentPropsWithRef<'span'> & { tone?: 'sage' | 'mustard' | 'burgundy' }) {
  return <span {...props} className={`mm-label mm-label--${tone} ${className}`} />
}

export function Stamp({ tone = 'burgundy', className = '', ...props }:
  ComponentPropsWithRef<'span'> & { tone?: 'burgundy' | 'sage' | 'ink' }) {
  return <span {...props} className={`mm-stamp mm-stamp--${tone} ${className}`} />
}

/** Original brass paper clip artwork from the reference's ui/kit.tsx. */
export function PaperClip({ className = '' }: { className?: string }) {
  return <svg className={`mm-paperclip ${className}`} viewBox="0 0 24 64" width="20" height="54" aria-hidden="true" focusable="false">
    <path d="M8 20 V48 a5 5 0 0 0 10 0 V12 a8 8 0 0 0 -16 0 V50 a10 10 0 0 0 20 0 V24" fill="none" stroke="var(--mm-color-brass-600)" strokeWidth="3.4" strokeLinecap="round" />
    <path d="M8 20 V48 a5 5 0 0 0 10 0 V12 a8 8 0 0 0 -16 0 V50 a10 10 0 0 0 20 0 V24" fill="none" stroke="var(--mm-color-brass-300)" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
}
