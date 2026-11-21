import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/context'
import { useJournalPageTurn } from '../journal/JournalPageTurn'
import { JournalLogoutGuardContext } from '../journal/JournalLogoutGuardContext'
import { ScrapbookButton } from '../journal/Scrapbook'
import { appendPersonalNote, queueNoteHandoff } from '../recipe-form/noteHandoff'
import { UnsavedChangesDialog } from '../recipe-form/UnsavedChangesDialog'
import { useUnsavedChangesGuard } from '../recipe-form/useUnsavedChangesGuard'
import { BorrowedNote } from './BorrowedNote'
import { RecipeFamilyMargins } from './RecipeFamilyMargins'
import { RecipeKeepsakes } from './RecipeKeepsakes'
import { OneSmallChange } from './OneSmallChange'
import { KitchenImprint } from './KitchenImprint'
import { recipeKeys } from './queryOptions'
import { RecipeSourceContext } from './source'
import type { RecipeDetail } from './types'
import './recipeReadingTools.css'

type Tool = 'imprint' | 'trial' | 'family' | 'borrow' | 'ribbon' | 'sticker'
type EditorDestination = { id: string; path: string }

export function RecipeReadingTools({ recipe, userId, journalReturn, retainActiveTool }: {
  recipe: RecipeDetail; userId: string; journalReturn: string; retainActiveTool: (active: boolean) => void
}) {
  const activeTrigger = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  const [tool, setTool] = useState<Tool | null>(null)
  const [message, setMessage] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [logoutPending, setLogoutPending] = useState(false)
  const { logout } = useAuth()
  const registerLogoutGuard = useContext(JournalLogoutGuardContext)
  const [destination, setDestination] = useState<EditorDestination | null>(null)
  const source = useContext(RecipeSourceContext)
  const client = useQueryClient()
  const navigate = useNavigate()
  const { search } = useLocation()
  const { isTurning } = useJournalPageTurn()
  const guard = useUnsavedChangesGuard((dirty || busy) && destination === null, { warnOnUnload: true })
  const reviewRequest = useRef<AbortController | null>(null)
  useLayoutEffect(() => () => reviewRequest.current?.abort(), [search, isTurning])
  useLayoutEffect(() => {
    retainActiveTool(dirty || busy)
  }, [busy, dirty, retainActiveTool])
  useEffect(() => registerLogoutGuard?.(() => {
    if (!dirty && !busy) return true
    setConfirmLogout(true)
    return false
  }), [busy, dirty, registerLogoutGuard])

  async function discardAndLogOut() {
    if (logoutPending) return
    setLogoutPending(true)
    try { await logout() }
    catch { setMessage('Could not log out. Your text is still here.') }
    finally { setConfirmLogout(false); setLogoutPending(false) }
  }
  useLayoutEffect(() => {
    if (!busy && tool === null && restoreFocus.current) {
      restoreFocus.current = false
      activeTrigger.current?.focus()
    }
  }, [busy, tool])

  useEffect(() => {
    if (destination) void navigate(destination.path, { state: { journalReturn, noteHandoff: destination.id } })
  }, [destination, journalReturn, navigate])

  async function reviewNote(text: string, base: string) {
    if (reviewRequest.current || destination || isTurning) return
    const controller = new AbortController()
    reviewRequest.current = controller
    setBusy(true)
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
      return controller.signal.aborted
        ? undefined
        : 'Could not load current Personal Notes. Your text is still here. Try again.'
    } finally {
      if (reviewRequest.current === controller) {
        reviewRequest.current = null
        setBusy(false)
      }
    }
  }

  function close(confirmation = '') {
    setMessage(confirmation)
    setTool(null)
    setDirty(false)
    restoreFocus.current = true
  }

  return <>
    <details className="mm-reading-tools">
      <summary onClick={(event) => { if (busy) event.preventDefault() }}>Journal tools</summary>
      <div className="mm-reading-tools__content">
        {([
          { id: 'imprint', label: recipe.cooked_at ? 'Update cooking record' : 'Record cooking' },
          { id: 'trial', label: 'One small change' },
          { id: 'family', label: 'Recipe family' },
          { id: 'ribbon', label: 'Cook next ribbon' },
          { id: 'sticker', label: 'Sticker memories' },
          ...(recipe.notes?.trim() ? [{ id: 'borrow', label: 'Borrow from Personal Notes' } as const] : []),
        ] satisfies { id: Tool; label: string }[]).map(({ id, label }) => <ScrapbookButton key={id}
          tone="paper" size="small" aria-expanded={tool === id} disabled={busy || (dirty && tool !== id)}
          onClick={(event) => {
            activeTrigger.current = event.currentTarget
            setMessage('')
            if (!dirty && !busy) setTool(tool === id ? null : id)
          }}>{label}</ScrapbookButton>)}
        {tool === 'imprint' && <KitchenImprint recipe={recipe} userId={userId} close={close} reviewNote={reviewNote} setNoteDirty={setDirty} setBusy={setBusy} />}
        {tool === 'trial' && <OneSmallChange recipe={recipe} userId={userId} close={close} reviewNote={reviewNote} setNoteDirty={setDirty} />}
        {tool === 'family' && <RecipeFamilyMargins recipeId={recipe.id} userId={userId} journalReturn={journalReturn} />}
        {(tool === 'ribbon' || tool === 'sticker') && <RecipeKeepsakes recipe={recipe} tool={tool} />}
        {tool === 'borrow' && recipe.notes && <BorrowedNote notes={recipe.notes} title={recipe.title} onContinue={(text) => {
          const id = queueNoteHandoff({ userId, destination: 'new', title: recipe.title, text, baseChanged: false })
          setDestination({ id, path: '/app/recipes/new' })
        }} />}
        {message && <p className="mm-reading-tools__status" role="status">{message}</p>}
      </div>
    </details>
    {(confirmLogout || guard.open) && busy ? <UnsavedChangesDialog title="Cooking entry in progress"
      message="Wait for the current request to finish before leaving the recipe."
      onKeepEditing={() => { setConfirmLogout(false); guard.keepEditing() }} />
      : confirmLogout ? <UnsavedChangesDialog title="Log out of the journal?"
      message="You have a cooking entry in progress. Keep editing or log out now."
      discardLabel={logoutPending ? 'Logging out…' : 'Log out'}
      onKeepEditing={() => { if (!logoutPending) setConfirmLogout(false) }}
      onDiscardChanges={() => void discardAndLogOut()} />
      : guard.open && <UnsavedChangesDialog onKeepEditing={guard.keepEditing} onDiscardChanges={guard.discardChanges} />}
  </>
}
