import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { JournalFacingPage, JournalPageFooter } from '../journal/JournalFacingPage'
import { JournalReadingTurns } from '../journal/JournalReadingTurns'
import { useJournalPageTurn } from '../journal/JournalPageTurn'
import { useJournalMedia } from '../journal/useJournalMedia'
import { PaperClip, Tape } from '../journal/Scrapbook'
import { journalReturnTo } from '../journal/indexNavigation'
import { IngredientEmoji } from '../recipe-form/IngredientEmojiView'
import { RecipeIdentity } from './RecipeIdentity'
import { RecipeMetadata } from './RecipeCard'
import { RecipeScrapArtwork } from './RecipeScrapArtwork'
import { readingParagraphs, readingSpreads, splitReadingText } from './readingPagination'
import { useReadingPagination } from './useReadingPagination'
import type { RecipeDetail } from './types'

interface ReadingUnit { id: string; section: string; heading: string; count?: string; list?: 'ul' | 'ol'; step?: number; content: ReactNode }

function recipeUnits(recipe: RecipeDetail, publicDemo: boolean, textChunkSize: number, editable: boolean, journalReturn: string, folio?: number): ReadingUnit[] {
  const editRecipePath = `/app/recipes/${encodeURIComponent(recipe.id)}/edit`
  const editRecipeState = { journalReturn, recipeFolio: folio }
  const units: ReadingUnit[] = recipe.ingredients.map((ingredient, index) => {
    const amount = ingredient.quantityText ?? [ingredient.quantity, ingredient.unit].filter((part) => part !== null).join(' ')
    const text = amount ? `${amount} ${ingredient.name}` : ingredient.name
    return splitReadingText(text, textChunkSize).map<ReadingUnit>((partText, part) => ({ id: part ? `ingredient-${index}-part-${part}` : `ingredient-${index}`, section: 'ingredients', heading: 'Ingredients',
      list: 'ul', content: <li>{part === 0 && <IngredientEmoji name={ingredient.name} />}{partText}</li> }))
  }).flat()
  if (!units.length) units.push({ id: 'ingredients-empty', section: 'ingredients', heading: 'Ingredients', content: <p>No ingredients listed.{editable && !publicDemo && <> <Link to={editRecipePath} state={editRecipeState}>Edit this recipe</Link> to add ingredients.</>}</p> })
  const methodHeading = publicDemo ? 'Instructions' : 'In the kitchen'
  const instructions = [...recipe.instructions].sort((a, b) => a.step - b.step)
  units.push(...instructions.flatMap((instruction, index) => splitReadingText(instruction.text, textChunkSize).map<ReadingUnit>((text, part) => ({
    id: part ? `instruction-${index}-part-${part}` : `instruction-${index}`, section: 'method', heading: methodHeading,
    list: 'ol', step: instruction.step, content: <li value={instruction.step}><span className="mm-step-number" aria-hidden="true">{instruction.step}</span><p>{part > 0 && <span className="visually-hidden">Step {instruction.step}, continued: </span>}{text}</p></li>,
  }))))
  if (!instructions.length) units.push({ id: 'instructions-empty', section: 'method', heading: methodHeading, content: <p>No cooking steps listed.{editable && !publicDemo && <> <Link to={`${editRecipePath}?section=method`} state={editRecipeState}>Add cooking steps</Link>.</>}</p> })
  // Delimiters stay attached: concatenating note segments preserves the source.
  const paragraphs = readingParagraphs(recipe.notes ?? '')
  if (paragraphs.length) units.push(...paragraphs.flatMap((paragraph, index) => splitReadingText(paragraph, textChunkSize).map((text, part) => ({
    id: part ? `note-${index}-part-${part}` : `note-${index}`, section: 'notes', heading: 'Personal notes', content: <p>{text}</p>,
  }))))
  else if (!publicDemo) units.push({ id: 'notes-empty', section: 'notes', heading: 'Personal notes', content: <p className="mm-reading-notes__empty">No personal notes yet.{editable && <> <Link to={editRecipePath} state={editRecipeState}>Edit this recipe</Link> to add a note.</>}</p> })
  if (recipe.flavor_scores) units.push({ id: 'flavors', section: 'flavors', heading: publicDemo ? 'Flavor scores' : 'Flavor notes', content:
    <dl className="flavor-scores">{Object.entries(recipe.flavor_scores).map(([name, score]) => <div key={name}><dt>{name}</dt><dd>{score} / 5</dd></div>)}</dl> })
  return units.map((unit) => ({ ...unit, count: unit.section === 'ingredients' ? `${recipe.ingredients.length} items` : unit.section === 'method' ? `${recipe.instructions.length} steps` : undefined }))
}

