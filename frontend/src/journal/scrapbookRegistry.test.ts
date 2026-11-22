import { expect, it } from 'vitest'
import { scrapbookRegistry } from './scrapbookRegistry'

it('registers one standalone SVG asset per sticker identifier', () => {
  const files = import.meta.glob<string>('../assets/stickers/*.svg', { query: '?raw', import: 'default', eager: true })
  const sources = Object.values(scrapbookRegistry).map(({ src }) => src)
  expect(new Set(sources).size).toBe(sources.length)

  for (const [name, { src }] of Object.entries(scrapbookRegistry)) {
    expect(src.split('?')[0]).toBe(`/src/assets/stickers/${name}.svg`)
    const file = files[`../assets/stickers/${name}.svg`]
    expect(file).toBeTypeOf('string')
    const artwork = new DOMParser().parseFromString(file, 'image/svg+xml')
    expect(artwork.documentElement.localName).toBe('svg')
    expect(artwork.documentElement.getAttribute('viewBox')).toMatch(/^[-.\d]+ [-.\d]+ [\d.]+ [\d.]+$/)
    expect(artwork.querySelector('parsererror, script, image')).toBeNull()
  }
})
