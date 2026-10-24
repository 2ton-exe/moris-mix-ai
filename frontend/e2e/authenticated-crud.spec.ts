import { expect, test } from '@playwright/test'
import { localE2eUser } from './local-user.mjs'

test('a signed-in cook creates, edits, rates, and deletes a saved recipe', async ({ page }) => {
  const recipeTitle = `FS-03 Playwright ${crypto.randomUUID()}`
  const updatedTitle = `${recipeTitle} revised`

  await test.step('sign in through the UI and enter the protected journal', async () => {
    await page.goto('/app')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByLabel('Email').fill(localE2eUser.email)
    await page.getByRole('textbox', { name: 'Password' }).fill(localE2eUser.password)
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page).toHaveURL(/\/app\/?$/)
    await expect(page.getByRole('heading', { name: 'Your cooking journal' })).toBeVisible()
  })

  await test.step('create a recipe through the application form', async () => {
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

    await page.goto(deletedRecipeUrl)
    await expect(page.getByRole('heading', { name: 'Recipe unavailable' })).toBeVisible()
  })
})
