import type { Contents, Rendition } from 'epubjs'

// Letters, digits and combining marks: a book stored decomposed (NFD) writes
// "é" as "e" plus a combining accent, which must not end the word.
const isWordChar = (ch: string) => /^[\p{L}\p{M}\p{N}]$/u.test(ch)
// Apostrophes and hyphens, including the soft hyphen (U+00AD) that
// pre-hyphenated books put inside words and the Unicode hyphens U+2010/U+2011.
const isJoiner = (ch: string) => /^['\u2019\u00AD\u2010\u2011-]$/u.test(ch)

// Start and end (exclusive) of the word under `offset`, or null when the
// point isn't on one. An offset right after a word counts as on it: a caret
// hit-test returns the gap between characters, not the character itself.
export function wordBoundsAt(text: string, offset: number): [number, number] | null {
  if (text.length === 0) return null
  let i = Math.min(Math.max(offset, 0), text.length)
  if (i === text.length || !isWordChar(text[i])) {
    if (i > 0 && isWordChar(text[i - 1])) i -= 1
    else return null
  }
  // An apostrophe or hyphen only belongs to the word between two letters
  // ("d’água", "guarda-chuva"), not at its edges.
  const inWord = (k: number) =>
    k >= 0 &&
    k < text.length &&
    (isWordChar(text[k]) ||
      (isJoiner(text[k]) && k > 0 && k < text.length - 1 && isWordChar(text[k - 1]) && isWordChar(text[k + 1])))
  let start = i
  while (inWord(start - 1)) start--
  let end = i + 1
  while (inWord(end)) end++
  return [start, end]
}

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
}

function caretAt(doc: Document, x: number, y: number): { node: Node; offset: number } | null {
  if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y)
    return range ? { node: range.startContainer, offset: range.startOffset } : null
  }
  const position = (doc as CaretDocument).caretPositionFromPoint?.(x, y)
  return position ? { node: position.offsetNode, offset: position.offset } : null
}

// The iframe is as wide as the whole chapter and slides left as pages turn, so
// its own rect — not the viewer's — maps a screen point to a document point
// (same reasoning as forwardTapToLink in Reader.tsx).
function iframeDocuments(viewer: HTMLElement) {
  return [...viewer.querySelectorAll<HTMLIFrameElement>('iframe')].flatMap((iframe) => {
    const doc = iframe.contentDocument
    return doc ? [{ doc, iframe }] : []
  })
}

// How far from a word a press may land and still select it, about a
// fingertip. caretRangeFromPoint snaps to the nearest text, so without a limit
// a press on blank space would select whichever word happens to be closest.
const PRESS_SLOP = 16

function isNear(range: Range, x: number, y: number) {
  for (const rect of range.getClientRects()) {
    if (
      x >= rect.left - PRESS_SLOP &&
      x <= rect.right + PRESS_SLOP &&
      y >= rect.top - PRESS_SLOP &&
      y <= rect.bottom + PRESS_SLOP
    ) {
      return true
    }
  }
  return false
}

// Selects the word under a screen point. Returns false when the point isn't
// on, or within a fingertip of, a word — or when nothing ends up selected — so
// the long press does nothing instead of switching the selection mode on with
// nothing to show for it.
export function selectWordAt(viewer: HTMLElement, clientX: number, clientY: number): boolean {
  for (const { doc, iframe } of iframeDocuments(viewer)) {
    const { left, top } = iframe.getBoundingClientRect()
    const x = clientX - left
    const y = clientY - top
    const caret = caretAt(doc, x, y)
    if (!caret || caret.node.nodeType !== Node.TEXT_NODE) continue
    const bounds = wordBoundsAt((caret.node as Text).data, caret.offset)
    if (!bounds) continue
    const range = doc.createRange()
    range.setStart(caret.node, bounds[0])
    range.setEnd(caret.node, bounds[1])
    if (!isNear(range, x, y)) continue
    const selection = doc.getSelection()
    if (!selection) continue
    selection.removeAllRanges()
    selection.addRange(range)
    // A book with user-select: none leaves a range that selects nothing.
    if (selection.toString() === '') {
      selection.removeAllRanges()
      continue
    }
    return true
  }
  return false
}

export function clearSelections(viewer: HTMLElement) {
  for (const { doc } of iframeDocuments(viewer)) doc.getSelection()?.removeAllRanges()
}

type RenderedView = { highlights?: Record<string, unknown>; contents?: Contents }

// epub.js types views() as an array but hands back its Views collection.
function renderedViews(rendition: Rendition): RenderedView[] {
  const views = rendition.views() as unknown as { all?: () => RenderedView[] }
  return views.all?.() ?? []
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
    for (const cfiRange of Object.keys(view.highlights)) {
      let range: Range | undefined
      try {
        range = view.contents?.range(cfiRange)
      } catch {
        continue
      }
      for (const rect of range?.getClientRects() ?? []) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return cfiRange
      }
    }
  }
  return undefined
}

// The side of the screen the sheet should come from: the one away from the
// text, so it never covers what was picked.
export function sheetSideFor(range: Range): 'top' | 'bottom' {
  const frame = range.startContainer.ownerDocument?.defaultView?.frameElement
  if (!frame) return 'bottom'
  const { top: frameTop } = frame.getBoundingClientRect()
  const { top, bottom } = range.getBoundingClientRect()
  return frameTop + (top + bottom) / 2 > window.innerHeight / 2 ? 'top' : 'bottom'
}

export function hasSelection(viewer: HTMLElement): boolean {
  return iframeDocuments(viewer).some(({ doc }) => {
    const selection = doc.getSelection()
    return !!selection && !selection.isCollapsed && selection.toString() !== ''
  })
}
