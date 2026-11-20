import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { HttpError } from '../api/http'
import { readChefDraftResult, writeChefDraft } from '../ai-chef/draft'
import type { GenerateRecipeResponse } from '../ai-chef/generateRecipe'
import { generateRecipeApi } from '../ai-chef/generateRecipe'
import { readQuickAiEntryDraftResult, writeQuickAiEntryDraft } from '../quick-ai/draft'
import type { ExtractedRecipe } from '../quick-ai/extractRecipe'
import { extractRecipeApi, MAX_EXTRACTION_INPUT_CHARS } from '../quick-ai/extractRecipe'
import { MoriCompanion } from './MoriCompanion'
import { MoriCompanionProvider, useMoriReviewCompletion } from './MoriCompanionContext'
import { MoriChatPanel } from './MoriChatPanel'

function Location() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}|{JSON.stringify(location.state)}</output>
}

function ConfirmSavedHandoff({ userId }: { userId: string }) {
  const location = useLocation()
  const { markReviewCompleted } = useMoriReviewCompletion()
  if (location.pathname !== '/app/quick-entry/review' && location.pathname !== '/app/chef/review') return null
  const reviewKey = typeof location.state === 'object' && location.state !== null &&
    'moriReviewKey' in location.state && typeof location.state.moriReviewKey === 'number'
    ? location.state.moriReviewKey
    : undefined
  return <button type="button" onClick={() => {
    if (location.pathname === '/app/quick-entry/review') {
      const current = readQuickAiEntryDraftResult(userId).draft
      writeQuickAiEntryDraft(userId, { ...current, handoff: null, reviewDraft: null, completedReview: true })
    } else {
      writeChefDraft(userId, { ...readChefDraftResult(userId).draft, handoff: null, completedReview: true })
    }
    if (reviewKey !== undefined) markReviewCompleted(reviewKey)
  }}>Confirm save</button>
}

function renderChat(userId: string) {
  return render(<MemoryRouter initialEntries={['/app/recipes']}><MoriChatPanel userId={userId} /><Location /></MemoryRouter>)
}

function renderIntegratedChat(userId: string) {
  return render(<MemoryRouter initialEntries={['/app/recipes']}><MoriCompanionProvider>
    <MoriChatPanel userId={userId} /><ConfirmSavedHandoff userId={userId} /><Location />
  </MoriCompanionProvider></MemoryRouter>)
}

function choosePrompt(label: 'Record a recipe' | 'Use my ingredients') {
  fireEvent.click(screen.getByRole('button', { name: 'See more' }))
  fireEvent.click(screen.getByRole('button', { name: label }))
}

function send(text: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Mori' }), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

function recipe(title = 'Tomato soup', ingredients = ['tomatoes'], instructions = ['Simmer the tomatoes.']): ExtractedRecipe {
  return {
    title,
    ingredients: ingredients.map((name) => ({ name, quantity: null, unit: null, inferred: false })),
    instructions: instructions.map((text, index) => ({ step: index + 1, text })),
  }
}

function suggestion(): GenerateRecipeResponse {
  return {
    recipe: recipe('Pantry rice bowl', ['rice', 'eggs'], ['Cook the rice.', 'Top with eggs.']),
    substitutions: [],
    parents: [{ id: '123e4567-e89b-42d3-a456-426614174000', title: 'Saved egg rice', star_rating: 4 }],
    candidate_token: 'opaque-candidate-token',
    context: { status: 'MATCHED', matchedCandidateCount: 1, totalCandidateCount: 1 },
  }
}

afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks() })

