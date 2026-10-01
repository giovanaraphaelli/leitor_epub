import type { CSSProperties } from 'react'
import { Copy, Highlighter, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { themeTint } from '@/lib/theme-colors'
import { cn } from '@/lib/utils'
import { useThemeStore } from '@/store/theme-store'

// 'selection' is a live text selection (the handles are still being dragged),
// 'highlight' is a saved highlight that was tapped.
export type SelectionSheetMode = 'selection' | 'highlight'
export type SelectionSheetSide = 'top' | 'bottom'

interface SelectionSheetProps {
  open: boolean
  mode: SelectionSheetMode
  // Opposite to where the text is, so the sheet never covers what was picked.
  side: SelectionSheetSide
  text: string
  onOpenChange: (open: boolean) => void
  onCopy: () => void
  onHighlight: () => void
  onRemove: () => void
}

export default function SelectionSheet({
  open,
  mode,
  side,
  text,
  onOpenChange,
  onCopy,
  onHighlight,
  onRemove,
}: SelectionSheetProps) {
  const activeTheme = useThemeStore((s) => s.activeTheme)
  // The sheet renders through a portal, outside the reader's theme-scoped
  // subtree, so it carries the palette itself (--primary for the main button).
  const themeVars = {
    background: activeTheme.background,
    color: activeTheme.textColor,
    '--background': activeTheme.background,
    '--foreground': activeTheme.textColor,
    '--muted-foreground': activeTheme.textColor,
    '--muted': `${activeTheme.textColor}1a`,
    '--primary': activeTheme.textColor,
    '--primary-foreground': activeTheme.background,
    '--border': themeTint(activeTheme, 15),
    '--input': themeTint(activeTheme, 20),
    '--ring': themeTint(activeTheme, 65),
  } as CSSProperties

  return (
    // Not modal while a selection is live: the overlay would blur the text
    // being picked and block the page, and the selection handles still have to
    // be dragged with the sheet up. A tapped highlight has nothing to drag, so
    // it gets the usual overlay and a tap outside just closes it.
    <Sheet open={open} onOpenChange={onOpenChange} modal={mode === 'highlight'}>
      <SheetContent
        side={side}
        showCloseButton={false}
        className={cn(
          side === 'bottom' ? 'rounded-t-2xl data-[side=bottom]:border-t-0' : 'rounded-b-2xl data-[side=top]:border-b-0'
        )}
        style={themeVars}
        // Focus stays where it is: moving it, or reacting to it moving into the
        // book's iframe, is what would risk dropping the selection.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle className="sr-only">Trecho selecionado</SheetTitle>
          <SheetDescription className="line-clamp-3 border-l-2 pl-3 italic">“{text}”</SheetDescription>
        </SheetHeader>
        <div className="flex gap-2 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <Button variant="outline" className="flex-1" onClick={onCopy}>
            <Copy /> Copiar
          </Button>
          {mode === 'selection' ? (
            <Button className="flex-1" onClick={onHighlight}>
              <Highlighter /> Grifar
            </Button>
          ) : (
            <Button variant="outline" className="flex-1" onClick={onRemove}>
              <Trash2 /> Remover grifo
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
