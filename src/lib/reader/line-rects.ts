export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface LineBox extends Box {
  width: number
  height: number
}

// Pieces of a line closer than this are one box (rounding leaves hairline gaps).
const JOIN_GAP = 1.5
// Two boxes are on the same line when they share at least this much of the
// shorter one's height; flush neighbours on the next line share none.
const SAME_LINE = 0.5

function sameLine(a: Box, b: Box): boolean {
  const shared = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return shared >= SAME_LINE * Math.min(a.bottom - a.top, b.bottom - b.top)
}

function lineBox({ left, top, right, bottom }: Box): LineBox {
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

// The boxes of a run of text, in reading order, with the pieces that sit on one
// line and touch joined into a single box. A highlight is drawn from these
// instead of from a range's own rects, which also hold the whole box of every
// paragraph inside the range (the indent and the blank end of each last line
// included) and so drew some lines twice, darker.
export function mergeLineRects(boxes: Box[]): LineBox[] {
  const lines: LineBox[] = []
  for (const box of boxes) {
    const last = lines[lines.length - 1]
    if (last && sameLine(last, box) && box.left <= last.right + JOIN_GAP && box.right >= last.left - JOIN_GAP) {
      lines[lines.length - 1] = lineBox({
        left: Math.min(last.left, box.left),
        top: Math.min(last.top, box.top),
        right: Math.max(last.right, box.right),
        bottom: Math.max(last.bottom, box.bottom),
      })
    } else {
      lines.push(lineBox(box))
    }
  }
  return lines
}
