import { Plus, Sparkles } from 'lucide-react'
import { JournalFacingPage, JournalPageFooter } from '../journal/JournalFacingPage'
import { JournalPagination } from '../journal/JournalPagination'
import { PaperCard } from '../journal/Scrapbook'
import { ChefProgress } from './ChefProgress'
import { MAX_PANTRY_ITEMS } from './pantry'
import './aiChef.css'

export function AIChefSkeleton({ message }: { message: string }) {
  return <>
    <span role="status" className="visually-hidden">{message}</span>
    <JournalFacingPage className="mm-facing-content--ai-chef mm-facing-content--ai-chef-task">
      <div style={{ display: 'contents' }} aria-hidden="true" inert>
        <ChefProgress stage="pantry" scrapbook compact />
        <form className="mm-ai-chef__entry-panel">
          <div className="mm-ai-chef__entry">
            <fieldset disabled>
              <legend>Pantry ingredients</legend>
              <p className="mm-ai-chef__help">Add up to {MAX_PANTRY_ITEMS} ingredients. Press Enter to add one or paste a list separated by commas or line breaks. Cooking preferences are optional.</p>
              <div className="mm-ai-chef__ingredient-entry">
                <label className="visually-hidden" htmlFor="loading-pantry-item">Pantry ingredient</label>
                <input id="loading-pantry-item" type="text" placeholder="e.g. rice, eggs, tomatoes" className="mm-skeleton-line" />
                <button className="button button-secondary" type="button"><Plus size={17} aria-hidden="true" />Add ingredient</button>
              </div>
              <details className="mm-ai-chef__quick-add"><summary>Quick add common ingredients</summary></details>
            </fieldset>
          </div>
        </form>
      </div>
    </JournalFacingPage>
    <section className="mm-ai-chef mm-page-column" data-pantry-board="grid" data-pantry-front aria-busy="true" aria-hidden="true" inert>
      <PaperCard className="mm-ai-chef__paper" surface="fresh" tape="sage">
        <form className="mm-ai-chef__form">
          <section className="mm-ai-chef__page" data-chef-pantry>
            <header className="mm-ai-chef__heading"><h1>What’s in your pantry?</h1></header>
            <section className="mm-ai-chef__pantry-list">
              <header className="mm-ai-chef__board-header"><h2>Your pantry <span>(0)</span></h2></header>
              <p className="mm-ai-chef__empty"><strong>No ingredients yet.</strong><span>Add a few on the left to get your recipe started.</span></p>
            </section>
          </section>
        </form>
      </PaperCard>
      <JournalPageFooter>
        <div className="mm-ai-chef__footer-actions" aria-hidden="true" inert>
          <button type="button" className="button button-primary" disabled><Sparkles size={17} aria-hidden="true" />Ask Mori for a recipe</button>
          <p className="mm-ai-chef__save-note">Nothing is saved until you choose Save recipe.</p>
        </div>
        <JournalPagination loading label="AI Chef pages" rightNumber="Page 1 of 2" />
      </JournalPageFooter>
    </section>
  </>
}
