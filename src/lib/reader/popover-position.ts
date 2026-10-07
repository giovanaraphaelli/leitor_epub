export interface Box {
  top: number
  bottom: number
  left: number
  right: number
}

export interface PopoverPlacement {
  top: number
  left: number
  side: 'below' | 'above'
}

// What the system's selection handles hang below the text.
const HANDLE_ROOM = 28
const GAP = 8
const EDGE = 8

// Where a popover of `size` goes for text occupying `text` (viewport
// coordinates): centered under it, past the handles; above it when there's no
// room below; always inside the viewport horizontally.
export function placePopover(
  text: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number }
): PopoverPlacement {
  const centre = (text.left + text.right) / 2
  const left = Math.min(
    Math.max(centre - size.width / 2, EDGE),
    Math.max(viewport.width - size.width - EDGE, EDGE)
  )
  const below = text.bottom + HANDLE_ROOM + GAP
  if (below + size.height <= viewport.height - EDGE) return { top: below, left, side: 'below' }
  const above = text.top - size.height - GAP
  if (above >= EDGE) return { top: above, left, side: 'above' }
  // Neither side fits (a tall selection): keep it on screen, over the text.
  const top = Math.min(Math.max(below, EDGE), Math.max(viewport.height - size.height - EDGE, EDGE))
  return { top, left, side: 'below' }
}
