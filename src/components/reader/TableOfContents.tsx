import { useState, type CSSProperties } from "react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AnnotationList, {
  type AnnotationItem,
} from "@/components/reader/AnnotationList";
import { cn } from "@/lib/utils";
import { themeTint } from "@/lib/theme-colors";
import { useThemeStore } from "@/store/theme-store";
import type { NavItem } from "epubjs";
import { BookOpen } from "lucide-react";

interface TableOfContentsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  toc: NavItem[];
  activeTocId?: string;
  onNavigate: (href: string) => void;
  annotations: AnnotationItem[];
  onOpenAnnotation: (cfiRange: string) => void;
  onEditNote: (id: string) => void;
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
// header on desktop, the bottom bar on phones). The tab chosen stays while the
// book is open.
export default function TableOfContents({
  open,
  onOpenChange,
  toc,
  activeTocId,
  onNavigate,
  annotations,
  onOpenAnnotation,
  onEditNote,
}: TableOfContentsProps) {
  const activeTheme = useThemeStore((s) => s.activeTheme);
  const [tab, setTab] = useState("toc");

  function handleNavigate(href: string) {
    onNavigate(href);
    onOpenChange(false);
  }

  function handleOpenAnnotation(cfiRange: string) {
    onOpenAnnotation(cfiRange);
    onOpenChange(false);
  }

  // Sheet/Dialog content renders through a portal to document.body, outside
  // the reader's theme-scoped subtree — same reasoning as Reader.tsx's
  // themeVars, needed again here since this doesn't inherit that override.
  // The tabs also read --background (the chosen tab) and --border/--input/--ring.
  const themeVars = {
    background: activeTheme.background,
    color: activeTheme.textColor,
    "--foreground": activeTheme.textColor,
    "--muted-foreground": activeTheme.textColor,
    "--muted": `${activeTheme.textColor}1a`,
    "--background": activeTheme.background,
    "--border": themeTint(activeTheme, 20),
    "--input": themeTint(activeTheme, 20),
    "--ring": themeTint(activeTheme, 65),
  } as CSSProperties;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="data-[side=left]:border-r-0 max-sm:data-[side=left]:w-full"
        style={themeVars}
      >
        <SheetTitle className="sr-only">Sumário e anotações</SheetTitle>
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="min-h-0 flex-1 pt-4"
        >
          {/* Clear of the sheet's close button, top right. */}
          <TabsList className="mr-14 ml-4 grid grid-cols-2 max-sm:h-11">
            <TabsTrigger value="toc">Sumário</TabsTrigger>
            <TabsTrigger value="notes">Anotações</TabsTrigger>
          </TabsList>
          <TabsContent value="toc" className="min-h-0 overflow-y-auto px-4">
            <TocList
              items={toc}
              activeTocId={activeTocId}
              onNavigate={handleNavigate}
            />
          </TabsContent>
          <TabsContent value="notes" className="min-h-0 overflow-y-auto px-4">
            <AnnotationList
              items={annotations}
              onOpen={handleOpenAnnotation}
              onEditNote={onEditNote}
            />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
