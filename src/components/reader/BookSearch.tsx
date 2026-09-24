import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { BookOpen, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useThemeStore } from "@/store/theme-store";

export interface SearchResult {
  cfi: string;
  excerpt: string;
  chapterLabel?: string;
}

interface BookSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSearch: (query: string) => Promise<SearchResult[]>;
  onNavigate: (cfi: string) => void;
}

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 400;

// epub.js's own search lowercases both sides to match, so finding *where* the
// match landed has to do the same — but the excerpt itself is sliced at that
// offset from the original string, keeping whatever capitalization the book
// actually uses instead of forcing it to lowercase too.
function highlightMatch(excerpt: string, query: string) {
  const index = excerpt.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return excerpt;

  return (
    <>
      {excerpt.slice(0, index)}
      <mark className="bg-transparent font-semibold text-current underline">
        {excerpt.slice(index, index + query.length)}
      </mark>
      {excerpt.slice(index + query.length)}
    </>
  );
}

interface ResultGroup {
  chapterLabel?: string;
  items: SearchResult[];
}

// performSearch scans the book one section at a time, so results already
// arrive grouped by chapter — this only has to notice where one run of
// matching chapterLabels ends and the next begins, not sort or bucket
// anything. Collapsing consecutive same-chapter results under one header is
// what actually fixes the repetition seen in testing (query "capítulo" — a
// chapter title repeats through its whole first paragraph — showed the same
// "Capítulo 1" label five times in a row before this).
//
// Items with no chapterLabel never merge with each other, even sitting next
// to each other in the array: chapterLabelForHref (Reader.tsx) can come back
// undefined for every result if the toc hasn't finished loading yet when a
// search runs (right after opening a book, before book.loaded.navigation
// resolves) — reproduced by searching immediately on open. Ungrouped, a
// missing label just meant no header on that one result; grouping them by
// equality would instead collapse the *entire* result list into one
// undifferentiated block, since undefined === undefined.
function groupByChapter(results: SearchResult[]): ResultGroup[] {
  const groups: ResultGroup[] = [];
  for (const result of results) {
    const current = groups.at(-1);
    if (
      current &&
      result.chapterLabel !== undefined &&
      current.chapterLabel === result.chapterLabel
    ) {
      current.items.push(result);
    } else {
      groups.push({ chapterLabel: result.chapterLabel, items: [result] });
    }
  }
  return groups;
}

