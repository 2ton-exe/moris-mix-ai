import { expect, type Page } from '@playwright/test'

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
  await expect(page.getByRole('heading', { name: 'Your cooking journal' })).toBeVisible()
}

export async function waitForCollection(page: Page) {
  await expect(
    page.getByRole('heading', { name: 'A fresh page for your next favorite.' })
      .or(page.getByRole('heading', { name: 'No recipes match your search.' }))
      .or(page.locator('[data-recipe-id]').first()),
  ).toBeVisible({ timeout: 30_000 })
}

export async function createRecipe(page: Page, title: string): Promise<string> {
  await page.getByRole('link', { name: 'Start a recipe' }).click()
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
  const pageNavigation = page.getByRole('navigation', { name: 'Recipe writing pages' })
  const nextPage = pageNavigation.getByRole('button', { name: /^Next Pages?$/ })
  const pagePosition = pageNavigation.getByText(/of \d+$/)

  while (!(await section.isVisible())) {
    await expect(nextPage).toBeEnabled()
    const currentPosition = await pagePosition.innerText()
    await nextPage.click()
    await expect(pagePosition).not.toHaveText(currentPosition)
  }

  await expect(section).toBeVisible()
  return section
}
