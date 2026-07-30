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
import type { ColumnLayout } from '@/lib/db/schema'
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

export default function Reader() {
  const { bookId } = useParams<{ bookId: string }>()
  const navigate = useNavigate()
  const viewerRef = useRef<HTMLDivElement>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const bookRef = useRef<EpubBook | null>(null)
  const [loading, setLoading] = useState(true)
  const [toc, setToc] = useState<NavItem[]>([])
  const [currentHref, setCurrentHref] = useState<string>()
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

      const progress = await getProgress(bookId!)
      await rendition.display(progress?.cfi ?? undefined)

      rendition.on(
        'relocated',
        (location: { start: { cfi: string; href: string; percentage: number } }) => {
          setCurrentHref(location.start.href)
          saveProgress({
            bookId: bookId!,
            cfi: location.start.cfi,
            percentage: Math.round(location.start.percentage * 100),
            lastReadAt: Date.now(),
          })
        }
      )

      const navigation = await book.loaded.navigation
      if (!cancelled) setToc(navigation.toc)

      if (!cancelled) setLoading(false)
    }

    open()

    return () => {
      cancelled = true
      renditionRef.current?.destroy()
      bookRef.current?.destroy()
    }
  }, [bookId])

  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition) return

    rendition.themes.default({
      body: {
        background: `${activeTheme.background} !important`,
        color: `${activeTheme.textColor} !important`,
        'font-family': `${activeTheme.fontFamily} !important`,
      },
      // The book's own stylesheet usually sets line-height directly on text
      // elements (p, li, etc.), which wins over an inherited value from body
      // regardless of !important — inheritance doesn't compete on specificity.
      // Targeting the elements directly is what actually overrides it.
      'p, li, blockquote, div, span, td': {
        'line-height': `${activeTheme.lineHeight} !important`,
      },
    })
    rendition.themes.fontSize(`${activeTheme.fontSize}px`)

    const { spread, minWidth } = SPREAD_BY_COLUMNS[activeTheme.columns]
    rendition.spread(spread, minWidth)
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
        <ReaderSettings />
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
          className="absolute inset-y-0 left-0 flex w-12 items-center justify-center text-foreground opacity-50 transition-opacity hover:opacity-100"
        >
          <ChevronLeft />
        </button>
        <button
          aria-label="Próxima página"
          onClick={() => renditionRef.current?.next()}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-foreground opacity-50 transition-opacity hover:opacity-100"
        >
          <ChevronRight />
        </button>
      </div>
    </div>
  )
}
