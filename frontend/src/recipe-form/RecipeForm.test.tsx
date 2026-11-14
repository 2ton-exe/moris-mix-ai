import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HttpError } from '../api/http'
import { RecipeForm } from './RecipeForm'
import { RecipeSubmissionError } from './submission'
import { recipeFormFixture } from './testing/fixtures'

afterEach(() => vi.restoreAllMocks())
const editable = { ...recipeFormFixture, notes: '' }
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const nextPages = () => click('Next Pages')
const previousPages = () => click('Previous Pages')
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

it('renders an empty create form with accessible labels and optional journal fields', () => {
  render(<RecipeForm mode="create" />)
  expect((screen.getByLabelText('Recipe title') as HTMLInputElement).value).toBe('')
  expect(screen.getByText(/No ingredients added yet/)).toBeTruthy()
  expect((screen.getByLabelText('Rating') as HTMLSelectElement).value).toBe('')
  expect(screen.getByLabelText('Cooked date').getAttribute('type')).toBe('date')
  expect(screen.getByText(/Local draft only/)).toBeTruthy()
  nextPages()
  expect(screen.getByText(/No cooking steps added yet/)).toBeTruthy()
})

it('populates edit mode including multiline notes, rating, quantities and calendar date', () => {
  render(<RecipeForm mode="edit" initialValues={recipeFormFixture} notesSupported />)
  expect((screen.getByLabelText('Recipe title') as HTMLInputElement).value).toBe(recipeFormFixture.title)
  expect((screen.getByLabelText('Ingredient 1 quantity') as HTMLInputElement).value).toBe('2')
  expect((screen.getByLabelText('Ingredient 2 quantity') as HTMLInputElement).value).toBe('')
  expect((screen.getByLabelText('Rating') as HTMLSelectElement).value).toBe('4')
  expect((screen.getByLabelText('Cooked date') as HTMLInputElement).value).toBe('2026-10-19')
  expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe(recipeFormFixture.notes)
  nextPages()
  expect((screen.getByLabelText('Step 1 description') as HTMLTextAreaElement).value).toBe(recipeFormFixture.instructions[0].text)
})

it('defaults missing optional notes to an empty editor', () => {
  render(<RecipeForm mode="edit" initialValues={{ ...editable, notes: undefined }} />)
  expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('')
})

it('focuses the added row and returns focus to Add when the last row is removed', async () => {
  render(<RecipeForm mode="create" />)
  click('Add ingredient')
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Ingredient 1 name')))
  click('Remove ingredient 1')
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add ingredient' })))
})

it('finishes new-row focus before the user moves to and types into the quantity field', () => {
  render(<RecipeForm mode="create" />)
  click('Add ingredient')
  expect(document.activeElement).toBe(screen.getByLabelText('Ingredient 1 name'))
  const quantity = screen.getByLabelText('Ingredient 1 quantity')
  quantity.focus()
  fill('Ingredient 1 quantity', '2')
  expect(document.activeElement).toBe(quantity)
  expect((screen.getByLabelText('Ingredient 1 name') as HTMLInputElement).value).toBe('')
  expect((quantity as HTMLInputElement).value).toBe('2')
})

