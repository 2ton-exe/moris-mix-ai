import { useContext, useEffect, useLayoutEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useLocation, useNavigate, type NavigateOptions } from 'react-router'
import { BookOpen, ChefHat, CookingPot, NotebookPen, Search } from 'lucide-react'
import { useNavigationConfirmation } from '../recipe-form/navigationConfirmation'
import { SuggestedPrompts } from './SuggestedPrompts'
import { promptCaret, suggestionContext } from './suggestions'
import { HttpError, httpErrorCode } from '../api/http'
import { aiRateLimitReason } from '../api/aiRateLimit'
import { retryAfterMessage, retryAfterSeconds } from '../api/retryAfter'
import { MAX_PANTRY_ITEM_CHARS, MAX_PANTRY_ITEMS, MAX_PREFERENCES_CHARS } from '../ai-chef/pantry'
import { readChefDraftResult, writeChefDraft } from '../ai-chef/draft'
import type { ChefReviewHandoff } from '../ai-chef/draft'
import { generateRecipeApi, generateRecipeErrorMessage, generateRecipeRequestSchema } from '../ai-chef/generateRecipe'
import { readQuickAiEntryDraftResult, writeQuickAiEntryDraft } from '../quick-ai/draft'
import type { ExtractedRecipe, QuickAiEntryHandoff } from '../quick-ai/extractRecipe'
import { extractRecipeApi, InvalidExtractionResponse, MAX_EXTRACTION_INPUT_CHARS } from '../quick-ai/extractRecipe'
import { mapExtractedRecipeToDraft } from '../quick-ai/recipeDraft'
import { IngredientEmoji } from '../recipe-form/IngredientEmojiView'
import { missingRecipeDetails, parsePantryPrompt, requestedNavigation, requestedRecipeTitle, requestedReview, requestedWorkflow } from './chatFlow'
import { useMoriActivity, useMoriReviewCompletion } from './MoriCompanionContext'
import { findSavedRecipesByTitle } from '../recipes/findSavedRecipesByTitle'
import { formatCookedDate } from '../recipes/recipePresentation'
import { useJournalMedia } from '../journal/useJournalMedia'
import { RecipeSourceContext } from '../recipes/source'
import type { RecipeSummary } from '../recipes/types'

type MoriDraft = { kind: 'create'; handoff: QuickAiEntryHandoff } | { kind: 'suggest'; handoff: ChefReviewHandoff }
type MoriRetry = { kind: 'create'; notes: string } | { kind: 'suggest'; prompt: string }
type MoriCooldowns = Partial<Record<MoriRetry['kind'], number>>
type RecipeMatch = { recipe: RecipeSummary; label: string }
type Message = { id: number; role: 'user' | 'assistant'; text: string | null; draft?: MoriDraft; reviewKey?: number; matches?: RecipeMatch[] }

function markScrollEdges(element: HTMLElement) {
  element.toggleAttribute('data-overflow-before', element.scrollTop > 2)
  element.toggleAttribute('data-overflow-after', element.scrollTop + element.clientHeight < element.scrollHeight - 2)
}

function DraftCard({ draft, onReview, disabled, consumed }: { draft: MoriDraft; onReview: (draft: MoriDraft, anchor: HTMLButtonElement) => void; disabled: boolean; consumed: boolean }) {
  if (draft.kind === 'suggest') {
    const { recipe } = draft.handoff.response
    const remaining = recipe.ingredients.length - 3
    return <div className="mori-chat-recipe">
      <h3>{recipe.title}</h3>
      <span>{consumed ? 'Saved to your journal' : 'Unsaved draft'}</span>
      <ul role="list" aria-label="Draft ingredients">
        {recipe.ingredients.slice(0, 3).map((ingredient, index) => <li key={index}>
          <IngredientEmoji name={ingredient.name} />
          {ingredient.name}
        </li>)}
        {remaining > 0 && <li>{remaining} more</li>}
      </ul>
      <button type="button" disabled={disabled || consumed} onClick={(event) => onReview(draft, event.currentTarget)}>{consumed ? 'Saved' : 'Review recipe'}</button>
    </div>
  }
  const recipe: ExtractedRecipe = draft.handoff.recipe
  const ingredients = recipe.ingredients.slice(0, 3)
  const instructions = recipe.instructions.slice(0, 2)
  return <div className="mori-chat-preview">
    <strong>{recipe.title}</strong>
    <span>{consumed ? 'Saved to your journal' : 'Unsaved draft'}</span>
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
    <button type="button" disabled={disabled || consumed} onClick={(event) => onReview(draft, event.currentTarget)}>{consumed ? 'Saved' : 'Review draft'}</button>
  </div>
}

