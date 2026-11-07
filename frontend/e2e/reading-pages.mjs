import assert from 'node:assert/strict'

export async function settleReadingPages(page) {
  await page.waitForFunction(() => {
    const article = globalThis.document.querySelector('.mm-continuation')
    if (!article || article.dataset.readingReady !== 'true') return false
    const right = article.querySelector('.mm-recipe-reading-body')
    const left = globalThis.document.querySelector('.mm-continuation-left')
    const single = globalThis.matchMedia('(max-width: 1099.98px), (max-height: 639.98px)').matches
    const height = Math.floor(Math.min(right.clientHeight, single ? Infinity : left.clientHeight)) - 8
    const width = Math.floor(Math.min(right.clientWidth, single ? Infinity : left.clientWidth)) - 8
    if (height > 0 && width > 0 && (height < 160 || width < 80)) return article.classList.contains('is-fallback')
    return Number(article.dataset.readingCapacity) === height && Number(article.dataset.readingWidth) === width
  })
}

// Read only live leaves: the inert offscreen measurement bank is never content.
export async function readAllRecipePages(page) {
  await settleReadingPages(page)
  const result = []
  for (let turn = 0; turn < 300; turn++) {
    result.push(...await page.locator('.mm-continuation-body [data-unit]').evaluateAll((nodes) => nodes.map((node) => ({
      id: node.dataset.unit, text: node.querySelector('.mm-unit-content').textContent,
    }))))
    const next = page.getByRole('button', { name: 'Next Page', exact: true })
    if (await next.isDisabled()) return result
    const previous = await page.locator('.mm-reading-indicator').textContent()
    await next.click()
    await page.waitForFunction((previous) => globalThis.document.querySelector('.mm-reading-indicator').textContent !== previous, previous)
    await page.waitForFunction(() => !globalThis.document.querySelector('[data-journal-page-turn]'))
  }
  assert.fail('Reading pagination did not end within 300 turns')
}

export async function findReadingContent(page, locator) {
  await page.locator('.mm-continuation.is-measured').waitFor()
  for (let turn = 0; turn < 300; turn++) {
    if (await locator.count() && await locator.first().isVisible()) return
    const next = page.getByRole('button', { name: 'Next Page', exact: true })
    if (await next.isDisabled()) break
    await next.click()
    await page.waitForFunction(() => !globalThis.document.querySelector('[data-journal-page-turn]'))
  }
  assert.fail('Content was not reachable through recipe pages')
}
