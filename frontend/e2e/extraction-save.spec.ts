import { expect, test } from '@playwright/test'
import { localE2eUser } from './local-user.mjs'
import { navigateToRecipeSection, signIn, waitForCollection } from './recipe-journey-helpers'

async function expectRecipeAbsentInCollection(page, ...titles) {
  const collectionResponse = page.waitForResponse((response) =>
    response.request().method() === 'GET' && new URL(response.url()).pathname === '/functions/v1/recipes',
  )
  await page.goto('/app/recipes')
  expect((await collectionResponse).status()).toBe(200)
  await waitForCollection(page)
  for (const title of titles) {
    await expect(page.getByRole('link', { name: title })).toHaveCount(0)
  }
}

test('an edited extraction stays unsaved until a successful explicit retry', async ({ page }) => {
  test.setTimeout(120_000)

  const marker = `FS04-${crypto.randomUUID()}`
  const notes = `${marker}\nchicken, garlic, and soy sauce; cook slowly`
  const extractedTitle = marker
  const reviewedTitle = `${marker} reviewed`
  const createRequests = []
  let createAttempts = 0

  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.method() === 'POST' && url.pathname === '/functions/v1/recipes') {
      createRequests.push(request)
    }
  })

  await page.route('**/functions/v1/recipes', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }

    createAttempts += 1
    if (createAttempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: {
          'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        },
        body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' } }),
      })
      return
    }

    await route.continue()
  })

  await test.step('sign in and extract a unique preview without creating a recipe', async () => {
    await signIn(page, localE2eUser)
    await page.goto('/app/quick-entry')
    await page.getByRole('textbox', { name: 'Cooking notes' }).fill(notes)
    await page.getByRole('button', { name: 'Organize my notes' }).click()
    await expect(page.getByRole('heading', { name: extractedTitle })).toBeVisible()
    await expect(page.getByText('This recipe is only a preview. Nothing has been saved to your journal.')).toBeVisible()
    expect(createRequests).toHaveLength(0)
  })

  await test.step('edit the reviewed fields and verify the collection is still empty for this recipe', async () => {
    await page.getByRole('link', { name: 'Review & Edit Recipe' }).click()
    await expect(page.getByLabel('Recipe title')).toHaveValue(extractedTitle)
    await page.getByLabel('Recipe title').fill(reviewedTitle)

    const ingredients = await navigateToRecipeSection(page, 'Ingredients')
    await ingredients.getByLabel('Ingredient 1 name').fill('free-range chicken')

    const cookingMethod = await navigateToRecipeSection(page, 'Cooking method')
    await cookingMethod.getByLabel('Step 1 description').fill('Cook the chicken slowly until tender.')

    expect(createRequests).toHaveLength(0)
    const collectionPage = await page.context().newPage()
    try {
      await expectRecipeAbsentInCollection(collectionPage, extractedTitle, reviewedTitle)
    } finally {
      await collectionPage.close()
    }
  })

  await test.step('preserve the review after one safe save failure', async () => {
    await page.getByRole('button', { name: 'Save recipe' }).click()
    await expect(page.getByRole('alert')).toHaveText('Could not save your recipe. Your changes are still here. Please try again.')
    expect(createAttempts).toBe(1)
    expect(createRequests[0].postDataJSON()).toMatchObject({
      title: reviewedTitle,
      ingredients: expect.arrayContaining([expect.objectContaining({ name: 'free-range chicken' })]),
      instructions: expect.arrayContaining([expect.objectContaining({ text: 'Cook the chicken slowly until tender.' })]),
    })

    await expect(page.getByLabel('Step 1 description')).toHaveValue('Cook the chicken slowly until tender.')
    const pageNavigation = page.getByRole('navigation', { name: 'Recipe writing pages' })
    const pagePosition = pageNavigation.getByText(/of \d+$/)
    const currentPosition = await pagePosition.innerText()
    await pageNavigation.getByRole('button', { name: /^Previous Pages?$/ }).click()
    await expect(pagePosition).not.toHaveText(currentPosition)
    await expect(page.getByLabel('Recipe title')).toHaveValue(reviewedTitle)
    await expect(page.getByRole('textbox', { name: 'Ingredient 1 name' }).filter({ visible: true })).toHaveValue('free-range chicken')

    const collectionPage = await page.context().newPage()
    try {
      await expectRecipeAbsentInCollection(collectionPage, extractedTitle, reviewedTitle)
    } finally {
      await collectionPage.close()
    }
  })

  await test.step('retry through the real recipe API and reload the saved recipe', async () => {
    await page.getByRole('button', { name: 'Save recipe' }).click()
    await expect(page.getByText('Recipe saved.', { exact: true })).toBeVisible()
    expect(createAttempts).toBe(2)
    expect(createRequests).toHaveLength(2)
    expect(createRequests[1].postDataJSON()).toMatchObject({
      title: reviewedTitle,
      ingredients: expect.arrayContaining([expect.objectContaining({ name: 'free-range chicken' })]),
      instructions: expect.arrayContaining([expect.objectContaining({ text: 'Cook the chicken slowly until tender.' })]),
    })

    await page.goto('/app/recipes')
    await waitForCollection(page)
    await page.getByRole('link', { name: reviewedTitle }).click()
    await expect(page.getByRole('heading', { name: reviewedTitle })).toBeVisible()
    await expect(page.getByRole('listitem').filter({ hasText: 'free-range chicken' })).toBeVisible()
    await expect(page.getByRole('listitem').filter({ hasText: 'Cook the chicken slowly until tender.' })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('heading', { name: reviewedTitle })).toBeVisible()
    await expect(page.getByRole('listitem').filter({ hasText: 'free-range chicken' })).toBeVisible()
    await expect(page.getByRole('listitem').filter({ hasText: 'Cook the chicken slowly until tender.' })).toBeVisible()
  })
})