it('adds ingredients, edits amounts, removes rows and submits normalized values', async () => {
  const submit = vi.fn().mockResolvedValue({ id: 'created' })
  render(<RecipeForm mode="create" onSubmit={submit} />)
  fill('Recipe title', '  Ginger rice  ')
  click('Add ingredient')
  fill('Ingredient 1 name', ' rice ')
  fill('Ingredient 1 quantity', '2.5')
  fill('Ingredient 1 unit', ' cups ')
  click('Add ingredient')
  fill('Ingredient 2 name', 'ginger')
  click('Add ingredient')
  fill('Ingredient 3 name', 'mint')
  fill('Ingredient 3 quantity', '1')
  previousPages()
  click('Move ingredient 1 down')
  expect((screen.getByLabelText('Ingredient 2 name') as HTMLInputElement).value).toBe(' rice ')
  nextPages()
  expect((screen.getByLabelText('Ingredient 3 name') as HTMLInputElement).value).toBe('mint')
  click('Remove ingredient 3')
  expect((screen.getByLabelText('Ingredient 1 name') as HTMLInputElement).value).toBe('ginger')
  click('Save recipe')
  await screen.findByText('Recipe saved.')
  expect(submit.mock.calls[0][0]).toMatchObject({ title: 'Ginger rice', ingredients: [
    { name: 'ginger', quantity: null, unit: null, inferred: false },
    { name: 'rice', quantity: 2.5, unit: 'cups', inferred: false },
  ] })
})

it('follows a reordered ingredient across physical pages and restores focus with its value', () => {
  render(<RecipeForm mode="edit" initialValues={editable} />)
  const first = screen.getByLabelText('Ingredient 1 name')
  fill('Ingredient 1 name', 'brown rice')
  click('Move ingredient 1 down')
  const moved = screen.getByLabelText('Ingredient 2 name')
  expect(moved).toBe(first)
  expect((moved as HTMLInputElement).value).toBe('brown rice')
  expect(document.activeElement).toBe(moved)
  expect(screen.getByText('Ingredient 1 moved down.')).toBeTruthy()
})

it('adds, edits, removes and reorders multiline steps with contiguous sequence positions', async () => {
  const submit = vi.fn().mockResolvedValue({ id: 'updated' })
  render(<RecipeForm mode="edit" initialValues={editable} onSubmit={submit} />)
  nextPages()
  const first = screen.getByLabelText('Step 1 description')
  click('Move step 1 down')
  const moved = screen.getByLabelText('Step 2 description')
  expect(moved).toBe(first)
  expect(moved).toBe(document.activeElement)
  click('Remove step 2')
  click('Add cooking step')
  fill('Step 2 description', 'Serve warm.\nEnjoy slowly.')
  click('Save changes')
  await screen.findByText('Recipe saved.')
  expect(submit.mock.calls[0][0].instructions).toEqual([
    { step: 1, text: recipeFormFixture.instructions[1].text }, { step: 2, text: 'Serve warm.\nEnjoy slowly.' },
  ])
})

it('keeps one form and one controlled draft through page turns and submits all rows from the last page', async () => {
  const submit = vi.fn().mockResolvedValue({ id: 'created' })
  render(<RecipeForm mode="create" onSubmit={submit} />)
  const form = screen.getByRole('form', { name: 'Create recipe' })
  fill('Recipe title', 'A complete folio')
  click('Add ingredient')
  fill('Ingredient 1 name', 'Rice')
  click('Add ingredient')
  fill('Ingredient 2 name', 'Ginger')
  click('Add ingredient')
  fill('Ingredient 3 name', 'Garlic')
  expect(document.querySelectorAll('form')).toHaveLength(1)
  previousPages()
  nextPages()
  expect(screen.getByRole('form', { name: 'Create recipe' })).toBe(form)
  expect((screen.getByLabelText('Ingredient 3 name') as HTMLInputElement).value).toBe('Garlic')
  click('Save recipe')
  await screen.findByText('Recipe saved.')
  expect(submit).toHaveBeenCalledTimes(1)
  expect(submit.mock.calls[0][0]).toMatchObject({ title: 'A complete folio', ingredients: [
    { name: 'Rice' }, { name: 'Ginger' }, { name: 'Garlic' },
  ] })
})

