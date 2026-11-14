import { expect, test, type Page } from '@playwright/test'
import { localE2eOtherUser, localE2eUser } from './local-user.mjs'
import { createRecipe, signIn, waitForCollection } from './recipe-journey-helpers'

async function addPantryItem(page: Page, item: string) {
  const input = page.getByRole('textbox', { name: 'Pantry ingredient' })
  await input.fill(item)
  await input.press('Enter')
}

test('AI Chef saves a reviewed recipe and only the selected parent lineage', async ({ page }) => {
  test.setTimeout(120_000)

  const marker = `QA03 Chef ${crypto.randomUUID()}`
  const parentTitle = `${marker} parent one`
  const secondParentTitle = `${marker} parent two`
  const otherOwnerTitle = `${marker} other owner private parent`
  const reviewedTitle = `${marker} reviewed`
  const recipeWrites = []
  const lineageWrites = []
  let otherPage: Page | undefined
  let otherRecipeId = ''

  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.method() === 'POST' && url.pathname === '/functions/v1/recipes') recipeWrites.push(request)
    if (request.method() === 'POST' && /\/functions\/v1\/recipes\/[^/]+\/lineage$/.test(url.pathname)) lineageWrites.push(request)
  })

  await test.step('Seed two owned candidates and another account’s private recipe', async () => {
    await signIn(page, localE2eUser)
    await waitForCollection(page)
    await createRecipe(page, parentTitle)
    await page.getByRole('button', { name: 'Back to journal' }).click()
    await waitForCollection(page)
    await createRecipe(page, secondParentTitle)
    await page.getByRole('button', { name: 'Back to journal' }).click()
    await waitForCollection(page)

    const browser = page.context().browser()
    if (!browser) throw new Error('Playwright browser is unavailable for the second local account.')
    otherPage = await browser.newPage({ baseURL: new URL(page.url()).origin })
    await signIn(otherPage, localE2eOtherUser)
    await waitForCollection(otherPage)
    otherRecipeId = await createRecipe(otherPage, otherOwnerTitle)
    await otherPage.getByRole('button', { name: 'Back to journal' }).click()
    await waitForCollection(otherPage)
    recipeWrites.length = 0
  })

  let generated: {
    parents: Array<{ id: string; title: string }>
    candidate_token: string | null
  }
  await test.step('Generate an unsaved preview from only owned recipes', async () => {
    await page.goto('/app/chef')
    await addPantryItem(page, 'olive oil')
    await page.getByRole('textbox', { name: /^Cooking preferences/ }).fill(marker)
    const generationResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/functions/v1/generate-recipe',
    )
    await page.getByRole('button', { name: 'Ask Mori for a recipe' }).click()
    generated = await (await generationResponse).json()

    await expect(page.getByRole('heading', { name: "Review Mori's recipe." })).toBeVisible()
    await expect(page.getByRole('region', { name: 'AI Chef generation details' })).toContainText('unsaved preview')
    await expect(page.getByRole('region', { name: 'Suggested parent recipes' })).toContainText(parentTitle)
    await expect(page.getByRole('region', { name: 'Suggested parent recipes' })).toContainText(secondParentTitle)
    await expect(page.getByRole('region', { name: 'Suggested parent recipes' })).not.toContainText(otherOwnerTitle)
    const generatedTitles = generated.parents.map((parent) => parent.title)
    expect(generatedTitles).toContain(parentTitle)
    expect(generatedTitles).toContain(secondParentTitle)
    expect(generatedTitles).not.toContain(otherOwnerTitle)
    expect(recipeWrites).toHaveLength(0)
    expect(lineageWrites).toHaveLength(0)
  })

  let parent: { id: string; title: string } | undefined
  await test.step('Review one suggested parent and save the edited recipe', async () => {
    parent = generated.parents.find((candidate) => candidate.title === parentTitle)
    expect(parent).toBeTruthy()
    await page.getByRole('checkbox', { name: new RegExp(parentTitle) }).check()
    await page.getByLabel('Recipe title').fill(reviewedTitle)
    expect(recipeWrites).toHaveLength(0)
    expect(lineageWrites).toHaveLength(0)

    const recipeResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/functions/v1/recipes',
    )
    const lineageResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/functions\/v1\/recipes\/[^/]+\/lineage$/.test(new URL(response.url()).pathname),
    )
    await page.getByRole('button', { name: 'Save recipe' }).click()
    await expect(page.getByText('Recipe and selected parent links saved.')).toBeVisible()

    const recipeRequest = recipeWrites[0]
    const lineageRequest = lineageWrites[0]
    expect((recipeRequest as { postDataJSON(): unknown }).postDataJSON()).toMatchObject({ title: reviewedTitle })
    expect((lineageRequest as { postDataJSON(): unknown }).postDataJSON()).toMatchObject({
      parent_recipe_ids: [parent!.id],
    })
    const savedRecipeResponse = await recipeResponse
    const savedLineageResponse = await lineageResponse
    expect(savedRecipeResponse.status()).toBe(201)
    expect(savedLineageResponse.status()).toBe(201)
    const savedRecipe = await savedRecipeResponse.json()
    const recipeHeaders = await recipeRequest.allHeaders()
    const ownerOrigin = new URL(recipeRequest.url()).origin
    const ownerHeaders = { authorization: recipeHeaders.authorization, apikey: recipeHeaders.apikey }
    const lineageUrl = `${ownerOrigin}/functions/v1/recipes/${savedRecipe.recipe.id}/lineage`
    const persistedLineage = await page.request.get(lineageUrl, { headers: ownerHeaders })
    expect(persistedLineage.status()).toBe(200)
    const persistedLineageBody = await persistedLineage.json()
    expect(persistedLineageBody.lineage.map((item: { parent_recipe_id: string }) => item.parent_recipe_id)).toEqual([parent!.id])

    await test.step('Reject a foreign parent with the owner’s valid generation token', async () => {
      expect(generated.candidate_token).toBeTruthy()
      const rejectedForeignParent = await page.request.post(lineageUrl, {
        headers: ownerHeaders,
        data: {
          parent_recipe_ids: [otherRecipeId],
          candidate_token: generated.candidate_token,
        },
      })
      expect(rejectedForeignParent.status()).toBe(404)
      await expect(rejectedForeignParent.json()).resolves.toMatchObject({
        error: { code: 'NOT_FOUND', message: 'Recipe not found.' },
      })
    })

    await test.step('Deny another account’s valid token access to the owner’s child lineage', async () => {
      await otherPage!.goto('/app/chef')
      await addPantryItem(otherPage!, 'olive oil')
      await otherPage!.getByRole('textbox', { name: /^Cooking preferences/ }).fill(`${marker} other account`)
      const otherGenerationResponsePromise = otherPage!.waitForResponse((response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/functions/v1/generate-recipe',
      )
      await otherPage!.getByRole('button', { name: 'Ask Mori for a recipe' }).click()
      const otherGenerationResponse = await otherGenerationResponsePromise
      expect(otherGenerationResponse.status()).toBe(200)
      const otherGenerated = await otherGenerationResponse.json()
      expect(otherGenerated.parents).toEqual(expect.arrayContaining([expect.objectContaining({ id: otherRecipeId })]))
      expect(otherGenerated.candidate_token).toEqual(expect.any(String))

      const otherGenerationHeaders = await otherGenerationResponse.request().allHeaders()
      const otherHeaders = {
        authorization: otherGenerationHeaders.authorization,
        apikey: otherGenerationHeaders.apikey,
      }
      const foreignGet = await otherPage!.request.get(lineageUrl, { headers: otherHeaders })
      expect(foreignGet.status()).toBe(404)
      await expect(foreignGet.json()).resolves.toMatchObject({
        error: { code: 'NOT_FOUND', message: 'Recipe not found.' },
      })

      const foreignPost = await otherPage!.request.post(lineageUrl, {
        headers: otherHeaders,
        data: {
          parent_recipe_ids: [otherRecipeId],
          candidate_token: otherGenerated.candidate_token,
        },
      })
      expect(foreignPost.status()).toBe(404)
      await expect(foreignPost.json()).resolves.toMatchObject({
        error: { code: 'NOT_FOUND', message: 'Recipe not found.' },
      })
    })

    const ownerLineageAfterRejectedWrites = await page.request.get(lineageUrl, { headers: ownerHeaders })
    expect(ownerLineageAfterRejectedWrites.status()).toBe(200)
    const finalLineageBody = await ownerLineageAfterRejectedWrites.json()
    expect(finalLineageBody.lineage.map((item: { parent_recipe_id: string }) => item.parent_recipe_id)).toEqual([parent!.id])
    expect(lineageWrites).toHaveLength(1)

    await page.goto(`/app/recipes/${savedRecipe.recipe.id}`)
    await expect(page.getByRole('heading', { name: reviewedTitle })).toBeVisible({ timeout: 30_000 })
    await page.reload()
    await expect(page.getByRole('heading', { name: reviewedTitle })).toBeVisible({ timeout: 30_000 })
    await otherPage!.close()
  })
})

