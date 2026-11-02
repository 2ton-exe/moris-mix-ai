import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode, type Ref } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { JournalFacingPage, JournalPageFooter } from '../journal/JournalFacingPage'
import { JournalReadingTurns } from '../journal/JournalReadingTurns'
import { useJournalPageTurn } from '../journal/JournalPageTurn'
import { useJournalMedia } from '../journal/useJournalMedia'
import { PaperClip, Tape } from '../journal/Scrapbook'
import { RecipeMetadata } from './RecipeCard'
import { RecipeScrapArtwork } from './RecipeScrapArtwork'
import { readingParagraphs, readingSpreads } from './readingPagination'
import { useReadingPagination } from './useReadingPagination'
import type { RecipeDetail } from './types'

interface ReadingUnit { id: string; section: string; heading: string; count?: string; content: ReactNode }

function recipeUnits(recipe: RecipeDetail, publicDemo: boolean): ReadingUnit[] {
  const units: ReadingUnit[] = recipe.ingredients.map((ingredient, index) => {
    const amount = ingredient.quantityText ?? [ingredient.quantity, ingredient.unit].filter((part) => part !== null).join(' ')
    return { id: `ingredient-${index}`, section: 'ingredients', heading: 'Ingredients',
      content: <ul><li>{amount ? `${amount} ${ingredient.name}` : ingredient.name}</li></ul> }
  })
  if (!units.length) units.push({ id: 'ingredients-empty', section: 'ingredients', heading: 'Ingredients', content: <p>No ingredients listed.</p> })
  const methodHeading = publicDemo ? 'Instructions' : 'In the kitchen'
  const instructions = [...recipe.instructions].sort((a, b) => a.step - b.step)
  units.push(...instructions.map((instruction, index) => ({ id: `instruction-${index}`, section: 'method', heading: methodHeading,
    content: <ol start={instruction.step}><li value={instruction.step}><span className="mm-step-number" aria-hidden="true">{instruction.step}</span><p>{instruction.text}</p></li></ol> })))
  if (!instructions.length) units.push({ id: 'instructions-empty', section: 'method', heading: methodHeading, content: <p>No cooking steps listed.</p> })
  // Delimiters stay attached: concatenating note segments preserves the source.
  const paragraphs = readingParagraphs(recipe.notes ?? '')
  if (paragraphs.length) units.push(...paragraphs.map((text, index) => ({ id: `note-${index}`, section: 'notes', heading: 'Personal notes', content: <p>{text}</p> })))
  else units.push({ id: 'notes-empty', section: 'notes', heading: 'Personal notes', content: <p className="mm-reading-notes__empty">{publicDemo ? 'No personal notes are included in this demonstration.' : 'No personal notes yet. Add some when you edit this recipe.'}</p> })
  if (recipe.flavor_scores) units.push({ id: 'flavors', section: 'flavors', heading: publicDemo ? 'Flavor scores' : 'Flavor notes', content:
    <dl className="flavor-scores">{Object.entries(recipe.flavor_scores).map(([name, score]) => <div key={name}><dt>{name}</dt><dd>{score} / 5</dd></div>)}</dl> })
  return units.map((unit) => ({ ...unit, count: unit.section === 'ingredients' ? `${recipe.ingredients.length} items` : unit.section === 'method' ? `${recipe.instructions.length} steps` : undefined }))
}

