import { expect, test } from '@playwright/test'
import { localE2eOtherUser, localE2eUser } from './local-user.mjs'

async function signIn(page, user) {
  await page.goto('/app')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('Email').fill(user.email)
  await page.getByRole('textbox', { name: 'Password' }).fill(user.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/app\/?$/)
  await expect(page.getByRole('heading', { name: 'Your cooking journal' })).toBeVisible()
}

async function waitForCollection(page) {
  await expect(
    page.getByRole('heading', { name: 'A fresh page for your next favorite.' })
      .or(page.getByRole('heading', { name: /Saved recipes/ })),
  ).toBeVisible({ timeout: 30_000 })
}

async function createRecipe(page, recipeTitle) {
  await page.getByRole('link', { name: 'Start a recipe' }).click()
  await page.getByLabel('Recipe title').fill(recipeTitle)
  await page.getByRole('button', { name: 'Add ingredient' }).click()
  await page.getByLabel('Ingredient 1 name').fill('olive oil')
  await page.getByLabel('Ingredient 1 quantity').fill('2')
  await page.getByLabel('Ingredient 1 unit').fill('tablespoons')
  await page.getByRole('button', { name: 'Add cooking step' }).click()
  await page.getByLabel('Step 1 description').fill('Warm the oil and fold in the herbs.')
  await page.getByRole('button', { name: 'Save recipe' }).click()
  await expect(page.getByText('Recipe saved.', { exact: true })).toBeVisible()
}

test('a signed-in cook creates, edits, rates, and deletes a saved recipe', async ({ page }) => {
  test.setTimeout(90_000)

  const recipeTitle = `FS-03 Playwright ${crypto.randomUUID()}`
  const updatedTitle = `${recipeTitle} revised`

  await test.step('sign in through the UI and enter the protected journal', async () => {
    await signIn(page, localE2eUser)
  })

  await test.step('wait for the journal collection to finish loading', async () => {
    await waitForCollection(page)
  })

  await test.step('create a recipe through the application form', async () => {
    await createRecipe(page, recipeTitle)
  })

  await test.step('find the recipe in the journal and reload its detail', async () => {
    await page.getByRole('button', { name: 'Back to journal' }).click()
    const recipeCard = page.getByRole('link', { name: recipeTitle })
    await expect(recipeCard).toBeVisible()
    await recipeCard.click()
    await expect(page.getByRole('heading', { name: recipeTitle })).toBeVisible()
    await expect(page.getByText(/olive oil/)).toBeVisible()
    await expect(page.getByText('Warm the oil and fold in the herbs.')).toBeVisible()

    await page.reload()
    await expect(page.getByRole('heading', { name: recipeTitle })).toBeVisible()
    await expect(page.getByText('Warm the oil and fold in the herbs.')).toBeVisible()
  })

  await test.step('edit and rate the persisted recipe', async () => {
    await page.getByRole('link', { name: 'Edit recipe' }).click()
    await page.getByLabel('Recipe title').fill(updatedTitle)
    await page.getByLabel('Rating').selectOption('4')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Recipe saved.', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Back to journal' }).click()
    await page.getByRole('link', { name: updatedTitle }).click()
    await page.reload()
    await expect(page.getByRole('heading', { name: updatedTitle })).toBeVisible()
    await expect(page.getByText('4 / 5', { exact: true })).toBeVisible()
  })

  await test.step('confirm deletion, verify the journal, and revisit the deleted detail', async () => {
    const deletedRecipeUrl = page.url()

    await page.getByRole('button', { name: 'Delete recipe' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: `Delete “${updatedTitle}”?` })).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete recipe' }).click()
    await expect(page).toHaveURL(/\/app\/recipes$/)
    await expect(page.getByText('Recipe deleted. Your collection has been updated.', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: updatedTitle })).toHaveCount(0)

    await page.reload()
    await expect(page.getByRole('link', { name: updatedTitle })).toHaveCount(0)

    await page.goto(deletedRecipeUrl, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Recipe unavailable' })).toBeVisible({ timeout: 30_000 })
  })
})

test('a signed-in cook cannot view, update, or delete another cook’s recipe', async ({ page }) => {
  test.setTimeout(90_000)

  const recipeTitle = `FS-03 Ownership ${crypto.randomUUID()}`

  await signIn(page, localE2eOtherUser)
  await waitForCollection(page)
  await createRecipe(page, recipeTitle)
  await page.getByRole('button', { name: 'Back to journal' }).click()
  const recipeCard = page.getByRole('link', { name: recipeTitle })
  await expect(recipeCard).toBeVisible()
  await recipeCard.click()
  await expect(page.getByRole('heading', { name: recipeTitle })).toBeVisible()
  const recipeUrl = page.url()

  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await signIn(page, localE2eUser)
  await waitForCollection(page)
  await expect(page.getByRole('link', { name: recipeTitle })).toHaveCount(0)

  const recipeId = new URL(recipeUrl).pathname.split('/').pop()!
  const appRequestPromise = page.waitForRequest((request) => {
    const url = new URL(request.url())
    return request.method() === 'GET' && url.pathname.endsWith(`/functions/v1/recipes/${recipeId}`)
  })
  await page.goto(recipeUrl)
  await expect(page.getByRole('heading', { name: 'Recipe unavailable' })).toBeVisible({ timeout: 30_000 })
  const appRequest = await appRequestPromise
  const apiUrl = appRequest.url()
  const appHeaders = await appRequest.allHeaders()
  const authHeaders = { authorization: appHeaders.authorization, apikey: appHeaders.apikey }

  const updateResponse = await page.request.patch(apiUrl, {
    headers: authHeaders,
    data: { title: `${recipeTitle} changed by another cook` },
  })
  expect(updateResponse.status()).toBe(404)
  await expect(updateResponse.json()).resolves.toMatchObject({ error: { code: 'NOT_FOUND' } })

  const deleteResponse = await page.request.delete(apiUrl, { headers: authHeaders })
  expect(deleteResponse.status()).toBe(404)
  await expect(deleteResponse.json()).resolves.toMatchObject({ error: { code: 'NOT_FOUND' } })

  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await signIn(page, localE2eOtherUser)
  await page.goto(recipeUrl)
  await expect(page.getByRole('heading', { name: recipeTitle })).toBeVisible()
  await expect(page.getByText(/olive oil/)).toBeVisible()
  await expect(page.getByText('Warm the oil and fold in the herbs.')).toBeVisible()
  await page.getByRole('button', { name: 'Delete recipe' }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'Delete recipe' }).click()
  await expect(page).toHaveURL(/\/app\/recipes$/)
  await expect(page.getByText('Recipe deleted. Your collection has been updated.', { exact: true })).toBeVisible()
})
