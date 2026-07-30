import { useState, type CSSProperties } from 'react'
import { ListTree, BookOpen } from 'lucide-react'
import type { NavItem } from 'epubjs'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { useThemeStore } from '@/store/theme-store'

interface TableOfContentsProps {
  toc: NavItem[]
  activeTocId?: string
  onNavigate: (href: string) => void
}

function TocList({
  items,
  activeTocId,
  onNavigate,
}: {
  items: NavItem[]
  activeTocId?: string
  onNavigate: (href: string) => void
}) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const isActive = item.id === activeTocId
        return (
          <li key={item.id}>
            <button
              onClick={() => onNavigate(item.href)}
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                'flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                isActive && 'font-semibold'
              )}
            >
              {isActive && <BookOpen className="size-3.5 shrink-0" />}
              {item.label.trim()}
            </button>
            {item.subitems && item.subitems.length > 0 && (
              <div className="ml-3 border-l pl-2">
                <TocList items={item.subitems} activeTocId={activeTocId} onNavigate={onNavigate} />
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default function TableOfContents({ toc, activeTocId, onNavigate }: TableOfContentsProps) {
  const [open, setOpen] = useState(false)
  const activeTheme = useThemeStore((s) => s.activeTheme)

  function handleNavigate(href: string) {
    onNavigate(href)
    setOpen(false)
  }

  // Sheet/Dialog content renders through a portal to document.body, outside
  // the reader's theme-scoped subtree — same reasoning as Reader.tsx's
  // themeVars, needed again here since this doesn't inherit that override.
  const themeVars = {
    background: activeTheme.background,
    color: activeTheme.textColor,
    '--foreground': activeTheme.textColor,
    '--muted-foreground': activeTheme.textColor,
    '--muted': `${activeTheme.textColor}1a`,
  } as CSSProperties

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Sumário" disabled={toc.length === 0}>
          <ListTree />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" style={themeVars}>
        <SheetHeader>
          <SheetTitle>Sumário</SheetTitle>
        </SheetHeader>

        <div className="overflow-y-auto px-4">
          <TocList items={toc} activeTocId={activeTocId} onNavigate={handleNavigate} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
