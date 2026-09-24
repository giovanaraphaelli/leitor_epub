import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/store/theme-store";
import type { NavItem } from "epubjs";
import { BookOpen } from "lucide-react";
import type { CSSProperties } from "react";

interface TableOfContentsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  toc: NavItem[];
  activeTocId?: string;
  onNavigate: (href: string) => void;
}

function TocList({
  items,
  activeTocId,
  onNavigate,
}: {
  items: NavItem[];
  activeTocId?: string;
  onNavigate: (href: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const isActive = item.id === activeTocId;
        return (
          <li key={item.id}>
            <button
              onClick={() => onNavigate(item.href)}
              aria-current={isActive ? "true" : undefined}
              className={cn(
                "flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted max-sm:py-2.5",
                isActive && "font-semibold",
              )}
            >
              {isActive && <BookOpen className="size-3.5 shrink-0" />}
              {item.label.trim()}
            </button>
            {item.subitems && item.subitems.length > 0 && (
              <div className="ml-3 border-l pl-2">
                <TocList
                  items={item.subitems}
                  activeTocId={activeTocId}
                  onNavigate={onNavigate}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Open state lives in the reader, which has two triggers for this panel (the
// header on desktop, the bottom bar on phones).
export default function TableOfContents({
  open,
  onOpenChange,
  toc,
  activeTocId,
  onNavigate,
}: TableOfContentsProps) {
  const activeTheme = useThemeStore((s) => s.activeTheme);

  function handleNavigate(href: string) {
    onNavigate(href);
    onOpenChange(false);
  }

  // Sheet/Dialog content renders through a portal to document.body, outside
  // the reader's theme-scoped subtree — same reasoning as Reader.tsx's
  // themeVars, needed again here since this doesn't inherit that override.
  const themeVars = {
    background: activeTheme.background,
    color: activeTheme.textColor,
    "--foreground": activeTheme.textColor,
    "--muted-foreground": activeTheme.textColor,
    "--muted": `${activeTheme.textColor}1a`,
  } as CSSProperties;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="data-[side=left]:border-r-0 max-sm:data-[side=left]:w-full"
        style={themeVars}
      >
        <SheetHeader>
          <SheetTitle>Sumário</SheetTitle>
        </SheetHeader>

        <div className="overflow-y-auto px-4">
          <TocList
            items={toc}
            activeTocId={activeTocId}
            onNavigate={handleNavigate}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
