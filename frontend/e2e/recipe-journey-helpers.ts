import { expect, type Page } from '@playwright/test'

// A turn includes layout preparation and Mori's animation.
export async function waitForJournalPageTurn(page: Page) {
  await expect(page.locator('[data-journal-page-turn]')).toHaveCount(0, { timeout: 15_000 })
}

type E2eUser = {
  email: string
  password: string
}

export async function signIn(page: Page, user: E2eUser) {
  await page.goto('/app')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('Email').fill(user.email)
  await page.getByRole('textbox', { name: 'Password' }).fill(user.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/app\/?$/)
  await expect(page.getByRole('heading', { name: /^(My recipes|Your cooking journal)$/i })).toBeVisible()
}

export async function waitForCollection(page: Page) {
  await expect(
    page.getByRole('heading', { name: 'A fresh page for your next favorite.' })
      .or(page.getByRole('heading', { name: 'No recipes match your search.' }))
      .or(page.getByRole('list', { name: 'Recipes on page 1' }).getByRole('listitem').first()),
  ).toBeVisible({ timeout: 30_000 })
}

export async function createRecipe(page: Page, title: string): Promise<string> {
  await page.getByRole('link', { name: 'New recipe' }).click()
  await page.getByLabel('Recipe title').fill(title)
  const ingredients = await navigateToRecipeSection(page, 'Ingredients')
  await ingredients.getByRole('button', { name: 'Add ingredient' }).click()
  await ingredients.getByLabel('Ingredient 1 name').fill('olive oil')
  await ingredients.getByLabel('Ingredient 1 quantity').fill('2')
  await ingredients.getByLabel('Ingredient 1 unit').fill('tablespoons')
  const method = await navigateToRecipeSection(page, 'Cooking method')
  await method.getByRole('button', { name: 'Add cooking step' }).click()
  await method.getByLabel('Step 1 description').fill('Warm the oil and fold in the herbs.')

  const savedRecipe = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/functions/v1/recipes',
  )
  await page.getByRole('button', { name: 'Save recipe' }).click()

  const response = await savedRecipe
  expect(response.status()).toBe(201)
  await expect(page.getByText('Recipe saved.', { exact: true })).toBeVisible({ timeout: 30_000 })
  const body = await response.json()
  const recipeId = body?.recipe?.id
  if (typeof recipeId !== 'string') throw new Error('The recipe API did not return its saved recipe ID.')
  return recipeId
}

export async function navigateToRecipeSection(page: Page, sectionName: string) {
  const section = page.getByRole('region', { name: new RegExp(`^${sectionName}, page \\d+$`) })
  const pageNavigation = page.getByRole('navigation', { name: 'Recipe writing pages', exact: true })
  const nextPage = pageNavigation.getByRole('button', { name: /^Next(?: Pages?$|:)/ })
  const previousPage = page.getByRole('navigation', { name: 'Previous Recipe writing pages', exact: true }).getByRole('button', { name: /^Previous/ })
  const pagePosition = pageNavigation.locator('.mm-pagination-number')

  // A responsive layout change can put the requested section behind the current leaf.
  let backwards = false
  while (!(await section.first().isVisible())) {
    if (!(await nextPage.count())) backwards = true
    const turn = backwards ? previousPage : nextPage
    await expect(turn, `Cannot reach recipe section: ${sectionName}`).toBeEnabled()
    const currentPosition = await pagePosition.innerText()
    await turn.click()
    await waitForJournalPageTurn(page)
    await expect(pagePosition).not.toHaveText(currentPosition)
  }

  await expect(section.first()).toBeVisible()
  return section
}

export async function finishRecipeReview(page: Page) {
  const next = page.getByRole('button', { name: /^Next:/ })
  while (await next.isVisible()) {
    const progress = page.locator('.mm-review-progress')
    const current = await progress.innerText()
    await next.click()
    await waitForJournalPageTurn(page)
    await expect(progress).not.toHaveText(current)
  }
  await expect(page.getByRole('button', { name: 'Save recipe' })).toBeVisible()
}
