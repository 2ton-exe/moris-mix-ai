import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation } from 'react-router'
import { useAuth } from '../auth/context'
import { HttpError } from '../api/http'
import { useJournalRecord } from '../journal/journalRecord'
import { useRecipe } from './queries'
import { isRecipeAccessError } from './errors'
import { ribbonKey, ribbonRecipeSchema, stickerKey, stickerMemorySchema, stickerNames } from './recipeKeepsakeRecords'
import type { RecipeDetail } from './types'
import basket from '../assets/stickers/ingredient-basket.svg'
import bowl from '../assets/stickers/mixing-bowl.svg'
import bottle from '../assets/stickers/pantry-bottle.svg'
import peppercorns from '../assets/stickers/peppercorns.svg'
import hearts from '../assets/stickers/scrapbook-hearts.svg'

const stickerArt = {
  'Ingredient basket': basket,
  'Mixing bowl': bowl,
  'Pantry bottle': bottle,
  Peppercorns: peppercorns,
  Hearts: hearts,
}
const storageError = 'This browser could not save your change. Try again.'

export function RecipeKeepsakes({ recipe, tool }: { recipe: RecipeDetail; tool: 'ribbon' | 'sticker' }) {
  const { user, isAuthenticated, isLoading } = useAuth()
  if (!isAuthenticated || isLoading || !user) return null
  return tool === 'ribbon'
    ? <RibbonEditor key={user.id} userId={user.id} recipe={recipe} />
    : <StickerMemory key={user.id} userId={user.id} recipeId={recipe.id} />
}

function RibbonEditor({ userId, recipe }: { userId: string; recipe: RecipeDetail }) {
  const ribbon = useJournalRecord(ribbonKey(userId), ribbonRecipeSchema)
  const [replacing, setReplacing] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const action = useRef<HTMLButtonElement>(null)
  const current = useRecipe(replacing === ribbon.value ? replacing ?? '' : '')
  const active = ribbon.value === recipe.id
  const revisionChanged = replacing !== null && replacing !== ribbon.value
  const previousTitle = !isRecipeAccessError(current.error) ? current.data?.title : undefined

  function update(next: string | null) {
    if (next !== null && !ribbonRecipeSchema.safeParse(next).success) {
      setStatus('This recipe is unavailable for the ribbon.')
      return
    }
    if (!ribbon.write(next)) {
      setStatus(storageError)
      return
    }
    setReplacing(null)
    setStatus(next ? 'Recipe set aside.' : 'Ribbon removed.')
    action.current?.focus()
  }

  return <div className="mm-journal-tool">
    <p>Saved on this browser.</p>
    <button ref={action} type="button" className="button button-secondary mm-button--small"
      aria-expanded={replacing !== null && !active} onClick={() => {
        if (active) update(null)
        else if (ribbon.value) {
          setStatus('')
          setReplacing(ribbon.value)
        } else update(recipe.id)
      }}>{active ? 'Remove Ribbon' : 'Set aside to cook next'}</button>
    {ribbon.unreadable && <p>The saved ribbon could not be read.</p>}
    {replacing !== null && !active && <div className="mm-journal-tool__form">
      {revisionChanged ? <p>The ribbon changed in another tab. Start the replacement again.</p>
        : <p>Replace {previousTitle ? <strong>{previousTitle}</strong> : 'the current ribbon'} with <strong>{recipe.title}</strong>?</p>}
      {!revisionChanged && current.isPending && <p role="status">Checking the current ribbon…</p>}
      {!revisionChanged && current.isError && !(current.error instanceof HttpError && current.error.status === 404) &&
        <button type="button" onClick={() => void current.refetch()}>Retry loading the current ribbon</button>}
      <div className="mm-journal-tool__actions">
        <button type="button" className="button button-primary mm-button--small"
          disabled={revisionChanged || (!previousTitle && !(current.error instanceof HttpError && current.error.status === 404))}
          onClick={() => update(recipe.id)}>Replace Ribbon</button>
        <button type="button" className="button button-secondary mm-button--small" onClick={() => {
          setReplacing(null)
          action.current?.focus()
        }}>Cancel</button>
      </div>
    </div>}
    {status && <p role="status">{status}</p>}
  </div>
}

