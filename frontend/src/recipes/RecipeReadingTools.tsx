import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { ScrapbookButton } from '../journal/Scrapbook'
import { appendPersonalNote, queueNoteHandoff } from '../recipe-form/noteHandoff'
import { UnsavedChangesDialog } from '../recipe-form/UnsavedChangesDialog'
import { useUnsavedChangesGuard } from '../recipe-form/useUnsavedChangesGuard'
import { OneSmallChange } from './OneSmallChange'
import { KitchenImprint } from './KitchenImprint'
import { recipeKeys } from './queryOptions'
import { RecipeSourceContext } from './source'
import type { RecipeDetail } from './types'
import './recipeReadingTools.css'

type Tool = 'imprint' | 'trial'
type EditorDestination = { id: string; path: string }

export function RecipeReadingTools({ recipe, userId, journalReturn, children }: {
  recipe: RecipeDetail; userId: string; journalReturn: string; children?: ReactNode
}) {
  const imprintTrigger = useRef<HTMLButtonElement>(null)
  const trialTrigger = useRef<HTMLButtonElement>(null)
  const [tool, setTool] = useState<Tool | null>(null)
  const [message, setMessage] = useState('')
  const [dirty, setDirty] = useState(false)
  const [destination, setDestination] = useState<EditorDestination | null>(null)
  const source = useContext(RecipeSourceContext)
  const client = useQueryClient()
  const navigate = useNavigate()
  const guard = useUnsavedChangesGuard(dirty && destination === null, { warnOnUnload: true })
  const reviewRequest = useRef<AbortController | null>(null)
  useEffect(() => () => reviewRequest.current?.abort(), [])

  useEffect(() => {
    if (destination) void navigate(destination.path, { state: { journalReturn, noteHandoff: destination.id } })
  }, [destination, journalReturn, navigate])

  async function reviewNote(text: string, base: string) {
    if (reviewRequest.current || destination) return
    const controller = new AbortController()
    reviewRequest.current = controller
    try {
      const current = await source.detail(recipe.id, { userId, signal: controller.signal })
      controller.signal.throwIfAborted()
      const latest = current.notes ?? ''
      if (appendPersonalNote(latest, text).length > 20_000) {
        return 'There is no room to add this text to Personal Notes. Shorten it or edit the existing notes first.'
      }
      const key = recipeKeys.detail(userId, recipe.id)
      await client.cancelQueries({ queryKey: key, exact: true })
      controller.signal.throwIfAborted()
      client.setQueryData(key, current)
      const id = queueNoteHandoff({ userId, destination: recipe.id, title: recipe.title, text, baseChanged: base !== latest })
      setDestination({ id, path: `/app/recipes/${encodeURIComponent(recipe.id)}/edit` })
    } catch {
      return 'Could not load current Personal Notes. Your text is still here. Try again.'
    } finally {
      if (reviewRequest.current === controller) reviewRequest.current = null
    }
  }

  function close(confirmation = '') {
    setMessage(confirmation)
    setTool(null)
    setDirty(false)
    if (tool === 'imprint') imprintTrigger.current?.focus()
    if (tool === 'trial') trialTrigger.current?.focus()
  }

  return <>
    <details className="mm-reading-tools">
      <summary>Journal tools</summary>
      <div className="mm-reading-tools__content">
        <ScrapbookButton ref={imprintTrigger} tone="paper" size="small" aria-expanded={tool === 'imprint'}
          disabled={dirty && tool !== 'imprint'} onClick={() => { setMessage(''); setTool('imprint') }}>
          {recipe.cooked_at ? 'Update cooking record' : 'Record cooking'}
        </ScrapbookButton>
        <ScrapbookButton ref={trialTrigger} tone="paper" size="small" aria-expanded={tool === 'trial'}
          disabled={dirty && tool !== 'trial'} onClick={() => setTool('trial')}>One small change</ScrapbookButton>
        {children}
        {tool === 'imprint' && <KitchenImprint recipe={recipe} userId={userId} close={close} reviewNote={reviewNote} setNoteDirty={setDirty} />}
        {tool === 'trial' && <OneSmallChange recipe={recipe} userId={userId} close={close} reviewNote={reviewNote} setNoteDirty={setDirty} />}
        <p className="mm-reading-tools__status" role="status">{message}</p>
      </div>
    </details>
    {guard.open && <UnsavedChangesDialog onKeepEditing={guard.keepEditing} onDiscardChanges={guard.discardChanges} />}
  </>
}
