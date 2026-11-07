import assert from 'node:assert/strict'

/** DevTools viewport changes can precede CSS viewport-unit recalculation.
 * Wait for the actual source-sized book, then inspect geometry and hit targets.
 */
export async function settleJournalLayout(page, reference = false) {
  await page.waitForFunction((reference) => {
    const stage = globalThis.document.querySelector(reference ? '.book-stage' : '.mm-journal-stage')
    if (!stage || (reference && stage.dataset.scene !== 'open')) return true
    const width = globalThis.innerWidth
    const height = globalThis.innerHeight
    const single = width < 1100 || height < 640
    const paperHeight = Math.min(800, height - 156, (width - 268) / 2 / .74)
    const paperWidth = paperHeight * .74
    const expected = single ? Math.min(width - 62, 620) + 27
      : 2 * (paperWidth + paperWidth * .024 + 3 + paperWidth * .056 / 2)
    const layoutMatches = reference
      ? !!globalThis.document.querySelector('.page--single, .folio-col--single') === single
      : (globalThis.getComputedStyle(globalThis.document.querySelector('.mm-journal-spread')).display !== 'grid') === single
    return layoutMatches && Math.abs(stage.getBoundingClientRect().width - expected) < 1
  }, reference, { timeout: 10_000 })
  await page.evaluate(() => new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))))
}

/** Make book.css contract, including real root occlusion and exposed hit areas.
 * Scrolling is retained for Step 1; these checks do not approve final pagination.
 */