it('asks only for missing recipe fields and opens an unsaved editable review', async () => {
  const userId = 'mori-chat-create'
  const extract = vi.spyOn(extractRecipeApi, 'extract')
    .mockResolvedValueOnce(recipe('Tomato soup', [], []))
    .mockResolvedValueOnce(recipe())
  renderChat(userId)

  choosePrompt('Record a recipe')
  send('I simmered tomatoes for soup.')
  await screen.findByText('I’m only missing the ingredients and the cooking steps. What should I add?')
  expect(screen.queryByText(/recipe name/)).toBeNull()
  expect(readQuickAiEntryDraftResult(userId).draft.handoff).toBeNull()

  send('I have tomatoes and broth; simmer until soft.')
  await screen.findByRole('button', { name: 'Review draft' })
  expect(extract).toHaveBeenCalledTimes(2)
  expect(extract.mock.calls[1]?.[0]).toBe('I simmered tomatoes for soup.\n\nAdditional details: I have tomatoes and broth; simmer until soft.')
  expect(readQuickAiEntryDraftResult(userId).draft.handoff).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Review draft' }))
  await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('/app/quick-entry/review'))
  expect(readQuickAiEntryDraftResult(userId).draft.handoff).toMatchObject({ recipe: { title: 'Tomato soup' }, saved: false })
  const reviewDraft = { title: 'My edited soup', ingredients: [], instructions: [], rating: '', cookedDate: '', notes: '' }
  writeQuickAiEntryDraft(userId, { ...readQuickAiEntryDraftResult(userId).draft, reviewDraft })
  fireEvent.click(screen.getByRole('button', { name: 'Review draft' }))
  expect(screen.getByTestId('location').textContent).toContain('"moriReviewKey":1')
  expect(screen.getAllByText('Your unsaved draft is ready in review. Nothing will be saved to your journal until you confirm there.')).toHaveLength(2)
  expect(screen.queryByText(/already a Quick AI Entry draft in progress/)).toBeNull()
  expect(readQuickAiEntryDraftResult(userId).draft.reviewDraft).toEqual(reviewDraft)
})

it('preserves a pending Quick AI draft instead of replacing it', async () => {
  const userId = 'mori-chat-conflict'
  const existing = { notes: 'Existing notes', blockedUntil: null, blockedReason: null, handoff: null }
  writeQuickAiEntryDraft(userId, existing)
  vi.spyOn(extractRecipeApi, 'extract').mockResolvedValue(recipe())
  renderChat(userId)

  choosePrompt('Record a recipe')
  send('Tomatoes, broth, simmer until soft.')
  await screen.findByRole('button', { name: 'Review draft' })
  fireEvent.click(screen.getByRole('button', { name: 'Review draft' }))

  await screen.findByText(/already a Quick AI Entry draft in progress/)
  expect(screen.getByTestId('location').textContent).toContain('/app/recipes')
  expect(readQuickAiEntryDraftResult(userId).draft).toEqual(existing)
})

it('retrieves a pantry suggestion and keeps its saved-recipe lineage in the review handoff', async () => {
  const userId = 'mori-chat-suggest'
  const generate = vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(suggestion())
  renderChat(userId)

  choosePrompt('Use my ingredients')
  send('What can I cook with rice and eggs; quick and spicy')
  await screen.findByRole('button', { name: 'Review recipe' })
  expect(screen.getByRole('heading', { name: 'Pantry rice bowl' })).toBeTruthy()
  expect(screen.getByText('Unsaved draft')).toBeTruthy()
  expect(screen.queryByText('Cook the rice.')).toBeNull()
  expect(screen.queryByText('Saved egg rice', { exact: false })).toBeNull()
  expect(generate).toHaveBeenCalledWith(['rice', 'eggs'], 'quick and spicy', expect.objectContaining({ userId }))
  expect(readChefDraftResult(userId).draft.handoff).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Review recipe' }))
  await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('/app/chef/review'))
  expect(readChefDraftResult(userId).draft.handoff).toMatchObject({
    saved: false,
    response: { candidate_token: 'opaque-candidate-token', parents: [{ title: 'Saved egg rice' }], context: { status: 'MATCHED' } },
  })
  expect(screen.getByTestId('location').textContent).toContain('"moriReviewKey":1')
})

it('keeps the active Quick AI review key for an equivalent handoff', async () => {
  const notes = 'Tomato soup with tomatoes and broth; simmer until tender.'
  vi.spyOn(extractRecipeApi, 'extract')
    .mockResolvedValueOnce(recipe())
    .mockResolvedValueOnce(recipe())
  renderChat('mori-chat-equivalent-quick-review')

  choosePrompt('Record a recipe')
  send(notes)
  await screen.findByRole('button', { name: 'Review draft' })
  fireEvent.click(screen.getByRole('button', { name: 'Review draft' }))
  await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('/app/quick-entry/review'))
  expect(screen.getByTestId('location').textContent).toContain('"moriReviewKey":1')

  send(notes)
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Review draft' })).toHaveLength(2))
  fireEvent.click(screen.getAllByRole('button', { name: 'Review draft' })[1]!)

  expect(await screen.findAllByText('Your unsaved draft is ready in review. Nothing will be saved to your journal until you confirm there.')).toHaveLength(2)
  expect(screen.getByTestId('location').textContent).toContain('"moriReviewKey":1')
})

