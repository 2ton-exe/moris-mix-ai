// Original fallback artwork from Figma Make ui/kit.tsx; no recipe imagery is invented.
import type { ReactNode } from 'react'
import type { SketchKind } from './sketch'

const SKETCH_PATHS: Record<SketchKind, ReactNode> = {
  bowl: (
    <>
      <path d="M18 62 C20 86 40 98 60 98 C80 98 100 86 102 62 Z" />
      <path d="M14 62 L106 62" />
      <path d="M44 98 L42 106 L78 106 L76 98" />
      <path d="M40 50 C36 42 44 38 40 30 M60 48 C56 40 64 36 60 28 M80 50 C76 42 84 38 80 30" />
      <path d="M30 72 L36 80 M46 76 L50 84 M64 76 L68 84" strokeWidth="1.4" />
    </>
  ),
  pan: (
    <>
      <ellipse cx="52" cy="66" rx="36" ry="22" />
      <path d="M16 66 C16 80 30 90 52 90 C74 90 88 80 88 66" />
      <path d="M86 60 L114 48" strokeWidth="5" />
      <circle cx="44" cy="64" r="7" />
      <circle cx="62" cy="70" r="5" />
      <path d="M40 40 C36 32 44 28 40 20 M58 42 C54 34 62 30 58 22" />
    </>
  ),
  cake: (
    <>
      <path d="M22 86 L60 46 L98 86 Z" />
      <path d="M22 86 L22 100 L98 100 L98 86" />
      <path d="M34 74 L86 74" strokeWidth="1.6" />
      <path d="M44 66 C48 70 52 66 56 70 C60 66 64 70 68 66" strokeWidth="1.6" />
      <circle cx="60" cy="40" r="5" />
      <path d="M60 35 L62 26" />
    </>
  ),
  bread: (
    <>
      <path d="M16 70 C16 48 34 40 60 40 C86 40 104 48 104 70 L104 92 L16 92 Z" />
      <path d="M36 50 L44 64 M56 46 L64 62 M76 48 L84 64" />
      <path d="M10 98 L110 98" strokeWidth="1.6" />
    </>
  ),
  noodles: (
    <>
      <path d="M18 64 C20 88 40 100 60 100 C80 100 100 88 102 64 Z" />
      <path d="M14 64 L106 64" />
      <path d="M34 64 C34 50 46 54 46 40 C46 30 58 34 58 22 M50 64 C52 52 62 56 64 44 C66 34 76 36 78 26" />
      <path d="M84 20 L60 70 M94 24 L68 72" strokeWidth="2.6" />
    </>
  ),
  pot: (
    <>
      <path d="M24 50 L96 50 L92 98 C91 102 29 102 28 98 Z" />
      <path d="M18 50 L102 50" strokeWidth="4" />
      <path d="M24 60 L12 60 M96 60 L108 60" strokeWidth="4" />
      <path d="M44 40 C40 32 48 28 44 20 M62 40 C58 32 66 28 62 20 M78 40 C74 32 82 28 78 20" />
    </>
  ),
  egg: (
    <>
      <path d="M20 70 C14 50 34 36 50 44 C62 30 92 36 98 56 C108 76 86 96 62 92 C40 100 24 88 20 70 Z" />
      <circle cx="58" cy="66" r="14" />
      <path d="M52 62 C54 58 58 57 62 58" strokeWidth="1.6" />
    </>
  ),
  cup: (
    <>
      <path d="M28 46 L84 46 L80 92 C80 98 32 98 32 92 Z" />
      <path d="M84 56 C100 56 100 80 82 80" />
      <path d="M44 36 C40 28 48 24 44 16 M62 36 C58 28 66 24 62 16" />
      <path d="M20 102 L92 102" strokeWidth="1.6" />
    </>
  ),
}

export function Sketch({ kind, className = '' }: { kind: SketchKind; className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true">
      <g fill="none" stroke="#4a382a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {SKETCH_PATHS[kind]}
      </g>
    </svg>
  )
}