export function CookNextRibbon({ userId }: { userId: string }) {
  const { pathname, search, hash } = useLocation()
  const ribbon = useJournalRecord(ribbonKey(userId), ribbonRecipeSchema)
  const current = useRecipe(ribbon.value ?? '')
  const [status, setStatus] = useState('')
  const heading = useRef<HTMLParagraphElement>(null)
  const available = current.data && !isRecipeAccessError(current.error)
  return <section className="mm-cook-next" aria-label="Cook next ribbon">
    <p className="mm-cook-next__label" ref={heading} tabIndex={-1}>Cook next</p>
    {ribbon.value ? <>
      {available && <Link to={`/app/recipes/${encodeURIComponent(current.data.id)}`}
        state={{ journalReturn: pathname + search + hash, journalAccount: userId }}>{current.data.title}</Link>}
      {current.isPending && <p role="status">Opening your ribbon…</p>}
      {current.isError && <p>{current.error instanceof HttpError && current.error.status === 404
        ? 'This recipe is no longer available.' : 'Could not check your ribbon.'}</p>}
      {current.isError && !(current.error instanceof HttpError && [401, 403, 404].includes(current.error.status ?? 0)) &&
        <button type="button" className="button button-secondary mm-button--small" onClick={() => void current.refetch()}>Retry ribbon</button>}
    </> : <p>{ribbon.unreadable ? 'The saved ribbon could not be read.' : 'Choose a recipe to set aside.'}</p>}
    {(ribbon.value || ribbon.unreadable) && <button type="button" className="button button-secondary mm-button--small" onClick={() => {
      const removed = ribbon.write(null)
      setStatus(removed ? 'Ribbon removed.' : storageError)
      if (removed) heading.current?.focus()
    }}>Remove Ribbon</button>}
    <p className="mm-journal-tool__hint">Saved on this browser.</p>
    {status && <p role="status">{status}</p>}
  </section>
}

function StickerMemory({ userId, recipeId }: { userId: string; recipeId: string }) {
  const saved = useJournalRecord(stickerKey(userId, recipeId), stickerMemorySchema)
  const [editing, setEditing] = useState(false)
  const [status, setStatus] = useState('')
  const action = useRef<HTMLButtonElement>(null)

  function finish(message: string) {
    setEditing(false)
    setStatus(message)
    action.current?.focus()
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const result = stickerMemorySchema.safeParse({ sticker: form.get('sticker'), label: form.get('label') })
    if (!result.success) {
      setStatus('Choose a sticker and enter a memory label.')
      return
    }
    if (saved.write(result.data)) finish('Sticker memory saved.')
    else setStatus(storageError)
  }

  return <div className="mm-journal-tool">
    <p>Saved on this browser.</p>
    {saved.value && <ul className="mm-sticker-memories"><li>
      <details>
        <summary><img src={stickerArt[saved.value.sticker]} width={36} height={36} alt="" /> {saved.value.label}</summary>
        <p>{saved.value.sticker}</p>
      </details>
    </li></ul>}
    {saved.unreadable && <p>The sticker memory could not be read.</p>}
    <div className="mm-journal-tool__actions">
      <button ref={action} type="button" className="button button-secondary mm-button--small" aria-expanded={editing}
        onClick={() => { setEditing(!editing); setStatus('') }}>{saved.value ? 'Edit sticker memory' : 'Place a sticker'}</button>
      {(saved.value || saved.unreadable) && <button type="button" className="button button-secondary mm-button--small" onClick={() => {
        if (saved.write(null)) finish('Sticker memory removed.')
        else setStatus(storageError)
      }}>Remove sticker memory</button>}
    </div>
    {editing && <form className="mm-journal-tool__form" onSubmit={save}>
      <fieldset className="mm-ink-choices">
        <legend>Choose a sticker</legend>
        {stickerNames.map((name) => <label key={name}>
          <input type="radio" name="sticker" value={name} defaultChecked={(saved.value?.sticker ?? stickerNames[0]) === name} />
          <img src={stickerArt[name]} width={38} height={38} alt="" />
          <span>{name}</span>
        </label>)}
      </fieldset>
      <label className="mm-journal-tool__field">Memory label
        <input name="label" required maxLength={100} defaultValue={saved.value?.label ?? ''} />
      </label>
      <div className="mm-journal-tool__actions">
        <button type="submit" className="button button-primary mm-button--small">Save sticker memory</button>
        <button type="button" className="button button-secondary mm-button--small" onClick={() => finish('')}>Cancel</button>
      </div>
    </form>}
    {status && <p role="status">{status}</p>}
  </div>
}
