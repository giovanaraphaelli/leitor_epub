import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ePub, { type Book as EpubBook, type Contents, type NavItem, type Rendition } from 'epubjs'
import { ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getBook } from '@/lib/db/books'
import { getProgress, saveProgress } from '@/lib/db/progress'
import { useThemeStore } from '@/store/theme-store'
import ReaderSettings from '@/components/reader/ReaderSettings'
import TableOfContents from '@/components/reader/TableOfContents'
import type { ColumnLayout, Theme } from '@/lib/db/schema'
import readerFontsUrl from '@/styles/reader-fonts.css?url'

const SPREAD_BY_COLUMNS: Record<ColumnLayout, { spread: string; minWidth: number }> = {
  single: { spread: 'none', minWidth: 800 },
  double: { spread: 'always', minWidth: 0 },
  auto: { spread: 'auto', minWidth: 800 },
}

// TOC hrefs are relative to the nav document that declares them (e.g.
// "OEBPS/Text/ch1.html" when nav.xhtml sits at the archive root), but
// rendition.display() only matches hrefs in the form the spine stores them:
// relative to the OPF package's own folder (e.g. "Text/ch1.html" when the
// OPF lives in "OEBPS/"). book.canonical() re-resolves against the *wrong*
// base for this case and makes it worse (doubles the "OEBPS/" prefix), so
// instead we strip leading path segments one at a time until one matches an
// actual spine entry.
function resolveTocHref(book: EpubBook, href: string): string {
  const [path, fragment] = href.split('#')
  const withFragment = (candidate: string) => (fragment ? `${candidate}#${fragment}` : candidate)

  if (book.spine.get(path)) return href

  const segments = path.split('/')
  for (let i = 1; i < segments.length; i++) {
    const candidate = segments.slice(i).join('/')
    if (book.spine.get(candidate)) return withFragment(candidate)
  }

  return href
}

// Applied both before the very first display() (so the book paginates once,
// with final settings, instead of laying out unstyled and then reflowing —
// a reflow after display can shift which CFI is "currently displayed",
// which then gets saved over the position the person actually left off at)
// and again whenever the theme changes while already reading.
function applyTheme(rendition: Rendition, theme: Theme) {
  rendition.themes.default({
    body: {
      background: `${theme.background} !important`,
      color: `${theme.textColor} !important`,
      'font-family': `${theme.fontFamily} !important`,
    },
    // The book's own stylesheet usually sets line-height directly on text
    // elements (p, li, etc.), which wins over an inherited value from body
    // regardless of !important — inheritance doesn't compete on specificity.
    // Targeting the elements directly is what actually overrides it.
    'p, li, blockquote, div, span, td': {
      'line-height': `${theme.lineHeight} !important`,
    },
  })
  rendition.themes.fontSize(`${theme.fontSize}px`)

  const { spread, minWidth } = SPREAD_BY_COLUMNS[theme.columns]
  rendition.spread(spread, minWidth)
}

