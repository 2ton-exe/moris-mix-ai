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
      .or(page.getByRole('heading', { name: /Saved recipes/ })),
  ).toBeVisible({ timeout: 30_000 })
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
