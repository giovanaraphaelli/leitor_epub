// The book's selection is followed by reading it from outside the book a few
// times a second, not by listening for selectionchange inside it: epub.js
// sandboxes the book's iframe without allow-scripts, and WebKit (Safari, and
// every browser on iOS) runs no listener at all in such a document, not even
// one this page added. Each read is reduced to a key that changes whenever the
// selection does; this decides what the popover does about it.

export interface WatchState {
  // The selection last read (null: nothing selected).
  key: string | null
  // How many reads in a row have seen it unchanged.
  stable: number
  // Whether the popover was asked to show for it.
  shown: boolean
}

// show: a selection has held still; hide: it moved under a showing popover;
// close: it's gone, and the surface goes back over the book.
export type WatchAction = 'show' | 'hide' | 'close' | null

// Reads in a row a selection must hold before the popover shows, so it doesn't
// chase a pin that is being dragged.
export const STABLE_READS = 2

export const IDLE: WatchState = { key: null, stable: 0, shown: false }

export function stepWatch(state: WatchState, key: string | null): { state: WatchState; action: WatchAction } {
  if (key === null) return { state: IDLE, action: state.key === null ? null : 'close' }
  if (key !== state.key) return { state: { key, stable: 1, shown: false }, action: state.shown ? 'hide' : null }
  const stable = state.stable + 1
  if (!state.shown && stable >= STABLE_READS) return { state: { key, stable, shown: true }, action: 'show' }
  return { state: { key, stable, shown: state.shown }, action: null }
}