function ReadingUnits({ units, prefix, measured = false, capacity, width, oversized = [], contentLimits = {} }: {
  units: ReadingUnit[]; prefix: string; measured?: boolean; capacity?: number; width?: number; oversized?: string[]; contentLimits?: Record<string, number>
}) {
  const groups: { heading: string; nodes: ReactNode[] }[] = []
  const nodes = units.map((unit, index) => {
    const showHeading = measured || index === 0 || units[index - 1].section !== unit.section
    const label = `${prefix}-${unit.id}`
    const fallback = !measured && oversized.includes(unit.id)
    const node = <div key={unit.id} data-unit={unit.id} data-section={unit.section}
      className={`mm-reading-unit mm-reading-${unit.section}${fallback ? ' mm-unit-fallback' : ''}`}>
      {unit.section === 'notes' && showHeading && <Tape variant="masking" />}
      {showHeading && <div className="mm-section-heading mm-unit-heading"><h2 id={label}>{unit.heading}{(measured || index === 0) && !['ingredient-0', 'ingredients-empty', 'instruction-0', 'instructions-empty', 'note-0', 'notes-empty', 'flavors'].includes(unit.id) && <span className="mm-continued"> · continued</span>}</h2>{unit.count && <span>{unit.count}</span>}</div>}
      {(fallback || measured) && <p className="mm-long-entry">Long entry · scroll to continue</p>}
      <div className="mm-unit-content" style={fallback && capacity ? { maxHeight: contentLimits[unit.id] ?? Math.max(48, capacity - (showHeading ? 64 : 0) - 46) } : undefined}
        tabIndex={fallback ? 0 : undefined} role={fallback ? 'region' : undefined} aria-label={fallback ? `${unit.heading}, ${unit.id.replaceAll('-', ' ')}. Scroll to continue.` : undefined}>
        {unit.content}
      </div>
    </div>
    if (showHeading) groups.push({ heading: unit.heading, nodes: [] })
    groups[groups.length - 1].nodes.push(node)
    return node
  })
  return <>{measured ? nodes : <div className="mm-reading-page-content" style={{ maxWidth: width }}>{groups.map((group, index) => <section className="mm-unit-group" aria-label={group.heading} key={index}>{group.nodes}</section>)}</div>}</>
}

