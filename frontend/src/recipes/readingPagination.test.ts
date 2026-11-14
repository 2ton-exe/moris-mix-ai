import { expect, it } from 'vitest'
import { paginateReading, readingParagraphs, readingSpreads, type ReadingMeasurement } from './readingPagination'

const row = (id: string, section = 'ingredients', height = 60): ReadingMeasurement => ({ id, section, height, headingHeight: 20 })

it('keeps paragraph boundaries and every original newline, including a final single LF or CRLF', () => {
  for (const text of ['', 'A note.\n', 'A note.\r\n', 'First\r\n \r\nLast\r\n', '\n\n', '\t \n', 'First\n\nSecond\n\n']) {
    expect(readingParagraphs(text).join('')).toBe(text)
  }
  expect(readingParagraphs('First\r\n\r\nLast\r\n')).toEqual(['First\r\n\r\n', 'Last\r\n'])
})

it('packs complete rows, charging a section heading only at a section or leaf boundary', () => {
  expect(paginateReading([row('a'), row('b'), row('c'), row('d', 'method')], 160)).toEqual([['a', 'b', 'c'], ['d']])
  expect(paginateReading([row('a'), row('b'), row('c')], 100)).toEqual([['a'], ['b'], ['c']])
})
it('isolates a whole oversized entry without dropping it or looping', () => {
  expect(paginateReading([row('a'), row('long', 'method', 2000), row('b')], 100)).toEqual([['a'], ['long'], ['b']])
})
it.each([0, -1, NaN, Infinity])('retains all entries when dimensions cannot be measured (%s)', (capacity) => {
  expect(paginateReading([row('a'), row('b')], capacity)).toEqual([['a', 'b']])
})
it('preserves every semantic entry exactly once across different capacities', () => {
  const rows = Array.from({ length: 150 }, (_, index) => row(String(index), index < 60 ? 'ingredients' : 'method', 20 + index * 7 % 190))
  for (const capacity of [80, 190, 270, 500, 700]) expect(paginateReading(rows, capacity).flat()).toEqual(rows.map((item) => item.id))
})
it('groups facing continuation leaves after identity and reflows them into ordered single leaves', () => {
  const pages = [['a', 'b'], ['c'], ['d']]
  expect(readingSpreads(pages, false)).toEqual([[['identity'], ['a', 'b']], [['c'], ['d']]])
  expect(readingSpreads(pages, true)).toEqual([[['identity']], [['a', 'b']], [['c']], [['d']]])
})
