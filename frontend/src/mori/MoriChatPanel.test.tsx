import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { readChefDraftResult, writeChefDraft } from '../ai-chef/draft'
import type { GenerateRecipeResponse } from '../ai-chef/generateRecipe'
import { generateRecipeApi } from '../ai-chef/generateRecipe'
import { readQuickAiEntryDraftResult, writeQuickAiEntryDraft } from '../quick-ai/draft'
import type { ExtractedRecipe } from '../quick-ai/extractRecipe'
import { extractRecipeApi, MAX_EXTRACTION_INPUT_CHARS } from '../quick-ai/extractRecipe'
import { MoriCompanion } from './MoriCompanion'
import { MoriCompanionProvider } from './MoriCompanionContext'
import { MoriChatPanel } from './MoriChatPanel'

function Location() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}|{JSON.stringify(location.state)}</output>
}

function renderChat(userId: string) {
  return render(<MemoryRouter initialEntries={['/app/recipes']}><MoriChatPanel userId={userId} /><Location /></MemoryRouter>)
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

  fireEvent.click(screen.getByRole('button', { name: 'Create recipe' }))
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

  fireEvent.click(screen.getByRole('button', { name: 'Create recipe' }))
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

  fireEvent.click(screen.getByRole('button', { name: 'Cooking idea' }))
  send('What can I cook with rice and eggs; quick and spicy')
  await screen.findByRole('button', { name: 'Review recipe' })
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

  fireEvent.click(screen.getByRole('button', { name: 'Create recipe' }))
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

  expect(await screen.findAllByText('Your unsaved idea is ready in review. Nothing will be saved to your journal until you confirm there.')).toHaveLength(2)
  expect(screen.getByTestId('location').textContent).toContain('"moriReviewKey":1')
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

  fireEvent.click(screen.getByRole('button', { name: 'Create recipe' }))
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

  fireEvent.click(screen.getByRole('button', { name: 'Create recipe' }))
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

it('asks for pantry ingredients instead of sending an empty request as an ingredient', async () => {
  const generate = vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(suggestion())
  renderChat('mori-chat-empty-pantry')
  send('What can I cook?')

  await screen.findByText('Tell me at least one ingredient you have. Add optional preferences after a semicolon.')
  expect(generate).not.toHaveBeenCalled()
})

it('retries a failed pantry request with the exact original prompt', async () => {
  const generate = vi.spyOn(generateRecipeApi, 'generate')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(suggestion())
  renderChat('mori-chat-retry')
  fireEvent.click(screen.getByRole('button', { name: 'Cooking idea' }))
  send('rice and eggs; quick and spicy')

  await screen.findByRole('button', { name: 'Retry same request' })
  fireEvent.click(screen.getByRole('button', { name: 'Retry same request' }))
  await screen.findByRole('button', { name: 'Review recipe' })
  expect(generate).toHaveBeenCalledTimes(2)
  expect(generate.mock.calls[0]?.slice(0, 2)).toEqual(generate.mock.calls[1]?.slice(0, 2))
})

it('keeps Mori and the conversation open across its own route navigation', async () => {
  render(<MemoryRouter initialEntries={['/app/recipes']}><MoriCompanionProvider><MoriCompanion userId="mori-chat-route" /><Location /></MoriCompanionProvider></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cooking notes' }))

  await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('/app/quick-entry'))
  expect(screen.getByRole('region', { name: 'Mori' })).toBeTruthy()
  expect(screen.getByText('Opening your cooking notes.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Hide Mori' }))
  fireEvent.click(screen.getByRole('button', { name: 'Show Mori' }))
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
  fireEvent.click(screen.getByRole('button', { name: 'Pantry' }))

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

  fireEvent.click(await screen.findByRole('button', { name: 'Pantry' }))

  await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('"moriReviewKey":17'))
  expect(screen.getByRole('region', { name: 'Mori' })).toBeTruthy()
})
