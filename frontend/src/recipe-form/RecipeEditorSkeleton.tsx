import { JournalFacingPage, JournalPageFooter } from '../journal/JournalFacingPage'
import { JournalPagination } from '../journal/JournalPagination'
import { useJournalMedia } from '../journal/useJournalMedia'
import { Plus } from 'lucide-react'
import { ScrapbookSticker } from '../journal/ScrapbookSticker'
import { RecipeFormField } from './RecipeFormField'
import { RecipeStarRating } from './RecipeStarRating'
import './newRecipeScrapbook.css'
import './recipe-form.css'
import './detail-dialog.css'

export function RecipeEditorSkeleton({ message = 'Loading recipe for editing…', showHeading = true, title = 'Edit recipe', extractionReview = false }: { message?: string; showHeading?: boolean; title?: string; extractionReview?: boolean }) {
  const single = useJournalMedia('(max-width: 1099.98px), (max-height: 639.98px)')
  const desktopCreate = !single && title === 'New recipe'
  const identity = <div className="mm-page-body mm-writing-leaf mm-form-identity" aria-hidden="true" inert>
    <div className="mm-writing-leaf__content"><section className="recipe-form-section">
      <div className="recipe-section-heading"><h2>Recipe identity</h2></div>
      {desktopCreate ? <>
        <RecipeFormField id="loading-title" label="Recipe title"><textarea id="loading-title" name="title" rows={1} disabled className="mm-skeleton-block" /></RecipeFormField>
        <h3>Cooking information</h3>
        <div className="recipe-amount-row">
          <RecipeFormField id="loading-date" label={<>Cooked date <small>(optional)</small></>}><input id="loading-date" type="date" disabled className="mm-skeleton-line" /></RecipeFormField>
          <RecipeStarRating field={{ id: 'loading-rating', name: 'star_rating', 'aria-invalid': false, 'data-form-focus-key': 'loading-rating' }} value="" onChange={() => {}} />
        </div>
        <div className="mm-scrapbook-form__notes">
          <RecipeFormField id="loading-notes" label={<>Notes <small>(optional)</small></>}><textarea id="loading-notes" name="notes" rows={4} disabled className="mm-skeleton-block" /></RecipeFormField>
          <button type="button" disabled className="mm-review-detail-link">Expand notes</button>
        </div>
      </> : <div className={`mm-loading-fields${extractionReview && !single ? ' mm-loading-fields--review' : ''}`}>
        <div className="recipe-form-field"><span>Recipe title</span><span className="mm-skeleton-line mm-skeleton-field" /></div>
        <div className="recipe-amount-row">
          {extractionReview && !single ? <>
            <div className="recipe-form-field"><span>Cooked date <small>(optional)</small></span><span className="mm-skeleton-line mm-skeleton-field" /></div>
            <RecipeStarRating field={{ id: 'loading-rating', name: 'star_rating', 'aria-invalid': false, 'data-form-focus-key': 'loading-rating' }} value="" onChange={() => {}} />
          </> : ['Cooked date', 'Rating'].map(label => <div className="recipe-form-field" key={label}><span>{label}</span><span className="mm-skeleton-line mm-skeleton-field" /></div>)}
        </div>
        {title === 'Edit recipe' && import.meta.env.VITE_RECIPE_IMAGES === 'true' && <div className="recipe-image-panel"><h2>Recipe image</h2><div className="recipe-image mm-skeleton-block mm-loading-photo" /><span className="mm-skeleton-line mm-skeleton-field" /></div>}
        <div className="recipe-form-field"><span>Notes</span><span className="mm-skeleton-block mm-skeleton-notes" /></div>
      </div>}
    </section></div>
  </div>
  return <><span role="status" className="visually-hidden">{message}</span>
    <div className="mm-page-column mm-paper-loading" aria-busy="true">
      {showHeading && <JournalFacingPage className="mm-facing-content--editor"><header className="mm-recipe-editor-heading" aria-hidden="true"><h1>{title}</h1>{desktopCreate && <p className="intro">Save with a title. Add ingredients and steps anytime.</p>}{title === 'Edit recipe' && <p className="intro">Your journal keeps the last saved version while you edit.</p>}{extractionReview && !single && <p className="intro">Review each section. Save on the last page.</p>}</header>
        {extractionReview && !single && <section className="mm-extraction-notes mm-extraction-notes--facing" aria-hidden="true" inert>
          <p>Compare Mori’s ingredients with your cooking notes.</p>
          <div className="mm-extraction-notes__references"><details><summary>Original cooking notes</summary></details><details><summary>Draft details</summary></details></div>
        </section>}
      </JournalFacingPage>}
      <JournalFacingPage className="mm-facing-content--form mm-page-column mm-journal-editor">{!single && identity}</JournalFacingPage>
      <div className="recipe-form-content mm-writing-pages mm-page-column" aria-hidden="true" inert>
        {single ? identity : <div className="mm-page-body mm-writing-leaf mm-form-recipe"><div className="mm-writing-leaf__content">
          <section className="recipe-form-section recipe-form-section--ingredients">
            <div className="recipe-section-heading"><h2>{desktopCreate ? <span>Ingredients</span> : 'Ingredients'}</h2>{desktopCreate && <ScrapbookSticker name="ingredient-basket" className="mm-new-recipe__basket" decorative />}</div>
            <p className="field-hint">A written amount like “to taste” overrides quantity and unit.</p>
            {desktopCreate ? <>
              <div className="recipe-ingredient-list"><p className="editor-empty">No ingredients yet.</p>
                <button type="button" className="button mm-row-add" disabled><Plus size={16} aria-hidden="true" /> Add ingredient</button>
              </div>
            </> : <>
            <p className="field-hint"><span className="mm-skeleton-line" /></p>
            <div className="recipe-ingredient-list">{[0, 1].map(index => <div className="recipe-editor-row recipe-ingredient-card recipe-ingredient-compact" key={index}>
              <span className="mm-skeleton-line mm-skeleton-icon" /><span className="recipe-ingredient-summary"><span className="mm-skeleton-line mm-skeleton-line--short" /><span className="mm-skeleton-line" /></span>
            </div>)}</div>
            </>}

          </section>
        </div></div>}
      </div>
      <JournalPageFooter><div className="mm-form-footer" aria-hidden="true"><div className="actions recipe-form-actions">{desktopCreate ? <><button type="button" className="button button-secondary" disabled>Back to journal</button><button type="button" className="button button-primary" disabled>Save recipe</button></> : <><span className="mm-skeleton-line mm-skeleton-action" /><span className="mm-skeleton-line mm-skeleton-action" /></>}</div><JournalPagination loading label="Recipe writing pages" rightNumber={<span className="mm-skeleton-line mm-skeleton-line--short" />} /></div></JournalPageFooter>
    </div>
  </>
}
