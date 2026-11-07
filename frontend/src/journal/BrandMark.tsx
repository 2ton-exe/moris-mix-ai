import { MoriEmblem } from './Mori'

/** Use inside the existing navigation link, rather than creating another link. */
export function BrandMark({ className = '' }: { className?: string }) {
  return <span className={`mm-brand ${className}`}>
    <MoriEmblem size={28} />
    <span>MORI'S MIX</span>
  </span>
}
