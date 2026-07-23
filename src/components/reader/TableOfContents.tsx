import { useState } from 'react'
import { ListTree } from 'lucide-react'
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

interface TableOfContentsProps {
  toc: NavItem[]
  currentHref?: string
  onNavigate: (href: string) => void
}

function TocList({
  items,
  currentHref,
  onNavigate,
}: {
  items: NavItem[]
  currentHref?: string
  onNavigate: (href: string) => void
}) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const isActive = currentHref?.endsWith(item.href.split('#')[0])
        return (
          <li key={item.id}>
            <button
              onClick={() => onNavigate(item.href)}
              className={cn(
                'w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                isActive && 'bg-muted font-medium text-foreground'
              )}
            >
              {item.label.trim()}
            </button>
            {item.subitems && item.subitems.length > 0 && (
              <div className="ml-3 border-l pl-2">
                <TocList items={item.subitems} currentHref={currentHref} onNavigate={onNavigate} />
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default function TableOfContents({ toc, currentHref, onNavigate }: TableOfContentsProps) {
  const [open, setOpen] = useState(false)

  function handleNavigate(href: string) {
    onNavigate(href)
    setOpen(false)
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Sumário" disabled={toc.length === 0}>
          <ListTree />
        </Button>
      </SheetTrigger>
      <SheetContent side="left">
        <SheetHeader>
          <SheetTitle>Sumário</SheetTitle>
        </SheetHeader>

        <div className="overflow-y-auto px-4">
          <TocList items={toc} currentHref={currentHref} onNavigate={handleNavigate} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