export default function Reader() {
  const { bookId } = useParams<{ bookId: string }>()
  const navigate = useNavigate()
  const viewerRef = useRef<HTMLDivElement>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const bookRef = useRef<EpubBook | null>(null)
  const [loading, setLoading] = useState(true)
  const [toc, setToc] = useState<NavItem[]>([])
  const [currentHref, setCurrentHref] = useState<string>()
  const [percentage, setPercentage] = useState<number>()
  const activeTheme = useThemeStore((s) => s.activeTheme)

  useEffect(() => {
    if (!bookId || !viewerRef.current) return
    let cancelled = false

    async function open() {
      const record = await getBook(bookId!)
      if (!record || cancelled) return

      const arrayBuffer = await record.fileBlob.arrayBuffer()
      const book = ePub(arrayBuffer)
      bookRef.current = book

      // book.locations.generate() walks the spine loading and unloading each
      // Section to measure it — but Section load/unload isn't safe to run
      // concurrently with the rendition reading from those same Section
      // objects to display the current page. Running both against the same
      // Book crashed inside epub.js (Locations' queue callback reading
      // `._locations` on a Section state torn down mid-load). A second,
      // independent Book parsed from the same bytes has its own Sections, so
      // the two can run at the same time safely — this is also what avoids
      // blocking the first page on a multi-second scan of the whole book.
      const locationsBook = ePub(arrayBuffer.slice(0))
      const locationsReady = (async () => {
        await locationsBook.ready
        await locationsBook.locations.generate(1024)
      })()

      const rendition = book.renderTo(viewerRef.current!, {
        width: '100%',
        height: '100%',
        flow: 'paginated',
      })
      renditionRef.current = rendition

      // The book's content renders in its own iframe document, which doesn't
      // inherit stylesheets from the main page — the palette fonts need to be
      // injected directly into each rendered section.
      rendition.hooks.content.register((contents: Contents) => {
        contents.addStylesheet(readerFontsUrl)
      })

      applyTheme(rendition, activeTheme)

      const progress = await getProgress(bookId!)
      if (!cancelled) setPercentage(progress?.percentage)

      // display() resolves once the section is attached, but settling on the
      // exact CFI offset inside a paginated section can finish slightly
      // later — awaiting display() alone let the loading overlay clear while
      // still showing the section's first page, flashing the wrong spot
      // before it caught up to the saved position. Register the listener
      // before displaying and also wait for the first relocated event so the
      // overlay stays up until the position has actually settled.
      let resolveFirstRelocation: (() => void) | undefined
      const firstRelocation = new Promise<void>((resolve) => {
        resolveFirstRelocation = resolve
      })

      // locationsBook.locations is empty until locationsReady resolves — in
      // that window there's nothing meaningful to compute, so callers get
      // undefined back and should keep showing/saving the last known value
      // instead of overwriting it with a bogus 0%.
      const percentageForCfi = (cfi: string): number | undefined =>
        locationsBook.locations.length() > 1
          ? Math.round(locationsBook.locations.percentageFromCfi(cfi) * 100)
          : undefined

      rendition.on(
        'relocated',
        (location: { start: { cfi: string; href: string } }) => {
          resolveFirstRelocation?.()
          resolveFirstRelocation = undefined
          setCurrentHref(location.start.href)

          const computedPercentage = percentageForCfi(location.start.cfi)
          const roundedPercentage = computedPercentage ?? (progress?.percentage ?? 0)
          if (computedPercentage !== undefined) setPercentage(roundedPercentage)
          saveProgress({
            bookId: bookId!,
            cfi: location.start.cfi,
            percentage: roundedPercentage,
            lastReadAt: Date.now(),
          })
        }
      )

      await rendition.display(progress?.cfi ?? undefined)
      await firstRelocation

      // If locationsBook finishes generating after the initial display, the
      // relocated event above had nothing to compute percentage from yet.
      // Recompute it now for the current position — reading rendition.location
      // directly, not re-calling display()/reportLocation(), since either
      // would re-touch the rendition just to recompute a number that has
      // nothing to do with it.
      locationsReady.then(() => {
        const cfi = renditionRef.current?.location?.start?.cfi
        const roundedPercentage = cfi ? percentageForCfi(cfi) : undefined
        if (!cancelled && cfi && roundedPercentage !== undefined) {
          setPercentage(roundedPercentage)
          saveProgress({ bookId: bookId!, cfi, percentage: roundedPercentage, lastReadAt: Date.now() })
        }
      })

      const navigation = await book.loaded.navigation
      if (!cancelled) setToc(navigation.toc)

      if (!cancelled) setLoading(false)
    }

    open()

    return () => {
      cancelled = true
      renditionRef.current?.destroy()
      bookRef.current?.destroy()
      // locationsBook is deliberately not destroyed here: destroying it
      // while its own generate() is still mid-flight is the same crash this
      // whole separate-Book approach exists to avoid. It's unused after
      // `cancelled` flips, so it just finishes generating in the background
      // and gets garbage-collected once nothing references it anymore.
    }
    // activeTheme is intentionally excluded: this effect should only re-run
    // (recreating the whole book/rendition) when the book itself changes.
    // The theme value it reads is just whatever's current at open time; live
    // theme changes while already reading are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId])

  // Handles live updates when the person changes the theme/settings panel
  // while already reading. The initial application (before the first
  // display()) happens inside the open() effect above.
  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition || loading) return
    applyTheme(rendition, activeTheme)
  }, [activeTheme, loading])

  // Icons and text in the reader chrome use the `text-foreground` /
  // `text-muted-foreground` / `hover:bg-muted` utilities, which read CSS
  // variables — not the book's per-theme colors. Overriding those variables
  // here (scoped to this subtree) makes the chrome follow the active theme
  // instead of the app's global light/dark colors, which otherwise made
  // icons unreadable (and hover backgrounds mismatched) against a dark theme.
  // Presets only ever use 6-digit hex colors, so appending an alpha suffix
  // for the hover background is safe.
  const themeVars = {
    background: activeTheme.background,
    color: activeTheme.textColor,
    '--foreground': activeTheme.textColor,
    '--muted-foreground': activeTheme.textColor,
    '--muted': `${activeTheme.textColor}1a`,
  } as CSSProperties

  return (
    <div className="flex h-screen flex-col" style={themeVars}>
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft />
          </Button>
          <TableOfContents
            toc={toc}
            currentHref={currentHref}
            onNavigate={(href) => {
              const book = bookRef.current
              const rendition = renditionRef.current
              if (book && rendition) {
                rendition.display(resolveTocHref(book, href)).catch(console.error)
              }
            }}
          />
        </div>
        <div className="flex items-center gap-3">
          {percentage !== undefined && (
            <span className="text-sm text-muted-foreground">{percentage}%</span>
          )}
          <ReaderSettings />
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            Carregando livro...
          </div>
        )}
        <div ref={viewerRef} className="h-full w-full" />

        <button
          aria-label="Página anterior"
          onClick={() => renditionRef.current?.prev()}
          className="absolute inset-y-0 left-0 flex w-12 cursor-pointer items-center justify-center text-foreground opacity-50 transition-opacity hover:opacity-100"
        >
          <ChevronLeft />
        </button>
        <button
          aria-label="Próxima página"
          onClick={() => renditionRef.current?.next()}
          className="absolute inset-y-0 right-0 flex w-12 cursor-pointer items-center justify-center text-foreground opacity-50 transition-opacity hover:opacity-100"
        >
          <ChevronRight />
        </button>
      </div>
    </div>
  )
}
