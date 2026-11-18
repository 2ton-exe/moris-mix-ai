import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { MAX_PANTRY_ITEM_CHARS, MAX_PANTRY_ITEMS, MAX_PREFERENCES_CHARS } from '../ai-chef/pantry'
import { readChefDraftResult, writeChefDraft } from '../ai-chef/draft'
import type { ChefReviewHandoff } from '../ai-chef/draft'
import { generateRecipeApi, generateRecipeErrorMessage, generateRecipeRequestSchema } from '../ai-chef/generateRecipe'
import { readQuickAiEntryDraftResult, writeQuickAiEntryDraft } from '../quick-ai/draft'
import type { ExtractedRecipe, QuickAiEntryHandoff } from '../quick-ai/extractRecipe'
import { extractRecipeApi, InvalidExtractionResponse, MAX_EXTRACTION_INPUT_CHARS } from '../quick-ai/extractRecipe'
import { missingRecipeDetails, parsePantryPrompt, requestedNavigation, requestedWorkflow } from './chatFlow'
import { useMoriActivity } from './MoriCompanionContext'

type MoriDraft = { kind: 'create'; handoff: QuickAiEntryHandoff } | { kind: 'suggest'; handoff: ChefReviewHandoff }
type MoriRetry = { kind: 'create'; notes: string } | { kind: 'suggest'; prompt: string }
type Message = { id: number; role: 'user' | 'assistant'; text: string; draft?: MoriDraft }

function DraftCard({ draft, onReview, disabled }: { draft: MoriDraft; onReview: (draft: MoriDraft) => void; disabled: boolean }) {
  const recipe: ExtractedRecipe = draft.kind === 'create' ? draft.handoff.recipe : draft.handoff.response.recipe
  const ingredients = recipe.ingredients.slice(0, 3)
  const instructions = recipe.instructions.slice(0, 2)
  return <div className="mori-chat-preview">
    <strong>{recipe.title}</strong>
    <div><h3>Ingredients</h3>
      {ingredients.length ? <ul>{ingredients.map((ingredient, index) => <li key={`${ingredient.name}-${index}`}>{[
        ingredient.quantityText ?? (ingredient.quantity === null ? '' : String(ingredient.quantity)), ingredient.unit, ingredient.name,
      ].filter(Boolean).join(' ')}</li>)}</ul> : <p>No ingredients listed yet.</p>}
      {recipe.ingredients.length > ingredients.length && <span>+ {recipe.ingredients.length - ingredients.length} more</span>}
    </div>
    <div><h3>Method</h3>
      {instructions.length ? <ol>{instructions.map((instruction) => <li key={instruction.step}>{instruction.text}</li>)}</ol> : <p>No cooking steps listed yet.</p>}
      {recipe.instructions.length > instructions.length && <span>+ {recipe.instructions.length - instructions.length} more</span>}
    </div>
    {draft.kind === 'suggest' && <p className="mori-chat-context">
      {draft.handoff.response.parents.length
        ? `Based on ${draft.handoff.response.parents.map((parent) => parent.title).join(', ')}`
        : draft.handoff.response.context.status === 'NO_SAVED_RECIPES'
          ? 'No saved recipes were available for this idea.'
          : 'No saved recipe matched; this idea is based on your pantry request.'}
    </p>}
    <button type="button" disabled={disabled} onClick={() => onReview(draft)}>{draft.kind === 'create' ? 'Review draft' : 'Review recipe'}</button>
  </div>
}

