import type { Direction8, Point } from './moriMovement'
import strides from '../assets/journal/mori/strides.json'

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

const artwork = import.meta.glob<string>('../assets/journal/mori/*/{idle,walk-*}.svg', {
  eager: true,
  import: 'default',
  query: '?url&no-inline',
})

function atlasFrame(direction: Direction8, name: string, x = MORI_FOOT.x): MoriSpriteFrame {
  return {
    src: artwork[`../assets/journal/mori/${direction}/${name}.svg`],
    foot: { x, y: MORI_FOOT.y },
  }
}

const atlas: SpriteAtlas = {}
for (const direction in strides) {
  if (!isAtlasDirection(direction)) continue
  const { stride, plantedX } = strides[direction]
  atlas[direction] = {
    idle: atlasFrame(direction, 'idle'),
    stride,
    walk: plantedX.map((x, i) => atlasFrame(direction, `walk-${String(i + 1).padStart(2, '0')}`, x)),
  }
}

function isAtlasDirection(direction: string): direction is keyof typeof strides {
  return Object.hasOwn(strides, direction)
}

export const moriSpriteFrame = createMoriSpriteLookup(atlas)

const images = new Map<string, HTMLImageElement>()

export function preloadMoriSprites() {
  for (const direction of Object.values(atlas)) {
    for (const { src } of [direction.idle, ...direction.walk]) {
      if (!src || images.has(src)) continue
      const image = new Image(MORI_SPRITE_WIDTH, MORI_SPRITE_HEIGHT)
      image.alt = ''
      image.fetchPriority = 'low'
      image.src = src
      images.set(src, image)
    }
  }
}

export function loadedMoriSprite(src: string) {
  const image = images.get(src)
  return image?.complete && image.naturalWidth > 0 ? image : null
}