it('keeps the active AI Chef review key for an equivalent suggestion', async () => {
  const prompt = 'What can I cook with rice and eggs; quick and spicy?'
  vi.spyOn(generateRecipeApi, 'generate')
    .mockResolvedValueOnce(suggestion())
    .mockResolvedValueOnce(suggestion())
  renderChat('mori-chat-equivalent-chef-review')

  send(prompt)
  await screen.findByRole('button', { name: 'Review recipe' })
  fireEvent.click(screen.getByRole('button', { name: 'Review recipe' }))
  await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('/app/chef/review'))
  expect(screen.getByTestId('location').textContent).toContain('"moriReviewKey":1')

  send(prompt)
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Review recipe' })).toHaveLength(2))
  fireEvent.click(screen.getAllByRole('button', { name: 'Review recipe' })[1]!)

  await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('"moriReviewKey":1'))
  expect(screen.getAllByText('Unsaved draft')).toHaveLength(2)
})

it('consumes equivalent Quick AI chat cards together after a confirmed save', async () => {
  const notes = 'Tomato soup with tomatoes and broth; simmer until tender.'
  const userId = 'mori-chat-consumed-quick'
  vi.spyOn(extractRecipeApi, 'extract').mockResolvedValue(recipe())
  renderIntegratedChat(userId)

  choosePrompt('Record a recipe')
  send(notes)
  await screen.findByRole('button', { name: 'Review draft' })
  send(notes)
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Review draft' })).toHaveLength(2))
  fireEvent.click(screen.getAllByRole('button', { name: 'Review draft' })[1]!)
  expect(screen.getByTestId('location').textContent).toContain('"moriReviewKey":1')
  fireEvent.click(screen.getByRole('button', { name: 'Confirm save' }))

  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Saved' })).toHaveLength(2))
  expect(screen.getAllByRole('button', { name: 'Saved' }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
})

it('consumes equivalent Chef chat cards together after a confirmed save', async () => {
  const prompt = 'What can I cook with rice and eggs; quick and spicy?'
  const userId = 'mori-chat-consumed-chef'
  vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(suggestion())
  renderIntegratedChat(userId)

  send(prompt)
  await screen.findByRole('button', { name: 'Review recipe' })
  send(prompt)
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Review recipe' })).toHaveLength(2))
  fireEvent.click(screen.getAllByRole('button', { name: 'Review recipe' })[1]!)
  expect(screen.getByTestId('location').textContent).toContain('"moriReviewKey":1')
  fireEvent.click(screen.getByRole('button', { name: 'Confirm save' }))

  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Saved' })).toHaveLength(2))
  expect(screen.getAllByRole('button', { name: 'Saved' }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
})

it('switches workflows when a later message clearly asks for the other recipe task', async () => {
  const extract = vi.spyOn(extractRecipeApi, 'extract').mockResolvedValue(recipe('Tomato soup'))
  const generate = vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(suggestion())
  renderChat('mori-chat-workflow-switch')

  send('I have rice and eggs')
  await screen.findByRole('button', { name: 'Review recipe' })
  send('I cooked tomato soup with tomatoes and broth. Simmer it.')
  await waitFor(() => expect(extract).toHaveBeenCalledOnce())
  expect(extract.mock.calls[0]?.[0]).toBe('I cooked tomato soup with tomatoes and broth. Simmer it.')

  send('What can I cook with beans?; quick')
  await waitFor(() => expect(generate).toHaveBeenCalledTimes(2))
  expect(generate.mock.calls[1]?.slice(0, 2)).toEqual([['beans'], 'quick'])
})

it('keeps original notes available when a follow-up would exceed the extraction limit', async () => {
  const sourceNotes = 'n'.repeat(MAX_EXTRACTION_INPUT_CHARS - 40)
  const extract = vi.spyOn(extractRecipeApi, 'extract')
    .mockResolvedValueOnce(recipe('Tomato soup', [], []))
    .mockResolvedValueOnce(recipe())
  renderChat('mori-chat-long-follow-up')

  choosePrompt('Record a recipe')
  send(sourceNotes)
  await screen.findByText('I’m only missing the ingredients and the cooking steps. What should I add?')
  send('x'.repeat(60))
  await screen.findByText(/Keep the cooking notes to/)
  expect(extract).toHaveBeenCalledOnce()

  send('x')
  await screen.findByRole('button', { name: 'Review draft' })
  expect(extract.mock.calls[1]?.[0]).toBe(`${sourceNotes}\n\nAdditional details: x`)
})

it('cancels an in-flight request and ignores a late API response', async () => {
  const userId = 'mori-chat-cancel'
  let resolveRequest!: (value: ExtractedRecipe) => void
  vi.spyOn(extractRecipeApi, 'extract').mockReturnValue(new Promise((resolve) => { resolveRequest = resolve }))
  renderChat(userId)

  choosePrompt('Record a recipe')
  send('Tomatoes and broth, simmer until soft.')
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
  await screen.findByText(/I stopped that request/)
  await act(async () => { resolveRequest(recipe()) })

  expect(screen.queryByRole('button', { name: 'Review draft' })).toBeNull()
  expect(readQuickAiEntryDraftResult(userId).draft.handoff).toBeNull()
})

it('navigates only to the requested recipe field and keeps Mori available', async () => {
  const userId = 'mori-chat-navigation'
  renderChat(userId)
  send('Show me the pantry field')
  await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('/app/chef'))
  expect(screen.getByTestId('location').textContent).toContain('"moriFocus":"pantry"')
  expect(screen.getByTestId('location').textContent).toContain('"moriKeepOpen":true')
})

it.each([
  'What can I cook?',
  'What can I make with the leftover ingredients in my pantry?',
  'Suggest a recipe using whatever’s in my fridge.',
])('asks for pantry ingredients when the request names none (%s)', async (prompt) => {
  const generate = vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(suggestion())
  renderChat('mori-chat-empty-pantry')
  send(prompt)

  await screen.findByText('Tell me at least one ingredient you have. Add optional preferences after a semicolon.')
  expect(screen.getByRole('article', { name: 'You' }).textContent).toBe(prompt)
  expect(generate).not.toHaveBeenCalled()

  send('leftover rice')
  await screen.findByRole('button', { name: 'Review recipe' })
  expect(generate).toHaveBeenCalledOnce()
  expect(generate).toHaveBeenCalledWith(['leftover rice'], '', expect.anything())
})

it('retries a failed pantry request with the exact original prompt', async () => {
  const generate = vi.spyOn(generateRecipeApi, 'generate')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(suggestion())
  renderChat('mori-chat-retry')
  choosePrompt('Use my ingredients')
  send('rice and eggs; quick and spicy')

  const retry = await screen.findByRole('button', { name: 'Retry same request' })
  expect(retry.closest('article')?.textContent).toContain('could not finish the request')
  expect(retry.closest('[role="log"]')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Retry same request' }))
  await screen.findByRole('button', { name: 'Review recipe' })
  expect(generate).toHaveBeenCalledTimes(2)
  expect(generate.mock.calls[0]?.slice(0, 2)).toEqual(generate.mock.calls[1]?.slice(0, 2))
})

it('keeps a fresh message in the composer while its workflow is cooling down', async () => {
  const extract = vi.spyOn(extractRecipeApi, 'extract').mockRejectedValue(
    new HttpError('http', 'private rate detail', 429, undefined, '60'),
  )
  renderChat('mori-chat-create-cooldown-composer')

  choosePrompt('Record a recipe')
  send('I cooked tomatoes with broth and simmered until soft.')
  await screen.findByRole('button', { name: 'Retry same request' })

  send('I also cooked beans with onions until tender.')

  expect((screen.getByRole('textbox', { name: 'Message Mori' }) as HTMLTextAreaElement).value)
    .toBe('I also cooked beans with onions until tender.')
  expect(extract).toHaveBeenCalledOnce()
  expect(screen.getByText(/rate-limited for cooking notes/)).toBeTruthy()
})

it('shows shared capacity feedback for cooking notes and waits for a manual retry', async () => {
  const extract = vi.spyOn(extractRecipeApi, 'extract').mockRejectedValue(new HttpError(
    'http', 'private rate detail', 429, { error: { code: 'AI_CAPACITY_EXCEEDED' } }, '45',
  ))
  renderChat('mori-chat-capacity')
  choosePrompt('Record a recipe')
  send('I simmered tomatoes and beans until tender.')

  expect(await screen.findByText(/shared AI capacity is full.*45 seconds/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Retry same request' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByText('I simmered tomatoes and beans until tender.')).toBeTruthy()
  expect(extract).toHaveBeenCalledOnce()
})

it('keeps Retry-After deadlines independent for cooking notes and pantry ideas', async () => {
  const extract = vi.spyOn(extractRecipeApi, 'extract').mockRejectedValue(
    new HttpError('http', 'private rate detail', 429, undefined, '60'),
  )
  const generate = vi.spyOn(generateRecipeApi, 'generate').mockRejectedValue(
    new HttpError('http', 'private rate detail', 429, undefined, '10'),
  )
  renderChat('mori-chat-independent-cooldowns')

  choosePrompt('Record a recipe')
  send('I cooked tomatoes with broth and simmered until soft.')
  await screen.findByRole('button', { name: 'Retry same request' })

  choosePrompt('Use my ingredients')
  send('rice and eggs; quick')
  await screen.findByRole('button', { name: 'Retry same request' })

  expect(screen.getAllByRole('timer').map((timer) => timer.textContent).join(' ')).toContain('cooking notes')
  expect(screen.getAllByRole('timer').map((timer) => timer.textContent).join(' ')).toContain('pantry ideas')

  choosePrompt('Record a recipe')
  send('I cooked beans and onions until tender.')
  await screen.findByText(/rate-limited for cooking notes/)
  expect(extract).toHaveBeenCalledOnce()
  expect((screen.getByRole('textbox', { name: 'Message Mori' }) as HTMLTextAreaElement).value)
    .toBe('I cooked beans and onions until tender.')

  choosePrompt('Use my ingredients')
  send('rice and peas; spicy')
  await screen.findByText(/rate-limited for pantry ideas/)
  expect(generate).toHaveBeenCalledOnce()
  expect((screen.getByRole('textbox', { name: 'Message Mori' }) as HTMLTextAreaElement).value)
    .toBe('rice and peas; spicy')
})

it('keeps Mori and the conversation open across its own route navigation', async () => {
  render(<MemoryRouter initialEntries={['/app/recipes']}><MoriCompanionProvider><MoriCompanion userId="mori-chat-route" /><Location /></MoriCompanionProvider></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
  fireEvent.click(screen.getByRole('button', { name: 'Open cooking notes' }))

  await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('/app/quick-entry'))
  expect(screen.getByRole('region', { name: 'Mori' })).toBeTruthy()
  expect(screen.getByText('Opening your cooking notes.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Close Mori' }))
  fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
  expect(screen.getByText('Opening your cooking notes.')).toBeTruthy()
})

it('opens an existing AI Chef review instead of targeting its disabled pantry field', async () => {
  const userId = 'mori-chat-existing-chef'
  writeChefDraft(userId, {
    input: { pantryItems: ['rice'], pantryInput: '', preferences: '' },
    handoff: { request: { pantryItems: ['rice'] }, response: suggestion(), selectedParentIds: [], saved: false },
  })
  render(<MemoryRouter initialEntries={['/app/recipes']}><MoriCompanionProvider><MoriCompanion userId={userId} /><Location /></MoriCompanionProvider></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
  fireEvent.click(screen.getByRole('button', { name: 'Open pantry' }))

  await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('/app/chef/review'))
  expect(screen.getByText(/already have a pantry idea waiting in review/)).toBeTruthy()
  expect(readChefDraftResult(userId).draft.handoff?.response.candidate_token).toBe('opaque-candidate-token')
})

it('preserves the active AI Chef review key when Pantry opens its existing idea', async () => {
  const userId = 'mori-chat-active-chef-review'
  writeChefDraft(userId, {
    input: { pantryItems: ['rice'], pantryInput: '', preferences: '' },
    handoff: { request: { pantryItems: ['rice'] }, response: suggestion(), selectedParentIds: [], saved: false },
  })
  render(<MemoryRouter initialEntries={[{ pathname: '/app/chef/review', state: { moriKeepOpen: true, moriReviewKey: 17 } }]}>
    <MoriCompanionProvider><MoriCompanion userId={userId} /><Location /></MoriCompanionProvider>
  </MemoryRouter>)

  fireEvent.click(await screen.findByRole('button', { name: 'Open pantry' }))

  await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('"moriReviewKey":17'))
  expect(screen.getByRole('region', { name: 'Mori' })).toBeTruthy()
})


it('fills and focuses an editable prompt without sending', () => {
  renderChat('mori-chat-tasks')
  const count = screen.queryAllByRole('article').length
  choosePrompt('Record a recipe')
  expect(screen.getByRole('textbox', { name: 'Message Mori' })).toHaveProperty('value', 'Write a recipe from these cooking notes: ')
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message Mori' }))
  expect(screen.queryAllByRole('article')).toHaveLength(count)
})

it('preserves the reading position when a new turn arrives', () => {
  renderChat('mori-chat-scroll')
  const log = screen.getByRole('log')
  Object.defineProperties(log, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 200 },
  })
  log.scrollTop = 100
  fireEvent.scroll(log)
  send('hello')
  expect(log.scrollTop).toBe(100)
  log.scrollTop = 800
  fireEvent.scroll(log)
  send('hello again')
  expect(log.scrollTop).toBe(1000)
})

it('identifies speakers and announces pending work outside the busy transcript', async () => {
  vi.spyOn(extractRecipeApi, 'extract').mockImplementation(() => new Promise(() => {}))
  renderChat('mori-chat-accessible-speakers')
  choosePrompt('Record a recipe')
  send('I simmered rice with tomatoes until soft.')
  expect(screen.getByRole('article', { name: 'You' }).textContent).toContain('I simmered')
  const status = await screen.findByText('Mori is working on your request.')
  expect(status.closest('[aria-busy="true"]')).toBeNull()
  expect(screen.getByRole('log').getAttribute('aria-busy')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
})

it('separates the prompt library from journal navigation', () => {
  renderChat('mori-chat-clear-actions')
  expect(screen.getByRole('group', { name: 'Suggested prompts' })).toBeTruthy()
  const navigation = screen.getByRole('navigation', { name: 'Open a journal page' })
  expect(navigation.contains(screen.getByRole('button', { name: 'Open recipes' }))).toBe(true)
  choosePrompt('Use my ingredients')
  expect(screen.getByText('Example: “rice, eggs; quick and spicy”')).toBeTruthy()
  choosePrompt('Record a recipe')
  expect(screen.getByText(/Example: “Tomato rice/)).toBeTruthy()
})

it('places the caret in the ingredient slot and preserves the selected meal preference', async () => {
  const generate = vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(suggestion())
  renderChat('mori-chip-preferences')
  fireEvent.click(screen.getByRole('button', { name: 'See more' }))
  fireEvent.click(screen.getByRole('button', { name: 'No-oven idea' }))
  const input = screen.getByRole('textbox', { name: 'Message Mori' })
  if (!(input instanceof HTMLTextAreaElement)) throw new Error('Expected textarea')
  expect(document.activeElement).toBe(input)
  const caret = input.selectionStart
  fireEvent.change(input, { target: { value: input.value.slice(0, caret) + 'rice, eggs' + input.value.slice(caret) } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(generate).toHaveBeenCalledOnce())
  expect(generate.mock.calls[0]?.slice(0, 2)).toEqual([['rice', 'eggs'], 'no oven'])
})

it('refocuses the ingredient slot when the same prompt is selected again', () => {
  renderChat('mori-reselect-prompt')
  for (let attempt = 0; attempt < 2; attempt++) {
    fireEvent.click(screen.getByRole('button', { name: 'See more' }))
    fireEvent.click(screen.getByRole('button', { name: 'No-oven idea' }))
    const input = screen.getByRole('textbox', { name: 'Message Mori' })
    expect(document.activeElement).toBe(input)
    if (!(input instanceof HTMLTextAreaElement)) throw new Error('Expected textarea')
    expect(input.selectionStart).toBe(input.value.indexOf(';'))
  }
})