export async function assertJournalGeometry(page, label) {
  await settleJournalLayout(page)
  const geometry = await page.evaluate(() => {
    const rect = (element) => element.getBoundingClientRect().toJSON()
    const book = globalThis.document.querySelector('.mm-journal-book')
    const spread = book.querySelector('.mm-journal-spread')
    const left = book.querySelector('.mm-journal-flyleaf')
    const right = book.querySelector('.mm-journal-page')
    const scroll = (element) => ({ ...rect(element), clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflowY: globalThis.getComputedStyle(element).overflowY })
    const layout = globalThis.getComputedStyle(spread).display === 'grid' ? 'spread' : 'single'
    const writer = !!globalThis.document.querySelector('.recipe-form .mm-writing-pages')
    const paper = layout === 'spread' ? right : spread
    const activeScrollport = writer && layout === 'single' ? globalThis.document.querySelector('.recipe-form .mm-writing-leaf') : spread
    const tabs = [...book.querySelectorAll('.mm-bookmark')].map((tab) => {
      const box = rect(tab)
      const x = layout === 'spread' ? box.right - 20 : box.x + box.width / 2
      const y = layout === 'spread' ? box.y + box.height / 2 : box.y + 18
      const hit = globalThis.document.elementFromPoint(x, y)
      const root = globalThis.document.elementFromPoint(layout === 'spread' ? box.x + 4 : x, layout === 'spread' ? y : rect(spread).top + 4)
      const above = globalThis.document.elementFromPoint(x, box.y - 8)
      const css = globalThis.getComputedStyle(tab)
      const matrix = new globalThis.DOMMatrixReadOnly(css.transform)
      return { label: tab.textContent, ...box, active: tab.getAttribute('aria-current') === 'page', attachedDistance: layout === 'spread' ? rect(right).right - box.left : box.bottom - rect(spread).top, interactive: hit === tab || tab.contains(hit), extendedHit: above === tab || tab.contains(above), rootOccluded: root !== tab && !tab.contains(root) && (root === paper || paper.contains(root)), transform: { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, x: matrix.e, y: matrix.f }, decoration: css.textDecorationLine }
    })
    const css = (selector) => globalThis.getComputedStyle(book.querySelector(selector))
    const layers = { paper: globalThis.getComputedStyle(paper).zIndex, bookmarks: css('.mm-bookmarks').zIndex, rings: css('.mm-journal-rings').zIndex, stacks: [...book.querySelectorAll('.mm-journal-stack')].map((stack) => globalThis.getComputedStyle(stack).zIndex), spread: globalThis.getComputedStyle(spread).zIndex }
    const decorationIntercepts = [...book.querySelectorAll('.mm-journal-board, .mm-journal-stack, .mm-journal-binding, .mm-journal-ring-plate, .mm-journal-rings, .mm-journal-ring, .mm-journal-ring__half, .mm-journal-holes, .mm-journal-hole')].some((element) => globalThis.getComputedStyle(element).pointerEvents !== 'none')
    const outside = [...globalThis.document.querySelectorAll('body *')].filter((element) => element.getBoundingClientRect().right > globalThis.innerWidth + 1).slice(0, 8).map((element) => ({ name: String(element.className), box: rect(element) }))
    return { viewport: { width: globalThis.innerWidth, height: globalThis.innerHeight }, layout, writer, book: rect(book), left: scroll(left), right: scroll(right), spine: rect(book.querySelector(layout === 'spread' ? '.mm-journal-binding' : '.mm-journal-ring')), scrollport: scroll(activeScrollport), tabs, layers, decorationIntercepts, documentWidth: globalThis.document.documentElement.scrollWidth, outside }
  })
  assert.ok(geometry.documentWidth <= geometry.viewport.width, `${label}: horizontal document overflow ${JSON.stringify(geometry.outside)}`)
  const { book, left, right, spine, tabs, viewport } = geometry
  geometry.journalBounds = {
    left: Math.min(book.left, ...tabs.map((tab) => tab.left)),
    right: Math.max(book.right, ...tabs.map((tab) => tab.right)),
    top: Math.min(book.top, ...tabs.map((tab) => tab.top)),
    bottom: Math.max(book.bottom, ...tabs.map((tab) => tab.bottom)),
  }
  geometry.journalBounds.width = geometry.journalBounds.right - geometry.journalBounds.left
  geometry.journalBounds.height = geometry.journalBounds.bottom - geometry.journalBounds.top
  assert.ok(book.x >= 0 && book.right <= viewport.width, `${label}: cover clipped horizontally`)
  assert.equal(geometry.layout, viewport.width < 1100 || viewport.height < 640 ? 'single' : 'spread', `${label}: Make responsive breakpoint`)
  assert.deepEqual(geometry.layers.stacks, ['7', '7'], `${label}: physical stacks`)
  assert.equal(geometry.layers.bookmarks, '9', `${label}: bookmarks below paper`)
  assert.equal(geometry.layers.paper, '10', `${label}: live paper`)
  assert.equal(geometry.layers.rings, '25', `${label}: book hardware above the moving page leaf`)
  assert.equal(geometry.decorationIntercepts, false, `${label}: decorative layer intercepts clicks`)
  if (geometry.layout === 'spread') {
    assert.ok(book.y >= 0 && book.bottom <= viewport.height, `${label}: cover clipped vertically: ${JSON.stringify(book)}`)
    assert.ok(Math.abs(left.width - right.width) < 1, `${label}: unequal page widths`)
    assert.ok(Math.abs(left.height - right.height) < 1, `${label}: unequal page heights`)
    assert.ok(Math.abs(spine.x + spine.width / 2 - book.x - book.width / 2) < 1, `${label}: spine off center`)
    assert.ok(Math.abs(right.width / right.height - .74) < .002, `${label}: source portrait paper ratio`)
    assert.equal(geometry.layers.spread, 'auto', `${label}: desktop spread traps bookmark stacking`)
    assert.ok(tabs.every((tab) => tab.attachedDistance >= 23.5 && tab.attachedDistance <= 38.5), `${label}: source tab insertion/translation`)
  } else {
    assert.equal(geometry.scrollport.overflowY, 'auto', `${label}: missing single-page scrollport`)
    assert.ok(tabs.every((tab) => tab.attachedDistance >= 11.5 && tab.attachedDistance <= 20.5), `${label}: source top-tab insertion/translation`)
  }
  for (const tab of tabs) {
    assert.ok(tab.x >= 0 && tab.right <= viewport.width && tab.y >= 0, `${label}: tab clipped: ${tab.label}`)
    assert.ok(tab.interactive, `${label}: tab label covered: ${tab.label}`)
    assert.ok(tab.rootOccluded, `${label}: bookmark root is painted/hit above live paper: ${tab.label}`)
    assert.equal(tab.decoration, 'none', `${label}: unsupported active underline`)
    assert.deepEqual([tab.transform.a, tab.transform.b, tab.transform.c, tab.transform.d], [1, 0, 0, 1], `${label}: rotated/scaled bookmark`)
    const expectedTabHeight = geometry.layout === 'spread' ? 46 : 54
    assert.ok(Math.abs(tab.height - expectedTabHeight) <= 0.01, `${label}: source tab height (${tab.height}px; expected ${expectedTabHeight}px ±0.01px)`)
    if (geometry.layout === 'spread') assert.equal(tab.width, 130, `${label}: source tab width`)
    if (geometry.layout === 'single') assert.ok(tab.extendedHit, `${label}: missing transparent top hit area`)
    // Exposed top strips are 34–42px high, plus 10 transparent interactive pixels
    // above them. The buried portion remains covered by actual paper.
    assert.ok(tab.width >= 44, `${label}: small tab width`)
  }
  return geometry
}
