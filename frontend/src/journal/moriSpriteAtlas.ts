import type { Direction8, Point } from './moriMovement'

export const MORI_SPRITE_WIDTH = 200
export const MORI_SPRITE_HEIGHT = 240
export const MORI_FOOT: Point = { x: 100, y: 230.6 }

export interface MoriSpriteFrame {
  src: string
  foot: Point
}

interface DirectionSprites {
  idle: MoriSpriteFrame
  walk: readonly MoriSpriteFrame[]
  stride: number
}

type SpriteAtlas = Partial<Record<Direction8, DirectionSprites>>

/** All frames share the official SVG canvas. Stride and distance use source-art units. */
export function createMoriSpriteLookup(atlas: SpriteAtlas) {
  return (facing: Direction8, walkedDistance?: number): MoriSpriteFrame | null => {
    const direction = atlas[facing]
    if (!direction) return null
    if (walkedDistance === undefined || direction.walk.length < 4 || direction.walk.length > 8) return direction.idle

    const progress = (walkedDistance % direction.stride) / direction.stride
    return direction.walk[Math.floor(progress * direction.walk.length)] ?? direction.idle
  }
}

// shortcut: use the official front-facing SVG until each direction has approved frames.
const atlas: SpriteAtlas = {}
export const moriSpriteFrame = createMoriSpriteLookup(atlas)

const images = new Map<string, HTMLImageElement>()

export function preloadMoriSprites() {
  for (const direction of Object.values(atlas)) {
    for (const { src } of [direction.idle, ...direction.walk]) {
      if (images.has(src)) continue
      const image = new Image(MORI_SPRITE_WIDTH, MORI_SPRITE_HEIGHT)
      image.alt = ''
      image.src = src
      images.set(src, image)
    }
  }
}

export function loadedMoriSprite(src: string) {
  const image = images.get(src)
  return image?.complete && image.naturalWidth > 0 ? image : null
}
