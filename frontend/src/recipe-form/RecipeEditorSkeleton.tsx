import { JournalFacingPage, JournalPageFooter } from '../journal/JournalFacingPage'
import { JournalPagination } from '../journal/JournalPagination'
import { useJournalMedia } from '../journal/useJournalMedia'
import './newRecipeScrapbook.css'
import './recipe-form.css'

export function RecipeEditorSkeleton({ message = 'Loading recipe for editing…', showHeading = true, title = 'Edit recipe' }: { message?: string; showHeading?: boolean; title?: string }) {
  const single = useJournalMedia('(max-width: 1099.98px), (max-height: 639.98px)')
  const identity = <div className="mm-page-body mm-writing-leaf mm-form-identity" aria-hidden="true" inert>
    <div className="mm-writing-leaf__content"><section className="recipe-form-section">
      <div className="recipe-section-heading"><h2>Recipe identity</h2></div>
      <div className="mm-loading-fields">
        <div className="recipe-form-field"><span>Recipe title</span><span className="mm-skeleton-line mm-skeleton-field" /></div>
        <div className="recipe-amount-row">
          {['Cooked date', 'Rating'].map(label => <div className="recipe-form-field" key={label}><span>{label}</span><span className="mm-skeleton-line mm-skeleton-field" /></div>)}
        </div>
        {title === 'Edit recipe' && import.meta.env.VITE_RECIPE_IMAGES === 'true' && <div className="recipe-image-panel"><h2>Recipe image</h2><div className="recipe-image mm-skeleton-block mm-loading-photo" /><span className="mm-skeleton-line mm-skeleton-field" /></div>}
        <div className="recipe-form-field"><span>Notes</span><span className="mm-skeleton-block mm-skeleton-notes" /></div>
      </div>
    </section></div>
  </div>
  return <><span role="status" className="visually-hidden">{message}</span>
    <div className="mm-page-column mm-paper-loading" aria-busy="true">
      {showHeading && <JournalFacingPage className="mm-facing-content--editor"><header className="mm-recipe-editor-heading" aria-hidden="true"><h1>{title}</h1>{title === 'Edit recipe' && <p className="intro">Your journal keeps the last saved version while you edit.</p>}</header></JournalFacingPage>}
      <JournalFacingPage className="mm-facing-content--form mm-page-column mm-journal-editor">{!single && identity}</JournalFacingPage>
      <div className="recipe-form-content mm-writing-pages mm-page-column" aria-hidden="true" inert>
        {single ? identity : <div className="mm-page-body mm-writing-leaf mm-form-recipe"><div className="mm-writing-leaf__content">
          <section className="recipe-form-section recipe-form-section--ingredients">
            <div className="recipe-section-heading"><h2>Ingredients</h2></div>
            <p className="field-hint">A written amount like “to taste” overrides quantity and unit.</p>
            <p className="field-hint"><span className="mm-skeleton-line" /></p>
            <div className="recipe-ingredient-list">{[0, 1].map(index => <div className="recipe-editor-row recipe-ingredient-card recipe-ingredient-compact" key={index}>
              <span className="mm-skeleton-line mm-skeleton-icon" /><span className="recipe-ingredient-summary"><span className="mm-skeleton-line mm-skeleton-line--short" /><span className="mm-skeleton-line" /></span>
            </div>)}</div>
          </section>
        </div></div>}
      </div>
      <JournalPageFooter><div className="mm-form-footer" aria-hidden="true"><div className="actions recipe-form-actions"><span className="mm-skeleton-line mm-skeleton-action" /><span className="mm-skeleton-line mm-skeleton-action" /></div><JournalPagination loading label="Recipe writing pages" rightNumber={<span className="mm-skeleton-line mm-skeleton-line--short" />} /></div></JournalPageFooter>
    </div>
  </>
}