function ReadingUnits({ units, prefix, measured = false, width }: {
  units: ReadingUnit[]; prefix: string; measured?: boolean; width?: number
}) {
  const groups: ReadingUnit[][] = []
  for (const unit of units) {
    const group = groups.at(-1)
    if (!measured && group?.[0].section === unit.section) group.push(unit)
    else groups.push([unit])
  }
  const nodes = groups.map(([first, ...rest]) => {
    const label = `${prefix}-${first.id}`
    const continued = !['ingredient-0', 'ingredients-empty', 'instruction-0', 'instructions-empty', 'note-0', 'notes-empty', 'flavors'].includes(first.id)
    const List = first.list
    const content = [first, ...rest].map(({ id, content }) => <Fragment key={id}>{content}</Fragment>)
    const Section = measured ? 'div' : 'section'
    return <Section key={first.id} data-unit={first.id} data-section={first.section} className={`mm-reading-unit mm-reading-${first.section}`} aria-labelledby={measured ? undefined : label}>
      {first.section === 'notes' && <Tape variant="masking" />}
      <div className="mm-section-heading mm-unit-heading">
        <h2 id={label}>{first.heading}{continued && <span className="mm-continued"> · continued</span>}</h2>
        {first.count && <span>{first.count}</span>}
      </div>
      <div className="mm-unit-content">{List ? <List role="list" start={first.step}>{content}</List> : content}</div>
    </Section>
  })
  return measured ? nodes : <div className="mm-reading-page-content" style={{ maxWidth: width }}>{nodes}</div>
}