/** Shared physical reading leaves. Backend cursors never enter this component. */
export function RecipeReading({ recipe, titleRef, folio, back, actions, status, publicDemo = false }: {
  recipe: RecipeDetail; titleRef?: Ref<HTMLHeadingElement>; folio?: number
  back: ReactNode; actions?: ReactNode; status?: ReactNode; publicDemo?: boolean
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const { isTurning, requestPageTurn } = useJournalPageTurn()
  const single = useJournalMedia('(max-width: 1099.98px), (max-height: 639.98px)')
  const units = useMemo(() => recipeUnits(recipe, publicDemo), [recipe, publicDemo])
  const contentKey = useMemo(() => JSON.stringify(recipe), [recipe])
  const { bodyRef, leftRef, bankRef, measurable, ready, layout } = useReadingPagination(contentKey, single)
  const pages = layout?.pages ?? [units.map((unit) => unit.id)]
  const spreads = readingSpreads(pages, single)
  const anchor = new URLSearchParams(location.search).get('read') ?? 'identity'
  const found = spreads.findIndex((spread) => spread.some((leaf) => leaf.includes(anchor)))
  const current = Math.max(0, found)
  // Router transitions may commit after a second key event. Keep rapid turns
  // relative to the last requested page instead of a stale rendered closure.
  const requestedPage = useRef(current)
  useLayoutEffect(() => { requestedPage.current = current }, [current, location.key])
  const spread = spreads[current]
  const identityVisible = spread[0]?.[0] === 'identity'
  const selectUnits = (ids: string[] = []) => units.filter((unit) => ids.includes(unit.id))
  const turn = (index: number) => {
    if (index < 0 || index >= spreads.length || isTurning) return
    const params = new URLSearchParams(location.search)
    const nextAnchor = spreads[index][0][0]
    if (nextAnchor === 'identity') params.delete('read')
    else params.set('read', nextAnchor)
    const nextSearch = params.toString()
    const expectedSearch = nextSearch ? `?${nextSearch}` : ''
    requestPageTurn(index > requestedPage.current ? 'forward' : 'backward', () => {
      requestedPage.current = index
      void navigate({ pathname: location.pathname, search: nextSearch, hash: location.hash }, { state: location.state, preventScrollReset: true, flushSync: true })
      requestAnimationFrame(() => (single ? bodyRef.current : leftRef.current)?.focus({ preventScroll: true }))
    }, expectedSearch)
  }
  useLayoutEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const target = event.target as HTMLElement
      if (!target.closest('.mm-journal-spread') || target.closest('input, textarea, select, button, a, [contenteditable="true"], .mm-unit-content')) return
      const delta = event.key === 'ArrowRight' || event.key === 'PageDown' ? 1
        : event.key === 'ArrowLeft' || event.key === 'PageUp' ? -1 : 0
      const index = requestedPage.current + delta
      if (delta !== 0 && index >= 0 && index < spreads.length && !isTurning) {
        event.preventDefault()
        turn(index)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  })
  useEffect(() => {
    for (const region of [bodyRef.current, leftRef.current]) if (region) region.scrollTop = 0
    const paper = bodyRef.current?.closest('.mm-journal-spread')
    if (paper) paper.scrollTop = 0
  }, [current, bodyRef, leftRef])
  useLayoutEffect(() => {
    // Moving between facing and single leaves can detach the focused heading.
    if (document.activeElement !== document.body) return
    const region = single ? bodyRef.current : leftRef.current
    const heading = region?.querySelector<HTMLElement>('h1[tabindex="-1"]')
    ;(heading ?? region)?.focus({ preventScroll: true })
  }, [single, current, bodyRef, leftRef])

  const identity = <div className="mm-recipe-identity mm-reading-identity" role="region" aria-label="Recipe identity and details" tabIndex={0}>
    {publicDemo && <h1 className="mm-demo-title" tabIndex={-1}>Demonstration recipe</h1>}
    <RecipeScrapArtwork title={recipe.title} cookedAt={recipe.cooked_at} size="detail" />
    <header className="mm-recipe-detail__summary">
      {publicDemo ? <h2>{recipe.title}</h2> : <h1 ref={titleRef} tabIndex={-1}>{recipe.title}</h1>}
      <span className="mm-title-swash" aria-hidden="true" />
      <RecipeMetadata recipe={recipe} />
      {recipe.star_rating == null && <p className="mm-recipe-unrated">Not rated</p>}
    </header>
  </div>
  return <article data-reading-ready={ready} data-reading-capacity={layout?.capacity} data-reading-width={layout?.width} className={`journal-recipe mm-recipe-detail__article mm-page-column mm-continuation ${layout ? 'is-measured' : 'is-fallback'}`}>
    <JournalFacingPage className="mm-facing-content--recipe mm-page-column mm-continuation-facing">
      <nav className="recipe-back mm-recipe-detail__back" aria-label="Recipe navigation">
        <span className="mm-back-clip"><PaperClip />{back}</span>
        {folio && <span className="mm-recipe-page-number" aria-label={`Scrap number ${folio}`}>No. {folio}</span>}
      </nav>
      <div ref={leftRef} className="mm-continuation-body mm-continuation-left" tabIndex={0} role="region" aria-label="Left recipe page">
        {!single && (identityVisible ? identity : <><h1 className="mm-continuation-title" tabIndex={-1}>Recipe continued</h1><ReadingUnits units={selectUnits(spread[0])} prefix="left" capacity={layout?.capacity} width={layout?.width} oversized={layout?.oversized} contentLimits={layout?.contentLimits} /></>)}
      </div>
      <span className="mm-recipe-page-number mm-reading-left-folio" aria-hidden="true">{current === 0 ? 'From your journal' : `Continued · ${current * 2 + 1}`}</span>
    </JournalFacingPage>
    <div className="mm-reading-running-head">
      {single ? <span className="mm-reading-return">{back}</span> : <span>{current ? 'Recipe continued' : 'From your journal'}</span>}
    </div>
    <div className="mm-reading-request-status">{status}</div>
    <div ref={bodyRef} className="mm-continuation-body mm-recipe-reading-body" tabIndex={0} role="region" aria-label="Recipe ingredients, instructions and notes">
      {ready && !layout && <p className="mm-reading-fallback-notice">Page space is limited. Scroll this paper to continue reading.</p>}
      {single && identityVisible ? identity : <>{single && <h1 className="mm-continuation-title" tabIndex={-1}>Recipe continued</h1>}<ReadingUnits units={selectUnits(single ? spread[0] : spread[1])} prefix="right" capacity={layout?.capacity} width={layout?.width} oversized={layout?.oversized} contentLimits={layout?.contentLimits} /></>}
      {!single && current > 0 && !spread[1] && <p className="mm-reading-end">End of this recipe.</p>}
    </div>
    <div ref={bankRef} className="mm-reading-measure" aria-hidden="true" inert>{measurable && <ReadingUnits units={units} prefix="measure" measured />}</div>
    <JournalPageFooter>
      <JournalReadingTurns page={current} total={spreads.length} onTurn={turn} />
      <nav className="mm-reading-footer" aria-label="Recipe actions">
        <div className="mm-reading-footer__actions">{actions}</div>
        {publicDemo && <Link className="button mm-button--page-turn" to="/home">Home →</Link>}
      </nav>
    </JournalPageFooter>
  </article>
}
