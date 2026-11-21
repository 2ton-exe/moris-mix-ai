import { scrapbookRegistry, type ScrapbookAsset } from './scrapbookRegistry'
import './scrapbook-sticker.css'

type StickerProps = {
  name: ScrapbookAsset
  size?: 'sm' | 'md' | 'lg' | number
  variant?: 'plain' | 'die-cut'
  rotation?: number
  className?: string
} & ({ decorative?: true; alt?: never } | { decorative: false; alt?: string })

/** Use plain artwork for small icons and die-cut for layered paper decorations. */
export function ScrapbookSticker({ name, size, variant = 'plain', rotation, className, decorative = true, alt }: StickerProps) {
  const asset = scrapbookRegistry[name]
  return <img
    className={['mm-scrapbook-sticker', size && typeof size === 'string' && `mm-scrapbook-sticker--${size}`, variant === 'die-cut' && 'mm-scrapbook-sticker--die-cut', className].filter(Boolean).join(' ')}
    src={asset.src}
    width={typeof size === 'number' ? size : undefined}
    style={rotation === undefined ? undefined : { rotate: `${rotation}deg` }}
    alt={decorative ? '' : alt ?? asset.label}
    aria-hidden={decorative || undefined}
    draggable={false}
  />
}