/** Shared physical reading leaves. Backend cursors never enter this component. */
export function RecipeReading({ recipe, titleRef, folio, back, actions, status, artwork, publicDemo = false, editable = false }: {
  recipe: RecipeDetail; titleRef?: Ref<HTMLHeadingElement>; folio?: number
  back: ReactNode; actions?: ReactNode; status?: ReactNode; artwork?: ReactNode; publicDemo?: boolean; editable?: boolean
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const journalReturn = journalReturnTo(location.state)
  const { isTurning, requestPageTurn } = useJournalPageTurn()
  const single = useJournalMedia('(max-width: 1099.98px), (max-height: 639.98px)')
  const contentKey = useMemo(() => JSON.stringify(recipe), [recipe])
  const { bodyRef, leftRef, bankRef, measurable, ready, textChunkSize, layout } = useReadingPagination(contentKey, single)
  const units = useMemo(() => recipeUnits(recipe, publicDemo, textChunkSize, editable, journalReturn, folio), [recipe, publicDemo, textChunkSize, editable, journalReturn, folio])
  const pages = layout?.pages ?? []
  const spreads = readingSpreads(pages, single)
  const anchor = new URLSearchParams(location.search).get('read') ?? 'identity'
  const found = spreads.findIndex((spread) => spread.some((leaf) => leaf.some((unit) => unit === anchor || unit.startsWith(`${anchor}-part-`))))
  const committedPage = Math.max(0, found)
  const [previewPage, setPreviewPage] = useState<number | null>(null)
  const current = previewPage ?? committedPage
  // Router transitions may commit after a second key event. Keep rapid turns
  // relative to the last requested page instead of a stale rendered closure.
  const focusAfterTurn = useRef(false)
  const requestedPage = useRef(current)
  useLayoutEffect(() => {
    if (!isTurning && focusAfterTurn.current) {
      focusAfterTurn.current = false
      const target = single ? bodyRef.current : leftRef.current
      target?.focus({ preventScroll: true })
    }
  }, [isTurning, single, bodyRef, leftRef])
  useLayoutEffect(() => { requestedPage.current = committedPage }, [committedPage, location.key])
  const spread = spreads[current]
  const firstLeaf = (single ? current : current * 2) + 1
  const leafCount = pages.length + 1
  const indicator = spread.length === 1 ? `Page ${firstLeaf} of ${leafCount}` : `Pages ${firstLeaf}–${firstLeaf + 1} of ${leafCount}`
  const identityVisible = !layout || spread[0]?.[0] === 'identity'
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
      setPreviewPage(index)
    }, () => {
      focusAfterTurn.current = true
      setPreviewPage(null)
      requestedPage.current = index
      void navigate({ pathname: location.pathname, search: nextSearch, hash: location.hash }, { state: location.state, preventScrollReset: true, flushSync: true })
    }, expectedSearch, () => {
      requestedPage.current = committedPage
      setPreviewPage(null)
    })
  }
  useLayoutEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const target = event.target as HTMLElement
      if (!target.closest('.mm-journal-spread') || target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return
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
  useLayoutEffect(() => {
    // Moving between facing and single leaves can detach the focused heading.
    if (isTurning) return
    if (document.activeElement !== document.body) return
    const region = single ? bodyRef.current : leftRef.current
    const heading = region?.querySelector<HTMLElement>('h1[tabindex="-1"]')
    ;(heading ?? region)?.focus({ preventScroll: true })
  }, [single, current, isTurning, bodyRef, leftRef])

  const identity = <RecipeIdentity publicDemo={publicDemo} titleRef={titleRef} title={recipe.title}
    artwork={artwork ?? <RecipeScrapArtwork title={recipe.title} cookedAt={recipe.cooked_at} size="detail" />}
    metadata={<><RecipeMetadata recipe={recipe} />{recipe.star_rating == null && <p className="mm-recipe-unrated">Not rated</p>}</>} />

  return <article data-reading-ready={ready} data-reading-capacity={layout?.capacity} data-reading-width={layout?.width} className={`journal-recipe mm-recipe-detail__article mm-page-column mm-continuation ${layout ? 'is-measured' : 'is-pending'}${publicDemo ? '' : ' mm-scrap-detail'}`}>
    <JournalFacingPage className={`mm-facing-content--recipe mm-page-column mm-continuation-facing${publicDemo ? '' : ' mm-scrap-detail'}`}>
      <nav className="recipe-back mm-recipe-detail__back" aria-label="Recipe navigation">
        <span className="mm-back-clip"><PaperClip />{back}</span>
        {folio && <span className="mm-recipe-page-number" aria-label={`Scrap number ${folio}`}>No. {folio}</span>}
      </nav>
      <div ref={leftRef} className="mm-continuation-body mm-continuation-left" tabIndex={0} role="region" aria-label="Left recipe page">
        {!single && (identityVisible ? identity : <><h1 className="mm-continuation-title" tabIndex={-1}>Recipe continued</h1><ReadingUnits units={selectUnits(spread[0])} prefix="left" width={layout?.width} /></>)}
      </div>

    </JournalFacingPage>
    <div className={`mm-reading-running-head${publicDemo ? ' mm-reading-running-head--demo' : ''}`}>
      {single && <span className="mm-reading-return">{back}</span>}
      {!single && !publicDemo && <span>{current ? 'Recipe continued' : 'From your journal'}</span>}
    </div>
    <div className="mm-reading-request-status">{status}</div>
    <div ref={bodyRef} className="mm-continuation-body mm-recipe-reading-body" tabIndex={0} role="region" aria-label="Recipe ingredients, instructions and notes">
      {!ready && !layout && <p aria-live="polite">Preparing recipe pages…</p>}
      {single && identityVisible ? identity : <>{single && <h1 className="mm-continuation-title" tabIndex={-1}>Recipe continued</h1>}<ReadingUnits units={selectUnits(single ? spread?.[0] : spread?.[1])} prefix="right" width={layout?.width} />{!ready && !identityVisible && <p aria-live="polite">Preparing recipe pages…</p>}</>}
      {!single && current > 0 && !spread[1] && <p className="mm-reading-end">End of this recipe.</p>}
    </div>
    <div ref={bankRef} className="mm-reading-measure" aria-hidden="true" inert>{measurable && <ReadingUnits units={units} prefix="measure" measured />}</div>
    <JournalPageFooter>
      {actions && <nav className="mm-reading-footer" aria-label="Recipe actions">
        <div className="mm-reading-footer__actions">{actions}</div>
      </nav>}
      <JournalReadingTurns page={current} total={spreads.length} indicator={indicator} onTurn={turn} />
    </JournalPageFooter>
  </article>
}
