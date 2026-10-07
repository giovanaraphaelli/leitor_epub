import type { CSSProperties } from 'react'
import { Copy, Highlighter, NotebookPen, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { placePopover, type Box } from '@/lib/reader/popover-position'
import { themeTint } from '@/lib/theme-colors'
import { useThemeStore } from '@/store/theme-store'

// 'selection' is a live text selection (the system's handles are on it),
// 'highlight' is a saved highlight that was tapped.
export type SelectionPopoverMode = 'selection' | 'highlight'

// Fixed, so the popover can be placed without measuring it first: three 44 px
// buttons, the two gaps between them, the padding and the border.
const HEIGHT = 62
const WIDTH = 166

interface SelectionPopoverProps {
  mode: SelectionPopoverMode
  // The text's box on screen; the popover sits against it.
  anchor: Box
  onCopy: () => void
  onHighlight: () => void
  // Highlights the selection and opens the note editor on it.
  onHighlightWithNote: () => void
  // Opens the note editor on the tapped highlight.
  onNote: () => void
  onRemove: () => void
}

export default function SelectionPopover({
  mode,
  anchor,
  onCopy,
  onHighlight,
  onHighlightWithNote,
  onNote,
  onRemove,
}: SelectionPopoverProps) {
  const activeTheme = useThemeStore((s) => s.activeTheme)
  const { top, left } = placePopover(
    anchor,
    { width: WIDTH, height: HEIGHT },
    { width: window.innerWidth, height: window.innerHeight }
  )
  // The reader's own scope sets --foreground, --muted and --border; the buttons
  // also read --primary, --background, --input and --ring, which it doesn't.
  const style = {
    top,
    left,
    width: WIDTH,
    height: HEIGHT,
    // Tinted, not the page's own color, or on a dark palette the popover
    // dissolves into the book behind it (same as ReaderSettings).
    background: themeTint(activeTheme, 5),
    color: activeTheme.textColor,
    '--background': activeTheme.background,
    '--primary': activeTheme.textColor,
    '--primary-foreground': activeTheme.background,
    '--input': themeTint(activeTheme, 20),
    '--ring': themeTint(activeTheme, 65),
  } as CSSProperties

  return (
    <div
      data-selection-popover
      role="group"
      aria-label="Ações do trecho"
      // Pressing a button must not take focus, and with it the selection, out of
      // the book. On mousedown, where focus moves: WebKit drops the click of a
      // tap whose pointerdown was cancelled.
      onMouseDown={(event) => event.preventDefault()}
      className="fixed z-40 flex items-center gap-2 rounded-xl border p-2 shadow-lg duration-100 animate-in fade-in-0 zoom-in-95"
      style={style}
    >
      <Button variant="outline" size="icon" className="size-11" aria-label="Copiar" title="Copiar" onClick={onCopy}>
        <Copy className="size-5" />
      </Button>
      {mode === 'selection' ? (
        <>
          <Button size="icon" className="size-11" aria-label="Grifar" title="Grifar" onClick={onHighlight}>
            <Highlighter className="size-5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-11"
            aria-label="Grifar com nota"
            title="Grifar com nota"
            onClick={onHighlightWithNote}
          >
            <NotebookPen className="size-5" />
          </Button>
        </>
      ) : (
        <>
          <Button variant="outline" size="icon" className="size-11" aria-label="Nota" title="Nota" onClick={onNote}>
            <NotebookPen className="size-5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-11"
            aria-label="Remover grifo"
            title="Remover grifo"
            onClick={onRemove}
          >
            <Trash2 className="size-5" />
          </Button>
        </>
      )}
    </div>
  )
}