it('turns to the first invalid leaf and announces errors on additional pages', () => {
  const submit = vi.fn()
  const multiPage = { ...editable, ingredients: [
    ...editable.ingredients,
    { name: 'salt', quantity: 1, unit: 'tsp', inferred: false },
    { name: 'pepper', quantity: null, unit: null, inferred: false },
  ] }
  render(<RecipeForm mode="edit" initialValues={multiPage} onSubmit={submit} />)
  fill('Ingredient 1 quantity', 'some')
  nextPages()
  fill('Ingredient 3 quantity', 'a few')
  previousPages()
  click('Save changes')
  const first = screen.getByLabelText('Ingredient 1 quantity')
  expect(first.getAttribute('aria-invalid')).toBe('true')
  expect(document.activeElement).toBe(first)
  const otherPage = screen.getByRole('button', { name: /another recipe page with errors/i })
  expect(otherPage.textContent).toContain('1 other page has errors')
  expect(otherPage.getAttribute('aria-label')).toBe('Go to another recipe page with errors. 1 other page has errors.')
  fireEvent.click(otherPage)
  const second = screen.getByLabelText('Ingredient 3 quantity')
  expect(second.getAttribute('aria-invalid')).toBe('true')
  expect(document.activeElement).toBe(second)
  expect(submit).not.toHaveBeenCalled()
})

it('uses plural grammar in both descriptions when multiple other pages have errors', () => {
  const multiPage = { ...editable, ingredients: Array.from({ length: 6 }, (_, index) => ({
    name: 'Ingredient ' + (index + 1), quantity: 1, unit: 'cup', inferred: false,
  })) }
  render(<RecipeForm mode="edit" initialValues={multiPage} onSubmit={vi.fn()} />)
  fill('Recipe title', '')
  nextPages()
  fill('Ingredient 3 quantity', 'some')
  fill('Ingredient 5 quantity', 'some')
  click('Save changes')
  const otherPages = screen.getByRole('button', { name: 'Go to another recipe page with errors. 2 other pages have errors.' })
  expect(otherPages.textContent).toBe('2 other pages have errors')
})

it('validates the required trimmed title, links its error, and focuses the field', async () => {
  const submit = vi.fn()
  render(<RecipeForm mode="create" onSubmit={submit} />)
  fill('Recipe title', '  ')
  click('Save recipe')
  expect(screen.getByText('Enter a recipe title.')).toBeTruthy()
  const input = screen.getByLabelText('Recipe title')
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(input.getAttribute('aria-describedby')).toContain('-error')
  await waitFor(() => expect(document.activeElement).toBe(input))
  expect(submit).not.toHaveBeenCalled()
})

it('shows field-level quantity errors and preserves all entered values for correction', () => {
  const submit = vi.fn()
  render(<RecipeForm mode="edit" initialValues={editable} onSubmit={submit} />)
  fill('Ingredient 1 quantity', 'a few')
  click('Save changes')
  expect(screen.getByText('Enter a finite number, or leave the quantity blank.')).toBeTruthy()
  expect((screen.getByLabelText('Ingredient 1 quantity') as HTMLInputElement).value).toBe('a few')
  expect(submit).not.toHaveBeenCalled()
})

it('preserves existing rating and supports updating to unrated', async () => {
  const submit = vi.fn().mockResolvedValue({ id: 'updated' })
  render(<RecipeForm mode="edit" initialValues={editable} onSubmit={submit} />)
  fill('Rating', '')
  click('Save changes')
  await screen.findByText('Recipe saved.')
  expect(submit.mock.calls[0][0].star_rating).toBeNull()
})

it('preserves the selected calendar date and multiline supported notes', async () => {
  const submit = vi.fn().mockResolvedValue({ id: 'created' })
  render(<RecipeForm mode="create" onSubmit={submit} notesSupported />)
  fill('Recipe title', 'Rice')
  fill('Cooked date', '2026-01-01')
  fill('Notes', '<script>example</script>\nKeep this line.')
  click('Save recipe')
  await screen.findByText('Recipe saved.')
  expect(submit.mock.calls[0][0]).toMatchObject({ cooked_at: '2026-01-01', notes: '<script>example</script>\nKeep this line.' })
  expect(document.querySelector('script')).toBeNull()
})