type PlayNavigationMotion = (anchor: () => HTMLElement | null, signal: AbortSignal) => Promise<void | boolean>

export function MoriChatPanel({ userId, playNavigationTap, playNavigationTravel, traveling = false }: {
  userId: string
  playNavigationTap?: PlayNavigationMotion
  playNavigationTravel?: PlayNavigationMotion
  traveling?: boolean
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const dialogue = useJournalMedia('(min-width: 1100px) and (min-height: 640px) and (hover: hover) and (pointer: fine)')
  const currentLocationKey = useRef(location.key)
  useLayoutEffect(() => { currentLocationKey.current = location.key }, [location.key])
  const { discovery } = useContext(RecipeSourceContext)
  const confirmation = useNavigationConfirmation()
  const navigationRequest = useRef<AbortController | null>(null)
  const arrival = useRef<{ path: string; message: string } | null>(null)
  const [navigating, setNavigating] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const hasMessages = messages.length > 0
  const [historyOverflow, setHistoryOverflow] = useState(false)
  const [readingHistory, setReadingHistory] = useState(false)
  const [mode, setMode] = useState<'create' | 'suggest' | null>(null)
  const [composer, setComposer] = useState('')
  const [pendingTask, setPendingTask] = useState<'recipe' | 'search' | null>(null)
  const pending = pendingTask !== null
  const [followUp, setFollowUp] = useState<{ notes: string } | null>(null)
  const [retryRequest, setRetryRequest] = useState<MoriRetry | null>(null)
  const [cooldowns, setCooldowns] = useState<MoriCooldowns>({})
  const [now, setNow] = useState(() => Date.now())
  const id = useRef(1)
  const reviewSequence = useRef(0)
  const reviewKeys = useRef(new Map<string, number>())
  const requestId = useRef(0)
  const request = useRef<{ id: number; controller: AbortController; timeout: number } | null>(null)
  const log = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)
  const composerId = useId()
  const { completedReviewKeys } = useMoriReviewCompletion()
  const [promptSelection, setPromptSelection] = useState(0)
  const selectedPromptCaret = useRef<number | null>(null)
  useLayoutEffect(() => {
    const caret = selectedPromptCaret.current
    const input = document.getElementById(composerId)
    if (caret !== null && input instanceof HTMLTextAreaElement) {
      input.focus()
      input.setSelectionRange(caret, caret)
      selectedPromptCaret.current = null
    }
  }, [composer, composerId, promptSelection])
  useMoriActivity(pending ? { kind: 'working', message: pendingTask === 'search' ? 'I’m looking through your saved recipes…' : 'I’m putting your recipe together…' } : null)

  useEffect(() => {
    const deadlines = Object.values(cooldowns).filter((until): until is number => until !== undefined && until > now)
    if (!deadlines.length) return
    const nextDeadline = Math.min(...deadlines)
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(1000, nextDeadline - now))
    return () => window.clearTimeout(timer)
  }, [cooldowns, now])

  function retryWaitFor(kind: MoriRetry['kind']) {
    const until = cooldowns[kind]
    return until === undefined ? 0 : Math.max(0, Math.ceil((until - now) / 1000))
  }

  function say(role: Message['role'], text: Message['text'], content?: MoriDraft | { kind: 'matches'; matches: RecipeMatch[] }) {
    const draft = content?.kind === 'matches' ? undefined : content
    const reviewKey = draft ? reviewKeyFor(draft) : undefined
    const message: Message = { id: id.current++, role, text, ...(draft ? { draft, reviewKey } : {}),
      ...(content?.kind === 'matches' ? { matches: content.matches } : {}),
    }
    setMessages((current) => [...current, message])
    return message.id
  }

  function reviewKeyFor(draft: MoriDraft) {
    const identity = draft.kind === 'create'
      ? JSON.stringify(['create', draft.handoff])
      : JSON.stringify(['suggest', draft.handoff.request, draft.handoff.response])
    let key = reviewKeys.current.get(identity)
    if (key === undefined || completedReviewKeys.has(key)) {
      key = ++reviewSequence.current
      reviewKeys.current.set(identity, key)
    }
    return key
  }

  useEffect(() => { if (log.current && followLatest.current) log.current.scrollTop = log.current.scrollHeight }, [messages])
  useLayoutEffect(() => {
    if (!dialogue || !log.current || typeof ResizeObserver === 'undefined') return
    const element = log.current
    const measure = () => {
      setHistoryOverflow(element.scrollHeight > element.clientHeight + 2)
      if (followLatest.current) element.scrollTop = element.scrollHeight
      markScrollEdges(element)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [dialogue, messages])
  useEffect(() => () => {
    const active = request.current
    if (active) { request.current = null; requestId.current++; window.clearTimeout(active.timeout); active.controller.abort() }
  }, [])

  function startCooldown(kind: MoriRetry['kind'], error: unknown) {
    if (!(error instanceof HttpError) || error.status !== 429) return
    const seconds = retryAfterSeconds(error.retryAfter)
    if (seconds === undefined || seconds <= 0) return
    const until = Date.now() + seconds * 1000
    setCooldowns((current) => ({ ...current, [kind]: Math.max(current[kind] ?? 0, until) }))
    setNow(Date.now())
  }

  function waitForCooldown(kind: MoriRetry['kind']) {
    const until = cooldowns[kind]
    if (until === undefined) return false
    const seconds = Math.max(0, Math.ceil((until - Date.now()) / 1000))
    if (seconds === 0) return false
    say('assistant', `Mori is temporarily rate-limited for ${kind === 'create' ? 'cooking notes' : 'pantry ideas'}. Wait at least ${seconds} ${seconds === 1 ? 'second' : 'seconds'} before trying again.`)
    return true
  }

  async function ask<T>(
    action: (signal: AbortSignal) => Promise<T>,
    onSuccess: (value: T) => void,
    onError: (error: unknown, timedOut: boolean) => string,
    timeoutMs: number,
    task: NonNullable<typeof pendingTask> = 'recipe',
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
      setPendingTask(null)
      say('assistant', onError(new Error('timeout'), true))
    }, timeoutMs)
    request.current = { id: currentId, controller, timeout }
    setPendingTask(task)
    try {
      const result = await action(controller.signal)
      if (!controller.signal.aborted && requestId.current === currentId) onSuccess(result)
    } catch (error) {
      if (requestId.current === currentId && (!controller.signal.aborted || timedOut)) say('assistant', onError(error, timedOut))
    } finally {
      window.clearTimeout(timeout)
      if (request.current?.id === currentId) {
        request.current = null
        setPendingTask(null)
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
    setPendingTask(null)
    setRetryRequest(null)
    say('assistant', 'I stopped that request. Nothing was saved; your chat is still here if you want to try again.')
  }

  useLayoutEffect(() => () => {
    navigationRequest.current?.abort()
    navigationRequest.current = null
  }, [location.key])

  useEffect(() => {
    setNavigating(false)
    const destination = arrival.current
    arrival.current = null
    if (destination?.path === location.pathname) {
      const message: Message = { id: id.current++, role: 'assistant', text: destination.message }
      setMessages((current) => [...current, message])
    }
  }, [location.key, location.pathname])

  function navigateWithMori({ path, message, anchor, options, arrivalMessage, prepare, journalTab }: {
    path: string
    message: string
    anchor?: HTMLButtonElement
    options?: NavigateOptions
    arrivalMessage?: string
    prepare?: () => boolean
    journalTab?: string
  }) {
    if (navigationRequest.current) return
    const controller = new AbortController()
    navigationRequest.current = controller
    const cancel = (restoreFocus = true) => {
      controller.abort()
      if (navigationRequest.current !== controller) return
      navigationRequest.current = null
      setNavigating(false)
      if (restoreFocus) window.requestAnimationFrame(() => {
        if (!navigationRequest.current) (anchor ?? document.getElementById(composerId))?.focus()
      })
    }
    const proceed = (allowNavigation: (action: () => void) => void) => {
      const acknowledgment = say('assistant', message)
      const finish = () => {
        if (controller.signal.aborted) return
        navigationRequest.current = null
        setNavigating(false)
        if (prepare && !prepare()) return
        if (arrivalMessage) arrival.current = { path, message: arrivalMessage }
        allowNavigation(() => { void navigate(path, options) })
      }
      const playNavigation = journalTab ? playNavigationTravel : playNavigationTap
      if (playNavigation && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        const active = document.activeElement
        if (active === document.body || log.current?.parentElement?.contains(active)) {
          log.current?.focus({ preventScroll: true })
        }
        setNavigating(true)
        const findAnchor = () => journalTab
          ? Array.from(document.querySelectorAll<HTMLAnchorElement>('.mm-journal-book > .mm-journal-spread .mm-bookmarks--journal a'))
            .find((link) => link.pathname === journalTab) ?? null
          : anchor ?? log.current?.querySelector<HTMLElement>(`[data-message-id="${acknowledgment}"]`) ?? null
        if (journalTab) {
          void playNavigation(findAnchor, controller.signal)
          finish()
        } else {
          void playNavigation(findAnchor, controller.signal).then((continueNavigation) => {
            if (continueNavigation === false) cancel(false)
            else finish()
          }, finish)
        }
      } else {
        finish()
      }
    }
    if (confirmation?.current?.(path, proceed, cancel)) {
      setNavigating(true)
      return
    }
    proceed((action) => action())
  }

  function openRoute(path: string, message: string, { focus, anchor, shortcut }: {
    focus?: 'notes' | 'pantry'
    anchor?: HTMLButtonElement
    shortcut?: boolean
  } = {}) {
    if (shortcut && traveling) return
    const journalTab = shortcut ? path : undefined
    const prepare = () => {
      setMode(null)
      setFollowUp(null)
      setRetryRequest(null)
      return true
    }
    if (path === '/app/chef' && focus === 'pantry' && readChefDraftResult(userId).draft.handoff) {
      const reviewKey = location.pathname === '/app/chef/review' && typeof location.state === 'object' && location.state !== null &&
        'moriReviewKey' in location.state && typeof location.state.moriReviewKey === 'number'
        ? location.state.moriReviewKey
        : undefined
      navigateWithMori({
        path: '/app/chef/review',
        message: 'You already have a pantry idea waiting in review. I’ll take you there.',
        anchor,
        prepare,
        journalTab,
        options: { replace: location.pathname === '/app/chef/review', state: { moriKeepOpen: true, ...(reviewKey === undefined ? {} : { moriReviewKey: reviewKey }) } },
      })
      return
    }
    navigateWithMori({ path, message, anchor, prepare, journalTab, options: { state: { moriKeepOpen: true, ...(focus ? { moriFocus: focus } : {}) } } })
  }

  async function createRecipe(notes: string) {
    if (waitForCooldown('create')) return
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
        if (!mapExtractedRecipeToDraft(recipe)) {
          setFollowUp({ notes })
          say('assistant', 'This recipe does not fit the editor yet. Your original cooking notes are still here; tell me what to correct, such as a shorter recipe title, and I’ll try again.')
          return
        }
        setFollowUp(null)
        say('assistant', `Here’s an editable draft of “${recipe.title}”. Review it before saving.`, {
          kind: 'create', handoff: { sourceNotes: notes, recipe, saved: false },
        })
      },
      (error, timedOut) => {
        startCooldown('create', error)
        setFollowUp({ notes })
        setRetryRequest({ kind: 'create', notes })
        if (timedOut) return 'Mori took too long to organize those notes. They’re still in this chat; please try again.'
        if (error instanceof HttpError && error.status === 429) {
          const code = httpErrorCode(error)
          const reason = aiRateLimitReason(code) ?? (code === 'QUOTA_EXCEEDED'
            ? 'You’ve reached today’s AI limit.'
            : 'Mori is temporarily busy.')
          return `${reason} ${retryAfterMessage(error.retryAfter)}`
        }
        return error instanceof InvalidExtractionResponse
          ? 'I could not check that draft safely. Send any missing details or rephrase the cooking notes and I’ll try again.'
          : 'Mori could not organize those notes right now. Add any missing details or send a new version to try again.'
      },
      120_000,
    )
  }

  async function suggestRecipe(prompt: string) {
    if (waitForCooldown('suggest')) return
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
        if (!mapExtractedRecipeToDraft(response.recipe)) {
          setComposer(prompt)
          say('assistant', 'This idea does not fit the recipe editor yet. Your pantry request is back in the message box so you can adjust it and try again.')
          return
        }
        say('assistant', null, {
          kind: 'suggest', handoff: {
            request: parsed.data,
            response,
            selectedParentIds: [],
            saved: false,
          },
        })
      },
      (error, timedOut) => {
        startCooldown('suggest', error)
        setRetryRequest({ kind: 'suggest', prompt })
        return generateRecipeErrorMessage(error, timedOut)
      },
      45_000,
    )
  }

  function openRecipe(recipe: RecipeSummary, anchor?: HTMLButtonElement) {
    openRoute(`/app/recipes/${encodeURIComponent(recipe.id)}`, `I’ll open “${recipe.title}”.`, { anchor })
  }

  async function findRecipe(title: string) {
    await ask(
      (signal) => findSavedRecipesByTitle(discovery, { title, userId, signal }),
      (recipes) => {
        const exactMatches = recipes.filter((recipe) => recipe.title.trim().toLowerCase() === title.toLowerCase())
        const [exactMatch, duplicate] = exactMatches
        if (exactMatch && !duplicate && currentLocationKey.current === location.key) {
          openRecipe(exactMatch)
        } else if (recipes.length) {
          const choices = exactMatches.length ? exactMatches : recipes
          const titleCounts = new Map<string, number>()
          for (const recipe of choices) {
            const key = recipe.title.trim().toLowerCase()
            titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1)
          }
          const matches = choices.map((recipe, index) => {
            const duplicateTitle = (titleCounts.get(recipe.title.trim().toLowerCase()) ?? 0) > 1
            const date = recipe.cooked_at ? formatCookedDate(recipe.cooked_at) : null
            const label = [recipe.title, duplicateTitle && `match ${index + 1}`, date].filter(Boolean).join(' · ')
            return { recipe, label }
          })
          say('assistant', `Here’s what I found for “${title}”.`, { kind: 'matches', matches })
        } else {
          say('assistant', `I couldn’t find a saved recipe matching “${title}”.`)
        }
      },
      () => 'I couldn’t search your saved recipes. Try again in a moment.',
      15_000,
      'search',
    )
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || navigationRequest.current) return
    const text = composer.trim()
    if (!text) return
    followLatest.current = true
    setReadingHistory(false)

    const title = requestedRecipeTitle(text)
    if (title) {
      setComposer('')
      setRetryRequest(null)
      say('user', text)
      await findRecipe(title)
      return
    }

    const review = requestedReview(text)
    if (review) {
      setComposer('')
      setRetryRequest(null)
      say('user', text)
      const available = new Map<number, MoriDraft>()
      const aliases = new Map<number, MoriDraft>()
      for (const { draft, reviewKey } of messages) {
        if (!draft || reviewKey === undefined || completedReviewKeys.has(reviewKey)) continue
        const recipe = draft.kind === 'create' ? draft.handoff.recipe : draft.handoff.response.recipe
        const title = recipe.title.trim().toLowerCase()
        if (review === 'any' || review === draft.kind || (typeof review === 'object' && title === review.title)) {
          available.set(reviewKey, draft)
        } else if (typeof review === 'object' && title === review.alias) {
          aliases.set(reviewKey, draft)
        }
      }
      const matching = available.size ? available : aliases
      const choice = matching.entries().next().value
      if (!choice) say('assistant', 'There’s no matching draft in this chat to review yet.')
      else if (matching.size > 1) say('assistant', 'Which draft would you like to review? Choose its review button below the recipe preview.')
      else openReview(choice[1], choice[0])
      return
    }

    const navigation = requestedNavigation(text)
    if (navigation) {
      setComposer('')
      setRetryRequest(null)
      say('user', text)
      openRoute(navigation.path, navigation.message, { focus: navigation.focus })
      return
    }

    const explicitWorkflow = requestedWorkflow(text, mode === 'create' && followUp !== null)
    const selected = explicitWorkflow ?? mode
    if (selected && waitForCooldown(selected)) return

    setComposer('')
    setRetryRequest(null)
    say('user', text)
    if (!selected) {
      say('assistant', 'I can help make a recipe from cooking notes, suggest something from your pantry, or find a saved recipe. Try “find my adobo” or pick an action below.')
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

  function openReview(draft: MoriDraft, reviewKey: number, anchor?: HTMLButtonElement) {
    if (navigationRequest.current || completedReviewKeys.has(reviewKey)) return
    function prepareReview(draft: MoriDraft, write: boolean) {
      if (draft.kind === 'create') {
        const current = readQuickAiEntryDraftResult(userId)
        const sameHandoff = current.draft.handoff && JSON.stringify(current.draft.handoff) === JSON.stringify(draft.handoff)
        const hasContent = (current.draft.notes.length > 0 && current.draft.completedReview !== true) || current.draft.handoff !== null || current.draft.reviewDraft != null || current.draft.blockedUntil !== null
        if (current.status === 'read-failed' || (hasContent && !sameHandoff)) {
          say('assistant', 'There’s already a Quick AI Entry draft in progress, so I left it untouched. Open Cooking Notes to review it first.')
          return false
        }
        if (write && !sameHandoff) writeQuickAiEntryDraft(userId, { notes: draft.handoff.sourceNotes, blockedUntil: null, blockedReason: null, handoff: draft.handoff })
        return true
      }

      const current = readChefDraftResult(userId)
      const sameSuggestion = current.draft.handoff &&
        JSON.stringify(current.draft.handoff.request) === JSON.stringify(draft.handoff.request) &&
        JSON.stringify(current.draft.handoff.response) === JSON.stringify(draft.handoff.response)
      const hasContent = current.draft.handoff !== null || (current.draft.completedReview !== true && (current.draft.input.pantryItems.length > 0 || current.draft.input.pantryInput.length > 0 || current.draft.input.preferences.length > 0))
      if (current.status === 'read-failed' || (hasContent && !sameSuggestion)) {
        say('assistant', 'There’s already an AI Chef draft in progress, so I left it untouched. Open the pantry page to review it first.')
        return false
      }
      if (!('pantryItems' in draft.handoff.request)) return false
      if (write && !sameSuggestion) writeChefDraft(userId, {
        input: { pantryItems: draft.handoff.request.pantryItems, pantryInput: '', preferences: draft.handoff.request.preferences ?? '' },
        handoff: draft.handoff,
        completedReview: false,
      })
      return true
    }

    if (!prepareReview(draft, false)) return
    const isNotes = draft.kind === 'create'
    const path = isNotes ? '/app/quick-entry/review' : '/app/chef/review'
    navigateWithMori({
      path,
      message: isNotes ? 'I’ll open the draft for review.' : 'I’ll open the pantry idea for review.',
      arrivalMessage: `Your unsaved ${isNotes ? 'draft' : 'idea'} is ready in review. Nothing will be saved to your journal until you confirm there.`,
      anchor,
      prepare: () => prepareReview(draft, true),
      options: {
        replace: location.pathname === path,
        state: {
          moriKeepOpen: true,
          moriReviewKey: reviewKey,
          ...(isNotes ? { sourceJournalReturn: '/app/recipes' } : { chefGenerationSucceeded: true }),
        },
      },
    })
  }

  function submitOnShortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) event.currentTarget.form?.requestSubmit()
  }

  const example = mode === 'create'
    ? 'Example: “Tomato rice, rice, tomatoes and broth. Simmer until tender.”'
    : mode === 'suggest'
      ? 'Example: “rice, eggs; quick and spicy”'
      : ''

  const shortcuts = <nav className="mori-chat-shortcuts" aria-label="Open a journal page">
    <button type="button" disabled={pending || navigating || traveling} onClick={(event) => openRoute('/app/recipes', 'Opening your recipe collection.', { anchor: event.currentTarget, shortcut: true })}><BookOpen size={16} aria-hidden="true" /><span className="mori-chat-shortcut-label">Open recipes</span></button>
    <button type="button" disabled={pending || navigating || traveling} onClick={(event) => openRoute('/app/recipes/new', 'Opening a new recipe.', { anchor: event.currentTarget, shortcut: true })}><NotebookPen size={16} aria-hidden="true" /><span className="mori-chat-shortcut-label">Open recipe editor</span></button>
    <button type="button" disabled={pending || navigating || traveling} onClick={(event) => openRoute('/app/quick-entry', 'Opening your cooking notes.', { focus: 'notes', anchor: event.currentTarget, shortcut: true })}><ChefHat size={16} aria-hidden="true" /><span className="mori-chat-shortcut-label">Open cooking notes</span></button>
    <button type="button" disabled={pending || navigating || traveling} onClick={(event) => openRoute('/app/chef', 'Opening the pantry field.', { focus: 'pantry', anchor: event.currentTarget, shortcut: true })}><CookingPot size={16} aria-hidden="true" /><span className="mori-chat-shortcut-label">Open pantry</span></button>
  </nav>

  const context = suggestionContext(location.pathname)
  const suggestions = <SuggestedPrompts navigation={dialogue ? shortcuts : undefined} context={context} busy={pending || navigating} draft={composer} preview={dialogue && context !== 'collection' && !hasMessages && !composer} onSelect={prompt => {
        setMode(prompt.workflow)
        setFollowUp(null)
        setRetryRequest(null)
        setPromptSelection(value => value + 1)
        selectedPromptCaret.current = promptCaret(prompt.message)
        setComposer(prompt.message)
      }} />
  const greeting = { collection: 'Shall we find a recipe or write one down?', reading: 'What would you change next time?', writing: 'Let’s put your recipe on paper.', notes: 'Shall we make a recipe from your notes?', pantry: 'What shall we cook with your pantry?', general: 'How can I help?' }[context]
  return <div className="mori-chat" data-empty={!hasMessages} data-dialogue-state={hasMessages ? 'conversation' : 'engaged'}>
    <div className="mori-chat-conversation">
      <p className="mori-chat-task">{dialogue && !pending && hasMessages ? retryRequest ? 'Your request is still here.' : 'Let’s keep cooking.' : mode === 'create' ? 'Creating a recipe' : mode === 'suggest' ? 'Finding a cooking idea' : dialogue ? greeting : 'How can I help?'}</p>
      {dialogue && historyOverflow && <button className="mori-chat-history" type="button" onClick={() => {
        followLatest.current = readingHistory
        log.current?.scrollTo({ top: readingHistory ? log.current.scrollHeight : 0 })
        log.current?.focus()
      }}>{readingHistory ? 'Latest reply' : 'Earlier conversation'}</button>}
      <div ref={log} className="mori-chat-log" role="log" tabIndex={messages.length ? 0 : -1} aria-label="Chat with Mori" aria-busy={pending} aria-relevant="additions" onScroll={(event) => {
        const element = event.currentTarget
        followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 32
        if (dialogue) setReadingHistory(!followLatest.current)
        if (dialogue) markScrollEdges(element)
      }}>
        {messages.map((message) => {
          const reviewKey = message.reviewKey
          return <article key={message.id} className="mori-chat-message" data-role={message.role} data-message-id={message.id} aria-label={message.role === 'user' ? 'You' : 'Mori'}>
            {message.text && <p>{message.text}</p>}
            {message.id === messages.at(-1)?.id && retryRequest && !pending && <div className="mori-chat-retry"><button type="button" disabled={navigating || retryWaitFor(retryRequest.kind) > 0} onClick={() => {
              const retry = retryRequest
              setRetryRequest(null)
              if (retry.kind === 'create') void createRecipe(retry.notes)
              else void suggestRecipe(retry.prompt)
            }}>Retry same request</button></div>}
            {message.matches && <div className="mori-chat-preview" role="group" aria-label="Matching saved recipes">
              {message.matches.map(({ recipe, label }) =>
                <button key={recipe.id} type="button" disabled={pending || navigating} onClick={(event) => openRecipe(recipe, event.currentTarget)}>{label}</button>
              )}
            </div>}
            {message.draft && reviewKey !== undefined && <DraftCard draft={message.draft} disabled={pending || navigating} consumed={completedReviewKeys.has(reviewKey)} onReview={(draft, anchor) => openReview(draft, reviewKey, anchor)} />}
          </article>
        })}
        {(['create', 'suggest'] as const).map((kind) => {
          const seconds = retryWaitFor(kind)
          return seconds > 0 && <p key={kind} role="timer" aria-live="off">Wait at least {seconds} {seconds === 1 ? 'second' : 'seconds'} before Mori can retry {kind === 'create' ? 'cooking notes' : 'pantry ideas'}.</p>
        })}
      </div>
      {pending && <div className="mori-chat-pending"><span role="status" aria-live="polite">Mori is working on your request.</span><button type="button" onClick={cancel}>Cancel</button></div>}
      {!dialogue && suggestions}
      {dialogue && <div className="mori-chat-tools">
        {context === 'collection' && !hasMessages && !composer && <div className="mori-chat-quick-prompts" role="group" aria-label="Ideas for this page">
          <button type="button" onClick={() => { setMode(null); setComposer('find my '); selectedPromptCaret.current = 8 }}><Search size={13} aria-hidden="true" />Find a saved recipe</button>
          <button type="button" onClick={() => { const message = 'Write a recipe from these cooking notes: '; setMode('create'); setComposer(message); selectedPromptCaret.current = message.length }}><NotebookPen size={13} aria-hidden="true" />Write cooking notes</button>
        </div>}
        {suggestions}</div>}
      {example && (!dialogue || !hasMessages) && <p id={`${composerId}-example`} className="mori-chat-example">{example}</p>}
      <form className="mori-chat-composer" onSubmit={(event) => { void submit(event) }}>
        <label className="mori-chat-label" htmlFor={composerId}>Message Mori</label>
        <textarea id={composerId} rows={2} value={composer} disabled={pending || navigating} aria-describedby={example && (!dialogue || !hasMessages) ? `${composerId}-example` : undefined} placeholder={mode === 'create' ? 'What did you cook, and how?' : mode === 'suggest' ? 'What ingredients do you have?' : 'Tell Mori what you need…'} onChange={(event) => setComposer(event.currentTarget.value)} onKeyDown={submitOnShortcut} />
        <button type="submit" disabled={pending || navigating || !composer.trim()}>Send</button>
      </form>
      {!dialogue && shortcuts}
      <p className="mori-chat-hint">Enter a new line; press Ctrl/⌘ + Enter to send.</p>
    </div>
  </div>
}
