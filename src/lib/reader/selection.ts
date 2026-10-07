import type { Contents, Rendition } from 'epubjs'
import { Mark } from 'marks-pane'
import { mergeLineRects, type Box, type LineBox } from './line-rects'

// The documents of the book's rendered sections (epub.js renders each in an iframe).
function bookDocuments(viewer: HTMLElement): Document[] {
  return [...viewer.querySelectorAll<HTMLIFrameElement>('iframe')].flatMap((iframe) =>
    iframe.contentDocument ? [iframe.contentDocument] : []
  )
}

export function clearSelections(viewer: HTMLElement) {
  for (const doc of bookDocuments(viewer)) doc.getSelection()?.removeAllRanges()
}

export function hasSelection(viewer: HTMLElement): boolean {
  return bookDocuments(viewer).some((doc) => {
    const selection = doc.getSelection()
    return !!selection && !selection.isCollapsed && selection.toString() !== ''
  })
}

type RenderedView = {
  highlights?: Record<string, unknown>
  contents?: Contents
  pane?: { render(): void }
}

// epub.js types views() as an array but hands back its Views collection.
function renderedViews(rendition: Rendition): RenderedView[] {
  const views = rendition.views() as unknown as { all?: () => RenderedView[] }
  return views.all?.() ?? []
}

// The text nodes a range touches, in document order.
function textNodesIn(range: Range): Text[] {
  const root = range.commonAncestorContainer
  if (root.nodeType === Node.TEXT_NODE) return [root as Text]
  const walker = (root.ownerDocument ?? (root as Document)).createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (range.intersectsNode(node)) nodes.push(node as Text)
  }
  return nodes
}

// One box per line of the text a range covers, in the range's document's
// coordinates. range.getClientRects() is no use for drawing or hit-testing a
// highlight: for a range that spans paragraphs it also returns each whole
// paragraph's box (the indent, the blank end of the last line), and a line's
// own box that pokes a hair outside its paragraph's got drawn over it a second
// time, darker.
export function lineRects(range: Range): LineBox[] {
  const boxes: Box[] = []
  for (const text of textNodesIn(range)) {
    const part = text.ownerDocument.createRange()
    part.selectNodeContents(text)
    if (text === range.startContainer) part.setStart(text, range.startOffset)
    if (text === range.endContainer) part.setEnd(text, range.endOffset)
    for (const rect of part.getClientRects()) {
      if (rect.width >= 1 && rect.height >= 1) boxes.push(rect)
    }
  }
  return mergeLineRects(boxes)
}

// marks-pane draws a highlight from filteredRanges(), by default its range's own
// rects. Replaced here for every highlight there will ever be: epub.js attaches
// a section's saved highlights itself, the moment the section is rendered, so
// nothing of ours could reshape them in time to keep the first frame clean.
Mark.prototype.filteredRanges = function (this: { range: Range }) {
  return lineRects(this.range)
}

// Redraws the highlights' shapes. marks-pane only recomputes them when the view
// is reframed, which epub.js does when the view changes size — so a reflow that
// keeps it the same size (another font family, fonts arriving late) would leave
// them where the text used to be.
export function repaintHighlights(rendition: Rendition) {
  for (const view of renderedViews(rendition)) view.pane?.render()
}

// The range of a saved highlight, through the view epub.js attached it to.
// contents.range() only follows the path inside whatever document it's asked
// about and never checks the chapter, so asking the wrong one returns a bogus
// range rather than failing.
export function highlightRange(rendition: Rendition, cfiRange: string): Range | undefined {
  for (const view of renderedViews(rendition)) {
    if (!view.highlights || !(cfiRange in view.highlights)) continue
    try {
      return view.contents?.range(cfiRange)
    } catch {
      return undefined
    }
  }
  return undefined
}

// A finger isn't exact, and the lines of a highlight have a sliver of page
// between them: a tap this far above or below a line still counts as on it.
const HIT_SLOP = 8

// The highlight (its cfiRange) under a screen point, or undefined. On a phone
// the gesture surface gets the tap, not the highlight's own SVG inside the
// book, so the annotation's click callback never fires there.
export function highlightAtPoint(rendition: Rendition, clientX: number, clientY: number): string | undefined {
  for (const view of renderedViews(rendition)) {
    const frame = view.contents?.document.defaultView?.frameElement
    if (!view.highlights || !frame) continue
    const { left, top } = frame.getBoundingClientRect()
    const x = clientX - left
    const y = clientY - top
    // Newest first: the one drawn on top is the one the finger meant.
    for (const cfiRange of Object.keys(view.highlights).reverse()) {
      let range: Range | undefined
      try {
        range = view.contents?.range(cfiRange)
      } catch {
        continue
      }
      for (const rect of range ? lineRects(range) : []) {
        if (x >= rect.left && x <= rect.right && y >= rect.top - HIT_SLOP && y <= rect.bottom + HIT_SLOP) return cfiRange
      }
    }
  }
  return undefined
}

// A range's box in viewport coordinates, from the parts of it that are on
// screen. Its rects are in the book iframe's own coordinates, and the iframe
// slides left as pages turn, so the iframe's own rect maps them to the screen;
// a highlight that crosses a page break has rects on a page that isn't showing
// (past the book's container, which clips it, however wide the window is).
export function rangeViewportRect(range: Range): { top: number; bottom: number; left: number; right: number } | null {
  const frame = range.startContainer.ownerDocument?.defaultView?.frameElement
  if (!frame) return null
  const origin = frame.getBoundingClientRect()
  const container = frame.closest('.epub-container')?.getBoundingClientRect()
  const visibleLeft = container ? container.left : 0
  const visibleRight = container ? container.right : window.innerWidth
  let top = Infinity
  let bottom = -Infinity
  let left = Infinity
  let right = -Infinity
  for (const rect of lineRects(range)) {
    const x1 = origin.left + rect.left
    const x2 = origin.left + rect.right
    if (x2 <= visibleLeft || x1 >= visibleRight) continue
    top = Math.min(top, origin.top + rect.top)
    bottom = Math.max(bottom, origin.top + rect.bottom)
    left = Math.min(left, x1)
    right = Math.max(right, x2)
  }
  return top === Infinity ? null : { top, bottom, left, right }
}