test('AI endpoints keep malformed and provider failures as unsaved, recoverable drafts', async ({ page }) => {
  test.setTimeout(120_000)
  const recipeWrites = []
  const lineageWrites = []
  const generationRequests = []
  const extractionRequests = []

  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.method() === 'POST' && url.pathname === '/functions/v1/recipes') recipeWrites.push(request)
    if (request.method() === 'POST' && /\/functions\/v1\/recipes\/[^/]+\/lineage$/.test(url.pathname)) lineageWrites.push(request)
    if (request.method() === 'POST' && url.pathname === '/functions/v1/generate-recipe') generationRequests.push(request)
    if (request.method() === 'POST' && url.pathname === '/functions/v1/extract-recipe') extractionRequests.push(request)
  })

  await test.step('Reject Chef generation until pantry input is valid', async () => {
    await signIn(page, localE2eUser)
    await page.goto('/app/chef')
    await expect(page.getByRole('button', { name: 'Ask Mori for a recipe' })).toBeEnabled()
    await page.getByRole('button', { name: 'Ask Mori for a recipe' }).click()
    await expect(page.getByRole('alert')).toContainText('Add at least one pantry ingredient')
    expect(generationRequests).toHaveLength(0)
  })

  await test.step('Keep malformed and unavailable Chef responses retryable without writes', async () => {
    await addPantryItem(page, 'rice')
    const preferences = page.getByRole('textbox', { name: /^Cooking preferences/ })
    await preferences.fill('qa03:malformed')
    await page.getByRole('button', { name: 'Ask Mori for a recipe' }).click()
    await expect(page.getByRole('alert')).toContainText('Mori returned a recipe that could not be checked safely.')
    await expect(page.getByRole('region', { name: 'Pantry list, 1 item' })).toContainText('rice')
    await expect(preferences).toHaveValue('qa03:malformed')

    await preferences.fill('qa03:provider-failure')
    const providerFailureResponsePromise = page.waitForResponse((response) => {
      const request = response.request()
      if (request.method() !== 'POST' || new URL(response.url()).pathname !== '/functions/v1/generate-recipe') return false
      return (request.postDataJSON() as { preferences?: string }).preferences === 'qa03:provider-failure'
    })
    await page.getByRole('button', { name: 'Ask Mori for a recipe' }).click()
    const providerFailureResponse = await providerFailureResponsePromise
    expect(providerFailureResponse.status()).toBe(503)
    await expect(page.getByRole('alert')).toContainText('The AI service is temporarily unavailable.', { timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Pantry list, 1 item' })).toContainText('rice')
    await expect(preferences).toHaveValue('qa03:provider-failure')
    expect(generationRequests).toHaveLength(2)
    expect(recipeWrites).toHaveLength(0)
    expect(lineageWrites).toHaveLength(0)
  })

  await test.step('Keep Quick AI notes after malformed and provider failures', async () => {
    await page.goto('/app/quick-entry')
    const notes = page.getByRole('textbox', { name: 'Cooking notes' })
    await notes.fill('  ')
    await page.getByRole('button', { name: 'Organize my notes' }).click()
    await expect(page.getByRole('alert')).toContainText('Add a few cooking notes before organizing them.')
    expect(extractionRequests).toHaveLength(0)

    await notes.fill('QA03_MALFORMED\nrough cooking notes')
    await page.getByRole('button', { name: 'Organize my notes' }).click()
    await expect(page.getByRole('alert')).toContainText("Mori couldn't validate the recipe it returned.")
    await expect(notes).toHaveValue('QA03_MALFORMED\nrough cooking notes')

    await notes.fill('QA03_PROVIDER_FAILURE\nrough cooking notes')
    await page.getByRole('button', { name: 'Organize my notes' }).click()
    await expect(page.getByRole('alert')).toContainText('Mori could not organize those notes just now.')
    await expect(page.getByRole('button', { name: 'Retry extraction' })).toBeVisible()
    await expect(notes).toHaveValue('QA03_PROVIDER_FAILURE\nrough cooking notes')
    expect(extractionRequests).toHaveLength(2)
    expect(recipeWrites).toHaveLength(0)
    expect(lineageWrites).toHaveLength(0)
  })
})

