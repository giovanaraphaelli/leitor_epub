import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ePub, { type Book as EpubBook, type NavItem, type Rendition } from 'epubjs'
import { ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getBook } from '@/lib/db/books'
import { getProgress, saveProgress } from '@/lib/db/progress'
import { useThemeStore } from '@/store/theme-store'
import ReaderSettings from '@/components/reader/ReaderSettings'
import TableOfContents from '@/components/reader/TableOfContents'
import type { ColumnLayout } from '@/lib/db/schema'

const SPREAD_BY_COLUMNS: Record<ColumnLayout, { spread: string; minWidth: number }> = {
  single: { spread: 'none', minWidth: 800 },
  double: { spread: 'always', minWidth: 0 },
  auto: { spread: 'auto', minWidth: 800 },
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

  return (
    <div className="flex h-screen flex-col" style={{ background: activeTheme.background }}>
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft />
          </Button>
          <TableOfContents
            toc={toc}
            currentHref={currentHref}
            onNavigate={(href) => renditionRef.current?.display(href)}
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
          className="absolute inset-y-0 left-0 flex w-12 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft />
        </button>
        <button
          aria-label="Próxima página"
          onClick={() => renditionRef.current?.next()}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <ChevronRight />
        </button>
      </div>
    </div>
  )
}
