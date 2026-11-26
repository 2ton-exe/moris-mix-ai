import { afterEach, expect, it } from 'vitest'
import { focusLoadedJournalContent } from './focus'

afterEach(() => { document.body.replaceChildren() })

it('focuses loaded content while preserving a cook’s interaction with Mori', () => {
  const heading = document.createElement('h1')
  heading.tabIndex = -1
  const mori = document.createElement('button')
  mori.className = 'mori-pet-trigger'
  document.body.append(heading, mori)
  focusLoadedJournalContent(heading)
  expect(document.activeElement).toBe(heading)
  mori.focus()
  focusLoadedJournalContent(heading)
  expect(document.activeElement).toBe(mori)
})