export function MoriChatPanel({ userId }: { userId: string }) {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<Message[]>([{ id: 0, role: 'assistant', text: 'Hi, I’m Mori! I can turn cooking notes into a recipe, find an idea from your pantry, or take you to the right spot.' }])
  const [mode, setMode] = useState<'create' | 'suggest' | null>(null)
  const [composer, setComposer] = useState('')
  const [pending, setPending] = useState(false)
  const [followUp, setFollowUp] = useState<{ notes: string } | null>(null)
  const [retryRequest, setRetryRequest] = useState<MoriRetry | null>(null)
  const id = useRef(1)
  const reviewSequence = useRef(0)
  const reviewKeys = useRef(new WeakMap<MoriDraft, number>())
  const requestId = useRef(0)
  const request = useRef<{ id: number; controller: AbortController; timeout: number } | null>(null)
  const log = useRef<HTMLDivElement>(null)
  const composerId = useId()
  useMoriActivity(pending ? { kind: 'working', message: 'I’m putting your recipe together…' } : null)

  function say(role: Message['role'], text: string, draft?: MoriDraft) {
    const message = { id: id.current++, role, text, ...(draft ? { draft } : {}) }
    setMessages((current) => [...current, message])
  }

  function reviewKeyFor(draft: MoriDraft) {
    let key = reviewKeys.current.get(draft)
    if (key === undefined) {
      key = ++reviewSequence.current
      reviewKeys.current.set(draft, key)
    }
    return key
  }

  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight }, [messages])
  useEffect(() => () => {
    const active = request.current
    if (active) { request.current = null; requestId.current++; window.clearTimeout(active.timeout); active.controller.abort() }
  }, [])

  async function ask<T>(
    action: (signal: AbortSignal) => Promise<T>,
    onSuccess: (value: T) => void,
    onError: (error: unknown, timedOut: boolean) => string,
    timeoutMs: number,
  ) {
    if (request.current) return
    const controller = new AbortController()
    const currentId = ++requestId.current
    let timedOut = false
    const timeout = window.setTimeout(() => {
      timedOut = true
      controller.abort()
      if (requestId.current !== currentId) return
      requestId.current++
      request.current = null
      setPending(false)
      say('assistant', onError(new Error('timeout'), true))
    }, timeoutMs)
    request.current = { id: currentId, controller, timeout }
    setPending(true)
    try {
      const result = await action(controller.signal)
      if (!controller.signal.aborted && requestId.current === currentId) onSuccess(result)
    } catch (error) {
      if (requestId.current === currentId && (!controller.signal.aborted || timedOut)) say('assistant', onError(error, timedOut))
    } finally {
      window.clearTimeout(timeout)
      if (request.current?.id === currentId) {
        request.current = null
        setPending(false)
      }
    }
  }

  function cancel() {
    const active = request.current
    if (!active) return
    requestId.current++
    request.current = null
    window.clearTimeout(active.timeout)
    active.controller.abort()
    setPending(false)
    setRetryRequest(null)
    say('assistant', 'I stopped that request. Nothing was saved; your chat is still here if you want to try again.')
  }

  function openRoute(path: string, message: string, focus?: 'notes' | 'pantry') {
    setRetryRequest(null)
    if (path === '/app/chef' && focus === 'pantry' && readChefDraftResult(userId).draft.handoff) {
      say('assistant', 'You already have a pantry idea waiting in review. I’m opening it so you can finish or discard it before starting another one.')
      navigate('/app/chef/review', { state: { moriKeepOpen: true } })
      return
    }
    say('assistant', message)
    navigate(path, { state: { moriKeepOpen: true, ...(focus ? { moriFocus: focus } : {}) } })
  }

  function start(workflow: 'create' | 'suggest') {
    setMode(workflow)
    setFollowUp(null)
    setRetryRequest(null)
    say('assistant', workflow === 'create'
      ? 'Tell me the messy version: what it’s called, what went in, and how you cooked it. I’ll ask only for required details that are missing.'
      : 'What ingredients do you have? You can add optional preferences after a semicolon, like “rice, eggs; quick and spicy.”')
  }

  async function createRecipe(notes: string) {
    if (notes.length > MAX_EXTRACTION_INPUT_CHARS) {
      say('assistant', `Keep the cooking notes to ${MAX_EXTRACTION_INPUT_CHARS.toLocaleString()} characters or fewer.`)
      return
    }
    await ask(
      (signal) => extractRecipeApi.extract(notes, { userId, signal }),
      (recipe) => {
        setRetryRequest(null)
        const missing = missingRecipeDetails(recipe)
        if (missing.length) {
          setFollowUp({ notes })
          say('assistant', `I’m only missing ${missing.join(' and ')}. What should I add?`)
          return
        }
        setFollowUp(null)
        say('assistant', `Here’s an editable draft of “${recipe.title}”. Review it before saving.`, {
          kind: 'create', handoff: { sourceNotes: notes, recipe, saved: false },
        })
      },
      (error, timedOut) => {
        setFollowUp({ notes })
        setRetryRequest({ kind: 'create', notes })
        if (timedOut) return 'Mori took too long to organize those notes. They’re still in this chat; please try again.'
        return error instanceof InvalidExtractionResponse
          ? 'I could not check that draft safely. Send any missing details or rephrase the cooking notes and I’ll try again.'
          : 'Mori could not organize those notes right now. Add any missing details or send a new version to try again.'
      },
      120_000,
    )
  }

  async function suggestRecipe(prompt: string) {
    const { pantryItems, preferences } = parsePantryPrompt(prompt)
    const parsed = generateRecipeRequestSchema.safeParse({ pantryItems, ...(preferences ? { preferences } : {}) })
    if (!parsed.success) {
      say('assistant', pantryItems.length === 0
        ? 'Tell me at least one ingredient you have. Add optional preferences after a semicolon.'
        : `Use 1–${MAX_PANTRY_ITEMS} pantry items, with each item up to ${MAX_PANTRY_ITEM_CHARS} characters and preferences up to ${MAX_PREFERENCES_CHARS} characters.`)
      return
    }
    await ask(
      (signal) => generateRecipeApi.generate(parsed.data.pantryItems, parsed.data.preferences ?? '', { userId, signal }),
      (response) => {
        setRetryRequest(null)
        say('assistant', `I found an idea using your pantry. Review “${response.recipe.title}” before saving.`, {
          kind: 'suggest', handoff: {
            request: parsed.data,
            response,
            selectedParentIds: [],
            saved: false,
          },
        })
      },
      (error, timedOut) => {
        setRetryRequest({ kind: 'suggest', prompt })
        return generateRecipeErrorMessage(error, timedOut)
      },
      45_000,
    )
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const text = composer.trim()
    if (!text) return
    setComposer('')
    setRetryRequest(null)
    say('user', text)

    const navigation = requestedNavigation(text)
    if (navigation) { openRoute(navigation.path, navigation.message, navigation.focus); return }

    const explicitWorkflow = requestedWorkflow(text, mode === 'create' && followUp !== null)
    const selected = explicitWorkflow ?? mode
    if (!selected) {
      say('assistant', 'I can help make a recipe from cooking notes, suggest something from your pantry, or open your recipes. Pick one below or tell me what you need.')
      return
    }
    if (explicitWorkflow) {
      setMode(explicitWorkflow)
      if (explicitWorkflow !== mode) setFollowUp(null)
    }
    if (selected === 'create') {
      const notes = followUp ? `${followUp.notes}\n\nAdditional details: ${text}` : text
      await createRecipe(notes)
      return
    }
    await suggestRecipe(text)
  }

  function openReview(draft: MoriDraft) {
    if (draft.kind === 'create') {
      const current = readQuickAiEntryDraftResult(userId)
      const sameHandoff = current.draft.handoff && JSON.stringify(current.draft.handoff) === JSON.stringify(draft.handoff)
      const hasContent = current.draft.notes.length > 0 || current.draft.handoff !== null || current.draft.reviewDraft != null || current.draft.blockedUntil !== null
      if (current.status === 'read-failed' || (hasContent && !sameHandoff)) {
        say('assistant', 'There’s already a Quick AI Entry draft in progress, so I left it untouched. Open Cooking Notes to review it first.')
        return
      }
      if (!sameHandoff) writeQuickAiEntryDraft(userId, { notes: draft.handoff.sourceNotes, blockedUntil: null, blockedReason: null, handoff: draft.handoff })
      say('assistant', 'Your unsaved draft is ready in review. Nothing will be saved to your journal until you confirm there.')
      navigate('/app/quick-entry/review', { state: {
        moriKeepOpen: true,
        moriReviewKey: reviewKeyFor(draft),
        sourceJournalReturn: '/app/recipes',
      } })
      return
    }

    const current = readChefDraftResult(userId)
    const sameSuggestion = current.draft.handoff &&
      JSON.stringify(current.draft.handoff.request) === JSON.stringify(draft.handoff.request) &&
      JSON.stringify(current.draft.handoff.response) === JSON.stringify(draft.handoff.response)
    const hasContent = current.draft.input.pantryItems.length > 0 || current.draft.input.pantryInput.length > 0 || current.draft.input.preferences.length > 0 || current.draft.handoff !== null
    if (current.status === 'read-failed' || (hasContent && !sameSuggestion)) {
      say('assistant', 'There’s already an AI Chef draft in progress, so I left it untouched. Open the pantry page to review it first.')
      return
    }
    if (!sameSuggestion) writeChefDraft(userId, {
        input: { pantryItems: draft.handoff.request.pantryItems, pantryInput: '', preferences: draft.handoff.request.preferences ?? '' },
        handoff: draft.handoff,
      })
    say('assistant', 'Your unsaved idea is ready in review. Nothing will be saved to your journal until you confirm there.')
    navigate('/app/chef/review', { state: {
      moriKeepOpen: true,
      chefGenerationSucceeded: true,
      moriReviewKey: reviewKeyFor(draft),
    } })
  }

  function submitOnShortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) event.currentTarget.form?.requestSubmit()
  }

  return <div className="mori-chat">
    <div ref={log} className="mori-chat-log" role="log" aria-label="Chat with Mori" aria-busy={pending} aria-relevant="additions">
      {messages.map((message) => <article key={message.id} className="mori-chat-message" data-role={message.role}>
        <p>{message.text}</p>
        {message.draft && <DraftCard draft={message.draft} disabled={pending} onReview={openReview} />}
      </article>)}
    </div>
    {pending && <div className="mori-chat-pending"><span role="status" aria-live="polite">Mori is working on your request.</span><button type="button" onClick={cancel}>Cancel</button></div>}
    {retryRequest && !pending && <div className="mori-chat-retry"><button type="button" onClick={() => {
      const retry = retryRequest
      setRetryRequest(null)
      if (retry.kind === 'create') void createRecipe(retry.notes)
      else void suggestRecipe(retry.prompt)
    }}>Retry same request</button></div>}
    <div className="mori-chat-shortcuts" role="group" aria-label="Mori shortcuts">
      <button type="button" disabled={pending} onClick={() => start('create')}>Create recipe</button>
      <button type="button" disabled={pending} onClick={() => start('suggest')}>Cooking idea</button>
      <button type="button" disabled={pending} onClick={() => openRoute('/app/recipes', 'Opening your recipe collection.')}>My recipes</button>
      <button type="button" disabled={pending} onClick={() => openRoute('/app/quick-entry', 'Opening your cooking notes.', 'notes')}>Cooking notes</button>
      <button type="button" disabled={pending} onClick={() => openRoute('/app/chef', 'Opening the pantry field.', 'pantry')}>Pantry</button>
    </div>
    <form className="mori-chat-composer" onSubmit={(event) => { void submit(event) }}>
      <label className="mori-pet-sr" htmlFor={composerId}>Message Mori</label>
      <textarea id={composerId} rows={2} value={composer} disabled={pending} placeholder="Tell Mori what you need…" onChange={(event) => setComposer(event.currentTarget.value)} onKeyDown={submitOnShortcut} />
      <button type="submit" disabled={pending || !composer.trim()}>Send</button>
    </form>
    <p className="mori-chat-hint">Enter a new line; press Ctrl/⌘ + Enter to send.</p>
  </div>
}
