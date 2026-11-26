import type { Point } from './moriMovement'
import { MORI_SPRITE_WIDTH } from './moriSpriteAtlas'

type PaperBounds = Pick<DOMRectReadOnly, 'right' | 'bottom'>
export const MORI_DESKTOP_SIZE = 96
export const MORI_ART_SCALE = MORI_DESKTOP_SIZE / MORI_SPRITE_WIDTH

export function moriRestFoot(right: PaperBounds): Point {
  return { x: right.right - 30, y: right.bottom - 112 }
}
