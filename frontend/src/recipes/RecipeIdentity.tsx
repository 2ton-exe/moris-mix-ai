import type { ReactNode, Ref } from 'react'

/** Reading identity geometry is shared by loaded recipes and their placeholders. */
export function RecipeIdentity({ artwork, title, metadata, publicDemo = false, titleRef, loading = false }: {
  artwork: ReactNode; title: ReactNode; metadata: ReactNode
  publicDemo?: boolean; titleRef?: Ref<HTMLHeadingElement>; loading?: boolean
}) {
  return <div className={`mm-recipe-identity mm-reading-identity${publicDemo ? ' mm-reading-identity--demo' : ''}`} role={loading ? undefined : 'region'} aria-label={loading ? undefined : 'Recipe identity and details'} tabIndex={loading ? undefined : 0} aria-hidden={loading || undefined}>
    {!publicDemo && artwork}
    <header className="mm-recipe-detail__summary">
      <h1 ref={titleRef} tabIndex={loading ? undefined : -1}>{title}</h1>
      <span className="mm-title-swash" aria-hidden="true" />
      {metadata}
    </header>
    {publicDemo && artwork}
  </div>
}
