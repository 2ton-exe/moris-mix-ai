import type { ReactNode } from 'react'
import { Tape } from '../journal/Scrapbook'
import { formatCookedDate } from './recipePresentation'
import { Sketch } from './RecipeSketch'
import { sketchFor } from './sketch'

export function RecipeScrapArtwork({ title, cookedAt, size = 'card', image }: {
  image?: ReactNode
  title: string
  cookedAt?: string | null
  size?: 'card' | 'detail'
  mood?: 'stir' | 'cheer' | 'wave'
}) {
  return <figure className={`mm-recipe-artwork mm-recipe-artwork--${size}`}>
    <Tape variant={size === 'detail' ? 'sage' : 'mustard'} className="mm-recipe-artwork__tape" />
    {size === 'detail' && <Tape variant="mustard" className="mm-recipe-artwork__second-tape" />}
    {image ? <div className="mm-recipe-artwork__illustration mm-recipe-artwork__photo">{image}</div> :
      <div className="mm-recipe-artwork__illustration" role="img" aria-label={`Illustrated placeholder for ${title || 'this recipe'}; no recipe photo is available.`}>
        <Sketch kind={sketchFor(title)} />
      </div>}
    <figcaption className="mm-recipe-artwork__caption">
      <time dateTime={cookedAt ?? undefined}>{cookedAt ? formatCookedDate(cookedAt, true) : 'No date recorded'}</time>
    </figcaption>
  </figure>
}