it('does not silently discard unsupported notes or claim they were saved', async () => {
  const submit = vi.fn().mockResolvedValue({ id: 'created' })
  render(<RecipeForm mode="create" onSubmit={submit} />)
  fill('Recipe title', 'Rice')
  fill('Notes', 'Remember this.')
  click('Save recipe')
  expect((await screen.findByRole('alert')).textContent).toContain('Notes are not supported')
  expect(submit).not.toHaveBeenCalled()
  expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('Remember this.')
})

it.each(['create', 'edit'] as const)('preserves %s drafts on recoverable server errors and succeeds on retry', async (mode) => {
  const submit = vi.fn().mockRejectedValue(new HttpError('http', 'private database error', 500))
  render(<RecipeForm mode={mode} initialValues={editable} onSubmit={submit} />)
  fill('Recipe title', 'A revised title')
  click(mode === 'create' ? 'Save recipe' : 'Save changes')
  expect((await screen.findByRole('alert')).textContent).toContain('Your changes are still here')
  expect(document.body.textContent).not.toContain('private database error')
  expect((screen.getByLabelText('Recipe title') as HTMLInputElement).value).toBe('A revised title')
  submit.mockResolvedValue({ id: 'saved' })
  click(mode === 'create' ? 'Save recipe' : 'Save changes')
  await screen.findByText('Recipe saved.')
})

it('waits for a confirmed response and prevents repeated submission while pending', async () => {
  const request = deferred<{ id: string }>()
  const submit = vi.fn().mockReturnValue(request.promise)
  render(<StrictMode><RecipeForm mode="edit" initialValues={editable} onSubmit={submit} /></StrictMode>)
  click('Save changes')
  expect(screen.queryByText('Recipe saved.')).toBeNull()
  expect(screen.getByRole('button', { name: 'Saving…' }).matches(':disabled')).toBe(true)
  fireEvent.submit(screen.getByRole('form', { name: 'Edit recipe' }))
  expect(submit).toHaveBeenCalledOnce()
  await act(async () => request.resolve({ id: 'saved' }))
  await screen.findByText('Recipe saved.')
})

it.each(['create', 'edit'] as const)('prevents repeating a confirmed %s save until the values change', async (mode) => {
  const submit = vi.fn().mockResolvedValue({ id: 'saved' })
  render(<RecipeForm mode={mode} initialValues={mode === 'edit' ? editable : undefined} onSubmit={submit} />)
  fill('Recipe title', 'Ginger rice')
  click(mode === 'create' ? 'Save recipe' : 'Save changes')
  await screen.findByText('Recipe saved.')

  const buttonName = 'Save changes'
  expect(screen.getByRole('button', { name: buttonName }).matches(':disabled')).toBe(true)
  click(buttonName)
  expect(submit).toHaveBeenCalledOnce()

  fill('Recipe title', 'A different draft')
  expect(screen.getByRole('button', { name: buttonName }).matches(':disabled')).toBe(false)
  fill('Recipe title', 'Ginger rice')
  expect(screen.getByRole('button', { name: buttonName }).matches(':disabled')).toBe(true)
  click(buttonName)
  expect(submit).toHaveBeenCalledOnce()
})

it('rejects an empty confirmation instead of claiming persistence', async () => {
  render(<RecipeForm mode="edit" initialValues={editable} onSubmit={vi.fn().mockResolvedValue({ id: '' })} />)
  click('Save changes')
  await screen.findByRole('alert')
  expect(screen.queryByText('Recipe saved.')).toBeNull()
})

it('maps normalized server validation codes to safe field feedback without erasing input', async () => {
  const submit = vi.fn().mockRejectedValue(new RecipeSubmissionError('validation', [{ path: 'title', code: 'too-long' }]))
  render(<RecipeForm mode="edit" initialValues={editable} onSubmit={submit} />)
  click('Save changes')
  await screen.findByRole('alert')
  expect(screen.getByText('This value is too long. Please shorten it.')).toBeTruthy()
  expect((screen.getByLabelText('Recipe title') as HTMLInputElement).value).toBe(editable.title)
})

