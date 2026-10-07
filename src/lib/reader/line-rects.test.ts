import { describe, expect, it } from 'vitest'
import { mergeLineRects } from './line-rects'

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })

describe('mergeLineRects', () => {
  it('gives nothing for nothing', () => {
    expect(mergeLineRects([])).toEqual([])
  })

  it('keeps a lone box and adds its size', () => {
    expect(mergeLineRects([box(10, 20, 110, 44)])).toEqual([{ left: 10, top: 20, right: 110, bottom: 44, width: 100, height: 24 }])
  })

  it('joins the pieces of one line that touch (an emphasised word in the middle of it)', () => {
    const line = mergeLineRects([box(10, 20, 60, 44), box(60, 20, 90, 44), box(90.5, 20, 200, 44)])
    expect(line).toEqual([{ left: 10, top: 20, right: 200, bottom: 44, width: 190, height: 24 }])
  })

  it('joins pieces that overlap, such as a shifted span over the text beside it', () => {
    const line = mergeLineRects([box(10, 20, 62, 44), box(59, 20, 200, 44)])
    expect(line).toHaveLength(1)
    expect(line[0]).toMatchObject({ left: 10, right: 200 })
  })

  it('takes the taller box when a piece of the line is set in a bigger size', () => {
    const line = mergeLineRects([box(10, 22, 60, 42), box(60, 18, 120, 46)])
    expect(line).toEqual([{ left: 10, top: 18, right: 120, bottom: 46, width: 110, height: 28 }])
  })

  it('keeps pieces of one line apart when there is room between them (another column)', () => {
    expect(mergeLineRects([box(10, 20, 100, 44), box(380, 20, 470, 44)])).toHaveLength(2)
  })

  it('keeps different lines apart, even where they are stacked flush', () => {
    const lines = mergeLineRects([box(10, 20, 200, 44), box(10, 44, 180, 68), box(10, 68, 120, 92)])
    expect(lines.map((line) => [line.top, line.bottom])).toEqual([
      [20, 44],
      [44, 68],
      [68, 92],
    ])
  })

  it('does not hand the same line twice to the next one', () => {
    const lines = mergeLineRects([box(10, 20, 50, 44), box(50, 20, 100, 44), box(10, 49, 90, 73), box(90, 49, 130, 73)])
    expect(lines).toHaveLength(2)
  })
})
