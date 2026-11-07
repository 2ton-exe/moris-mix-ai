export interface ReadingMeasurement {
  id: string
  section: string
  height: number
  headingHeight: number
}

/** Keep paragraph separators and a final single newline verbatim. */
export function readingParagraphs(text: string): string[] {
  const paragraphs: string[] = []
  let offset = 0
  for (const boundary of text.matchAll(/\r?\n[\t ]*\r?\n/g)) {
    const end = boundary.index + boundary[0].length
    paragraphs.push(text.slice(offset, end))
    offset = end
  }
  if (offset < text.length) paragraphs.push(text.slice(offset))
  return paragraphs
}

/** Keep semantic entries whole. An entry larger than a leaf gets its own fallback. */
export function paginateReading(items: ReadingMeasurement[], capacity: number): string[][] {
  if (!Number.isFinite(capacity) || capacity <= 0) return [items.map((item) => item.id)]
  const pages: string[][] = []
  let page: string[] = []
  let used = 0
  let previous = ''
  for (const item of items) {
    const height = item.height - (previous === item.section ? item.headingHeight : 0)
    const gap = page.length ? 10 : 0
    if (page.length && used + gap + height > capacity) {
      pages.push(page)
      page = []
      used = 0
      previous = ''
    }
    used += (page.length ? 10 : 0) + item.height - (previous === item.section ? item.headingHeight : 0)
    page.push(item.id)
    previous = item.section
  }
  if (page.length) pages.push(page)
  return pages.length ? pages : [[]]
}

/** The identity is physical leaf zero; desktop turns show two subsequent leaves. */
export function readingSpreads(pages: string[][], single: boolean): string[][][] {
  const leaves = [['identity'], ...pages]
  if (single) return leaves.map((leaf) => [leaf])
  const spreads: string[][][] = []
  for (let index = 0; index < leaves.length; index += 2) spreads.push(leaves.slice(index, index + 2))
  return spreads
}