// Open state lives in the reader, which has two triggers for this panel (the
// header on desktop, the bottom bar on phones).
export default function BookSearch({
  open,
  onOpenChange,
  onSearch,
  onNavigate,
}: BookSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>();
  // Which query `results` actually answers — compared against the live query
  // below instead of a separate "searching" boolean: the moment the query
  // changes, this is already stale, so "searching" falls out of that
  // mismatch for free, including during the debounce wait itself. A separate
  // boolean only flipped true once the debounce timeout fired, which left
  // the *previous* query's results (now paired with the new highlight term,
  // so often not even highlighting anything in them) on screen until then.
  const [resultsQuery, setResultsQuery] = useState<string>();
  const activeTheme = useThemeStore((s) => s.activeTheme);
  // Guards against an older, slower search resolving after a newer one and
  // overwriting its results — typing a second query doesn't cancel the scan
  // already in flight for the first, it just makes this component ignore it.
  const requestIdRef = useRef(0);

  const groupedResults = useMemo(
    () => (results ? groupByChapter(results) : undefined),
    [results],
  );

  const trimmedQuery = query.trim();
  const tooShort =
    trimmedQuery.length > 0 && trimmedQuery.length < MIN_QUERY_LENGTH;
  // Whether `results` (from whatever the last qualifying query was) is still
  // valid to show. Derived from `query` at render time rather than cleared
  // via setState in the effect below — covers the too-short case above *and*
  // an emptied field, which is not "too short" (its length is 0, not >0).
  const canShowResults = trimmedQuery.length >= MIN_QUERY_LENGTH;
  const searching = canShowResults && resultsQuery !== trimmedQuery;

  // "Too short to search" is derived straight from `query` at render time
  // above (tooShort), not stored as its own state — nothing here needs to
  // reset `results` for that case, only skip firing a search.
  useEffect(() => {
    if (trimmedQuery.length < MIN_QUERY_LENGTH) return;

    const requestId = ++requestIdRef.current;
    const timeout = setTimeout(async () => {
      const found = await onSearch(trimmedQuery);
      if (requestIdRef.current === requestId) {
        setResultsQuery(trimmedQuery);
        setResults(found);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [trimmedQuery, onSearch]);

  // The single place open state actually changes, so closing always resets
  // the query — whether triggered by Radix itself (Escape, overlay click,
  // the X button) via onOpenChange, or by picking a result below, which
  // isn't a SheetClose and so never reaches onOpenChange on its own.
  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) setQuery("");
  }

  function handleNavigate(cfi: string) {
    onNavigate(cfi);
    handleOpenChange(false);
  }

  // Sheet content renders through a portal to document.body, outside the
  // reader's theme-scoped subtree — same reasoning as Reader.tsx's themeVars,
  // needed again here since this doesn't inherit that override.
  // --ring and --border are added on top of what TableOfContents needs.
  // --border colors the Input's border (see the Input below — border-color
  // there comes from index.css's `* { @apply border-border ... }` in @layer
  // base, which wins over the Input's own `border-input` class regardless of
  // focus state, so this is what actually controls it) and the dividers
  // between chapter groups further down. --ring colors the clear button's
  // own focus ring. Both blended toward the background with color-mix()
  // rather than the solid text color — the app's own default --ring/--border
  // are a soft mid-tone, and a full-strength theme color read as a much
  // harsher line than that default.
  const ringColor = `color-mix(in oklab, ${activeTheme.textColor} 65%, ${activeTheme.background})`;
  const themeVars = {
    background: activeTheme.background,
    color: activeTheme.textColor,
    "--foreground": activeTheme.textColor,
    "--muted-foreground": activeTheme.textColor,
    "--muted": `${activeTheme.textColor}1a`,
    "--ring": ringColor,
    "--border": ringColor,
  } as CSSProperties;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="left" className="max-sm:data-[side=left]:w-full" style={themeVars}>
        <SheetHeader>
          <SheetTitle>Buscar no livro</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-3 overflow-y-auto px-4">
          {/* type="text", not "search": the native search-field styling (and
              its own clear button, invisible against a dark reading theme
              and unstyleable to match it) varies unpredictably across
              browsers. A plain text input plus a hand-built clear button
              below gets one consistent, themed look everywhere instead. */}
          <div className="relative">
            {/* focus-visible:ring-0 drops the default glow: after several
                rounds of tuning its color, it still read as an odd halo
                around the field rather than a clean focus indicator. The
                border itself (always themed via --border — border-color
                here doesn't actually change on focus, see the --border
                comment above) stays as the only visual boundary. */}
            <Input
              autoFocus
              type="text"
              placeholder="Digite para buscar..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pr-8 focus-visible:ring-0"
            />
            {query.length > 0 && (
              <button
                type="button"
                aria-label="Limpar busca"
                onClick={() => setQuery("")}
                className="absolute inset-y-0 right-0 flex w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          {tooShort && (
            <p className="text-sm text-muted-foreground">
              Digite ao menos {MIN_QUERY_LENGTH} letras.
            </p>
          )}
          {canShowResults && searching && (
            <p className="text-sm text-muted-foreground">Buscando...</p>
          )}
          {canShowResults && !searching && results && results.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum resultado encontrado.
            </p>
          )}
          {canShowResults &&
            !searching &&
            groupedResults &&
            groupedResults.length > 0 && (
              <div className="flex flex-col divide-y divide-border/20">
                {groupedResults.map((group, groupIndex) => (
                  <div
                    key={groupIndex}
                    className="flex flex-col gap-1 py-6 first:pt-0 last:pb-0"
                  >
                    {group.chapterLabel && (
                      <span className="flex items-center gap-1 px-2 text-xs font-medium text-muted-foreground">
                        <BookOpen className="size-3 shrink-0" />
                        {group.chapterLabel}
                      </span>
                    )}
                    <ul className="flex flex-col gap-1">
                      {group.items.map((result, index) => (
                        <li key={`${result.cfi}-${index}`}>
                          <button
                            onClick={() => handleNavigate(result.cfi)}
                            className="w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                          >
                            {highlightMatch(result.excerpt, trimmedQuery)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
