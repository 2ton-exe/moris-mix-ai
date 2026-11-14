import assert from 'node:assert/strict'

/** Lightweight browser semantic audit for labels, headings and modal names. */
export async function assertJournalSemantics(page, label = 'journal screen') {
  const findings = await page.evaluate(() => {
    const visible = (element) => {
      const style = globalThis.getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
    }
    const referencedText = (element, attribute) => (element.getAttribute(attribute) ?? '')
      .split(/\s+/).filter(Boolean).map((id) => globalThis.document.getElementById(id)?.textContent?.trim() ?? '').join(' ').trim()
    const accessibleName = (element) => {
      const label = element.getAttribute('aria-label')?.trim()
      if (label) return label
      const labelledBy = referencedText(element, 'aria-labelledby')
      if (labelledBy) return labelledBy
      if ('labels' in element && element.labels?.length) {
        const labels = [...element.labels].map((item) => item.textContent?.trim() ?? '').filter(Boolean)
        if (labels.length) return labels.join(' ')
      }
      return element.getAttribute('alt')?.trim() || element.getAttribute('title')?.trim() ||
        element.innerText?.trim() || element.textContent?.trim() || ''
    }
    const issues = []
    for (const element of globalThis.document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]')) {
      if (visible(element) && !accessibleName(element)) issues.push(`unnamed ${element.tagName.toLowerCase()}.${String(element.className ?? '').trim()}`)
      if (visible(element) && element.getAttribute('aria-invalid') === 'true') {
        const described = referencedText(element, 'aria-describedby')
        if (!described) issues.push(`invalid ${element.tagName.toLowerCase()} has no described error`)
      }
    }
    const headings = [...globalThis.document.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter(visible)
    const firstLevel = Number(headings[0]?.tagName.slice(1) ?? 0)
    if (firstLevel !== 1) issues.push(`first visible heading is h${firstLevel || 'none'}`)
    let previousLevel = 0
    for (const heading of headings) {
      const level = Number(heading.tagName.slice(1))
      if (previousLevel && level > previousLevel + 1) issues.push(`heading jump from h${previousLevel} to h${level}`)
      previousLevel = level
    }
    for (const dialog of globalThis.document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
      if (dialog.getAttribute('aria-modal') !== 'true') issues.push('dialog is missing aria-modal=true')
      if (!accessibleName(dialog)) issues.push('dialog has no accessible name')
    }
    return issues
  })
  assert.deepEqual(findings, [], `${label}: ${findings.join('; ')}`)
}