it('preserves dirty edits when initial data is refreshed for the same mounted recipe', () => {
  const view = render(<RecipeForm mode="edit" initialValues={editable} />)
  fill('Recipe title', 'My unsaved title')
  view.rerender(<RecipeForm mode="edit" initialValues={{ ...editable, title: 'Background response' }} />)
  expect((screen.getByLabelText('Recipe title') as HTMLInputElement).value).toBe('My unsaved title')
})

it('aborts on unmount and ignores a late save completion', async () => {
  const request = deferred<{ id: string }>()
  const submit = vi.fn().mockReturnValue(request.promise)
  const view = render(<RecipeForm mode="edit" initialValues={editable} onSubmit={submit} />)
  click('Save changes')
  const signal = submit.mock.calls[0][1].signal as AbortSignal
  view.unmount()
  expect(signal.aborted).toBe(true)
  await act(async () => request.resolve({ id: 'saved' }))
  expect(screen.queryByText('Recipe saved.')).toBeNull()
})

it('warns before reload with unsaved data and removes the warning after saving', async () => {
  render(<RecipeForm mode="edit" initialValues={editable} onSubmit={vi.fn().mockResolvedValue({ id: 'saved' })} />)
  fill('Recipe title', 'Unsaved title')
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  click('Save changes')
  await screen.findByText('Recipe saved.')
  const clean = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(clean)
  expect(clean.defaultPrevented).toBe(false)
})

it('shows the unavailable save error without mock persistence', async () => {
  render(<RecipeForm mode="edit" initialValues={editable} />)
  click('Save changes')
  expect((await screen.findByRole('alert')).textContent).toContain('nothing has been saved')
  expect(screen.queryByText('Recipe saved.')).toBeNull()
})

it('handles malformed initial data without rendering an unsafe edit form', () => {
  render(<RecipeForm mode="edit" initialValues={{ ...editable, ingredients: null } as unknown as typeof editable} />)
  expect(screen.getByRole('alert').textContent).toContain('could not be prepared')
  expect(screen.queryByLabelText('Recipe title')).toBeNull()
})

it('restores a confirmed create as saved and keeps post-save edits explicit', async () => {
  const statusMessage = 'Recipe saved. Parent links still need attention.'
  const submit = vi.fn().mockResolvedValue({ id: 'saved-recipe', statusMessage })
  render(<RecipeForm
    mode="create"
    initialValues={editable}
    initialSaveConfirmation={{ id: 'saved-recipe', statusMessage }}
    saveSuccessMessage={statusMessage}
    onSubmit={submit}
  />)

  expect(screen.getByText(statusMessage)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Save changes' }).matches(':disabled')).toBe(true)
  fill('Recipe title', 'Edited after recovery')
  click('Save changes')
  await screen.findByText(statusMessage)
  expect(submit).toHaveBeenCalledOnce()
  expect(submit.mock.calls[0][0].title).toBe('Edited after recovery')
})

it('ignores duplicate submit events while a create request is in flight', async () => {
  const request = deferred<{ id: string }>()
  const submit = vi.fn().mockReturnValue(request.promise)
  render(<RecipeForm mode="create" initialValues={editable} onSubmit={submit} />)
  fill('Recipe title', 'One saved recipe')
  const form = document.querySelector<HTMLFormElement>('form.recipe-form')
  expect(form).toBeTruthy()
  fireEvent.submit(form!)
  fireEvent.submit(form!)
  expect(submit).toHaveBeenCalledOnce()
  await act(async () => request.resolve({ id: 'saved-recipe' }))
  await screen.findByText('Recipe saved.')
})
