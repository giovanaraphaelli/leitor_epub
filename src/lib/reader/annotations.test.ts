import { describe, expect, it } from 'vitest'
import { byBookOrder, cfiSteps, compareCfi } from './annotations'

const first = 'epubcfi(/6/4!/4/2,/1:0,/1:5)'
const sameParagraphLater = 'epubcfi(/6/4!/4/2,/1:30,/1:40)'
const laterParagraph = 'epubcfi(/6/4!/4/6,/1:3,/1:9)'
const nextChapter = 'epubcfi(/6/6!/4/2,/1:0,/1:4)'
const farChapter = 'epubcfi(/6/14!/4/2,/1:0,/1:4)'

describe('cfiSteps', () => {
  it('reads the start of a range: spine, path and offset, without id assertions', () => {
    expect(cfiSteps('epubcfi(/6/4[cap1]!/4[corpo]/2,/1:30,/1:40)')).toEqual([6, 4, 4, 2, 1, 30])
  })
})

describe('compareCfi', () => {
  it('orders by chapter, then paragraph, then offset', () => {
    expect(compareCfi(first, sameParagraphLater)).toBeLessThan(0)
    expect(compareCfi(sameParagraphLater, laterParagraph)).toBeLessThan(0)
    expect(compareCfi(laterParagraph, nextChapter)).toBeLessThan(0)
  })

  it('compares steps as numbers, not as text', () => {
    expect(compareCfi(nextChapter, farChapter)).toBeLessThan(0)
    expect(compareCfi('epubcfi(/6/4!/4/2,/1:9,/1:12)', 'epubcfi(/6/4!/4/2,/1:10,/1:12)')).toBeLessThan(0)
  })

  it('ignores id assertions', () => {
    expect(compareCfi('epubcfi(/6/4[cap1]!/4[corpo]/2,/1:0,/1:5)', first)).toBe(0)
  })
})

describe('byBookOrder', () => {
  it('puts highlights in reading order, older first where they start together', () => {
    const items = [
      { id: 'd', cfiRange: nextChapter, createdAt: 1 },
      { id: 'c', cfiRange: laterParagraph, createdAt: 2 },
      { id: 'a2', cfiRange: first, createdAt: 9 },
      { id: 'a1', cfiRange: first, createdAt: 3 },
    ]
    expect(byBookOrder(items).map((item) => item.id)).toEqual(['a1', 'a2', 'c', 'd'])
  })
})
