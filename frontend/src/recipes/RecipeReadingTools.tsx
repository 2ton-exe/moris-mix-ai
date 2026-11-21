import { useRef, useState, type ReactNode } from 'react'
import { ScrapbookButton } from '../journal/Scrapbook'
import { KitchenImprint } from './KitchenImprint'
import type { RecipeDetail } from './types'
import './recipeReadingTools.css'

export function RecipeReadingTools({ recipe, userId, journalReturn, children }: {
  recipe: RecipeDetail; userId: string; journalReturn: string; children?: ReactNode
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState('')

  function close(confirmation = '') {
    setMessage(confirmation)
    setEditing(false)
    trigger.current?.focus()
  }

  return <details className="mm-reading-tools">
    <summary>Journal tools</summary>
    <div className="mm-reading-tools__content">
      <ScrapbookButton ref={trigger} tone="paper" size="small" aria-expanded={editing}
        onClick={() => { setMessage(''); setEditing(!editing) }}>
        {recipe.cooked_at ? 'Update cooking record' : 'Record cooking'}
      </ScrapbookButton>
      {editing && <KitchenImprint recipe={recipe} userId={userId} journalReturn={journalReturn} close={close} />}
      <p className="mm-reading-tools__status" role="status">{message}</p>
      {children}
    </div>
  </details>
}
