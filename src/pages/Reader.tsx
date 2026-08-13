import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ePub, { EpubCFI, type Book as EpubBook, type Contents, type NavItem, type Rendition } from 'epubjs'
import { ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getBook } from '@/lib/db/books'
import { getProgress, saveProgress } from '@/lib/db/progress'
import { useThemeStore } from '@/store/theme-store'
import ReaderSettings from '@/components/reader/ReaderSettings'
import TableOfContents from '@/components/reader/TableOfContents'
import type { ColumnLayout, Theme } from '@/lib/db/schema'
import readerFontsUrl from '@/styles/reader-fonts.css?url'

// minWidth applies even to 'always': epub.js only switches to 2 columns once
// the container is at least that wide (see Layout.calculate in its source),
// so a forced-double layout still falls back to a single column on a narrow
// phone screen instead of squeezing two illegibly thin columns onto it.
const SPREAD_BY_COLUMNS: Record<ColumnLayout, { spread: string; minWidth: number }> = {
  single: { spread: 'none', minWidth: 800 },
  double: { spread: 'always', minWidth: 800 },
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

function flattenNavItems(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => [item, ...(item.subitems ? flattenNavItems(item.subitems) : [])])
}

// Several TOC entries often share the same file (each pointing at a
// different heading inside it via #fragment) — matching by file alone
// highlights all of them at once. To pick just the one actually on screen,
// compare each candidate's own position against the currently displayed
// range using CFIs, which is what they're for — comparing pixel positions
// doesn't work here: the iframe is sized to the *entire* flowed content
// (tens of thousands of pixels wide for a whole chapter), not the current
// page, so every heading's bounding rect looks "on screen". The last entry
// at or before the current position is the active one; entries with no
// fragment (representing the start of the file) always count as reached,
// as a fallback before the first heading in the file.
function computeActiveTocId(
  rendition: Rendition,
  book: EpubBook,
  toc: NavItem[],
  currentHref: string
): string | undefined {
  const location = rendition.location
  const section = book.spine.get(currentHref)
  if (!location || !section) return undefined

  const contentsList = rendition.getContents() as unknown as Contents[]
  const cfi = new EpubCFI()
  const candidates = flattenNavItems(toc).filter(
    (item) => resolveTocHref(book, item.href).split('#')[0] === currentHref
  )

  let activeId: string | undefined
  for (const item of candidates) {
    const fragment = item.href.split('#')[1]
    if (!fragment) {
      activeId = item.id
      continue
    }

    const el = contentsList.map((c) => c.document?.getElementById(fragment)).find(Boolean)
    if (!el) continue

    const elCfi = section.cfiFromElement(el)
    if (cfi.compare(elCfi, location.end.cfi) <= 0) activeId = item.id
  }

  return activeId
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

// Skips page-turning when the key press originates inside the settings
// sheet — Slider and ToggleGroup both use ArrowLeft/ArrowRight themselves
// (to change a value or move focus between items), so turning the page at
// the same time would fight the control being operated. This check is a
// no-op for keydowns from inside the book's iframe (a separate document with
// no sheet element in it), which is exactly where it should be a no-op.
function handleArrowKeyNavigation(rendition: Rendition, event: KeyboardEvent) {
  if (event.target instanceof Element && event.target.closest('[data-slot="sheet-content"]')) return
  if (event.key === 'ArrowLeft') rendition.prev()
  else if (event.key === 'ArrowRight') rendition.next()
}

const SWIPE_MIN_DISTANCE = 50
// Anything that moves less than this in both axes is a tap, not a swipe that
// fell short — the gesture surface forwards those to the book (see onTap).
const TAP_MAX_DISTANCE = 10

// Set by the on-screen debug overlay (see TouchDebugOverlay) when the reader
// is opened with ?debug in the URL. Exists because the one browser where the
// gesture misbehaves — WebKit on iOS — can't be remote-inspected from this
// machine, so the only way to observe it is to draw the trace on the device
// itself instead of guessing at what the engine did.
const touchDebug: { log?: (line: string) => void } = {}

// Swiping is the only way to turn pages on a phone: the arrow buttons are
// hidden below `sm` (they cost ~16% of the screen width there) and keyboard
// shortcuts obviously don't apply. epub.js only ships swipe handling for its
// `continuous` manager with `snap` enabled — this reader uses the `default`
// manager — so the gesture is wired up by hand.
//
// The primary target is a transparent surface laid over the book *in this
// document* (see the JSX), not the book's iframe. Listening inside the iframe
// is the obvious approach (and what epub.js's own swipe recipe does), but three
// attempts at it never turned a page on iOS, so the gesture was moved out of
// the iframe to the one place where nothing about the environment is in doubt:
//   - nothing in this document scrolls (the reader is h-dvh/overflow-hidden and
//     epub.js's own container is overflow:hidden), so WebKit has no native pan
//     to claim mid-gesture and cancel the swipe for;
//   - the surface declares its own touch-action, rather than depending on a
//     rule injected into a document epub.js also styles and re-styles;
//   - no second browsing context in the path, and no iframe viewport meta —
//     epub.js writes one declaring a width far narrower than the iframe it
//     renders into, and engines disagree about what to do with that.
// The in-iframe registration stays as a fallback for input setups where the
// surface isn't mounted at all (see isTouchDevice); the two never both fire,
// since a mounted surface is what receives the touch instead of the iframe.
// There it has to target `document.documentElement` rather than `document`:
// registering on both would double-fire, since the event bubbles through
// documentElement and then document, and each registration keeps its own
// independent gesture state.
//
// Returns its own cleanup so callers can unregister.
function registerSwipeNavigation(
  target: EventTarget,
  getRendition: () => Rendition | null,
  label: string,
  onTap?: (clientX: number, clientY: number) => void
) {
  let startX = 0
  let startY = 0
  let lastX = 0
  let lastY = 0
  let tracking = false
  let moves = 0

  function onTouchStart(event: Event) {
    const { touches, changedTouches } = event as TouchEvent
    // A second finger means a pinch, not a page turn.
    if (touches.length !== 1) {
      tracking = false
      touchDebug.log?.(`${label} start IGNORADO (dedos=${touches.length})`)
      return
    }
    tracking = true
    moves = 0
    startX = lastX = changedTouches[0].clientX
    startY = lastY = changedTouches[0].clientY
    touchDebug.log?.(`${label} start x=${Math.round(startX)}`)
  }

  // The end of the gesture isn't always reported by touchend: WebKit fires
  // touchcancel instead whenever it decides mid-gesture that the touch belongs
  // to a native scroll, and it hands over no coordinates when it does. Keeping
  // the latest position from touchmove means the swipe can still be resolved
  // from whatever was last seen, instead of being dropped silently.
  function onTouchMove(event: Event) {
    if (!tracking) return
    const touch = (event as TouchEvent).changedTouches[0]
    if (!touch) return
    lastX = touch.clientX
    lastY = touch.clientY
    moves++
  }

  function settle(reason: string) {
    if (!tracking) {
      touchDebug.log?.(`${label} ${reason} sem gesto ativo`)
      return
    }
    tracking = false

    const deltaX = lastX - startX
    const deltaY = lastY - startY
    const rendition = getRendition()
    touchDebug.log?.(
      `${label} ${reason} dx=${Math.round(deltaX)} dy=${Math.round(deltaY)} moves=${moves} pronto=${!!rendition}`
    )

    if (
      reason === 'end' &&
      Math.abs(deltaX) < TAP_MAX_DISTANCE &&
      Math.abs(deltaY) < TAP_MAX_DISTANCE
    ) {
      touchDebug.log?.(`${label} toque simples`)
      onTap?.(lastX, lastY)
      return
    }

    if (!rendition) return
    // Require a deliberate, mostly-horizontal move so that a long-press to
    // select text or a vertical drag doesn't turn the page.
    if (Math.abs(deltaX) < SWIPE_MIN_DISTANCE || Math.abs(deltaX) <= Math.abs(deltaY)) {
      touchDebug.log?.(`${label} descartado (curto ou vertical)`)
      return
    }

    touchDebug.log?.(`${label} VIRANDO ${deltaX < 0 ? 'proxima' : 'anterior'}`)
    if (deltaX < 0) rendition.next()
    else rendition.prev()
  }

  function onTouchEnd(event: Event) {
    const touch = (event as TouchEvent).changedTouches?.[0]
    if (tracking && touch) {
      lastX = touch.clientX
      lastY = touch.clientY
    }
    settle('end')
  }

  const onTouchCancel = () => settle('cancel')

  target.addEventListener('touchstart', onTouchStart, { passive: true })
  target.addEventListener('touchmove', onTouchMove, { passive: true })
  target.addEventListener('touchend', onTouchEnd, { passive: true })
  target.addEventListener('touchcancel', onTouchCancel, { passive: true })
  touchDebug.log?.(`${label} listeners registrados`)

  return () => {
    target.removeEventListener('touchstart', onTouchStart)
    target.removeEventListener('touchmove', onTouchMove)
    target.removeEventListener('touchend', onTouchEnd)
    target.removeEventListener('touchcancel', onTouchCancel)
  }
}

// A tap can't reach a link inside the book while the gesture surface is over
// it — the surface is what receives the touch. epub.js assigns its own onclick
// to every internal link when it renders a section (replaceLinks in its
// source), so re-dispatching the click on whatever sits under the finger is
// enough to keep footnote and cross-reference links working.
function forwardTapToLink(viewer: HTMLElement, clientX: number, clientY: number) {
  for (const iframe of viewer.querySelectorAll<HTMLIFrameElement>('iframe')) {
    const doc = iframe.contentDocument
    if (!doc) continue
    // The iframe is as wide as the whole chapter and slides left as pages
    // turn, so it's its own rect — not the viewer's — that maps a point on
    // screen to a point in the document inside it.
    const { left, top } = iframe.getBoundingClientRect()
    // Typed via the generic instead of an `instanceof HTMLElement` check: the
    // element comes from the iframe's realm, so it's an instance of *that*
    // document's HTMLElement and the check would always be false here.
    const link = doc
      .elementFromPoint(clientX - left, clientY - top)
      ?.closest<HTMLAnchorElement>('a[href]')
    if (link) {
      link.click()
      return
    }
  }
}

// Draws the touch trace on the device, shown only when the reader is opened
// with ?debug in the URL. iOS can't be remote-inspected from a Windows
// machine, so without this the only feedback from the one engine that
// misbehaves is "não virou" — which is what turned the last two rounds into
// guesswork. Reports which listener fired, the resulting deltas, and the
// computed touch-action inside the iframe, so the failure can be read off
// the screen instead of inferred.
function TouchDebugOverlay() {
  const [lines, setLines] = useState<string[]>([])
  const [env, setEnv] = useState('')

  useEffect(() => {
    touchDebug.log = (line) => setLines((prev) => [...prev.slice(-9), line])
    return () => {
      touchDebug.log = undefined
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      const surface = document.querySelector('[data-swipe-surface]')
      setEnv(
        [
          `iframe=${document.querySelector('iframe') ? 'sim' : 'nao'}`,
          `superficie=${surface ? getComputedStyle(surface).touchAction : 'NAO'}`,
          `rolagem=${document.documentElement.scrollHeight > window.innerHeight ? 'SIM' : 'nao'}`,
        ].join(' · ')
      )
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-50 max-h-[45%] overflow-hidden bg-black/85 p-2 font-mono text-[10px] leading-tight text-lime-300">
      <div className="mb-1 text-white">{env}</div>
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  )
}

export default function Reader() {
  const { bookId } = useParams<{ bookId: string }>()
  const navigate = useNavigate()
  // Opt-in per visit (?debug), never on by default: this is a diagnostic for
  // a device that can't be inspected any other way, not a feature.
  const [debugTouch] = useState(() => new URLSearchParams(window.location.search).has('debug'))
  // The surface only goes up where touch is the primary input: it sits on top
  // of the book, so it also swallows text selection and, with a mouse, would
  // swallow every click. `pointer: coarse` is the query for "the main pointer
  // is a finger" — a laptop with both a touchscreen and a trackpad reports
  // `fine`, and keeps mouse behaviour exactly as it is today.
  const [isTouchDevice] = useState(() => window.matchMedia('(pointer: coarse)').matches)
  const viewerRef = useRef<HTMLDivElement>(null)
  const swipeSurfaceRef = useRef<HTMLDivElement>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const bookRef = useRef<EpubBook | null>(null)
  const tocRef = useRef<NavItem[]>([])
  // renderTo() hands back a Rendition immediately, but its view manager is
  // attached asynchronously — calling next()/prev() before that lands throws
  // from inside epub.js ("Cannot read properties of undefined (reading
  // 'next')"), so a null check on the rendition alone isn't enough to know
  // it's safe to page. Flipped once the first display has actually settled.
  const canPageRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [toc, setToc] = useState<NavItem[]>([])
  const [activeTocId, setActiveTocId] = useState<string>()
  const [percentage, setPercentage] = useState<number>()
  const [bookTitle, setBookTitle] = useState<string>()
  const activeTheme = useThemeStore((s) => s.activeTheme)
  // Tracks which (rendition, theme) pair has already been applied, so the
  // live-update effect below can tell "loading just flipped to false" apart
  // from "the theme actually changed" — see that effect's comment.
  const appliedThemeRef = useRef<{ rendition: Rendition; theme: Theme } | null>(null)

  useEffect(() => {
    if (!bookId || !viewerRef.current) return
    let cancelled = false
    canPageRef.current = false

    async function open() {
      const record = await getBook(bookId!)
      if (!record || cancelled) return
      setBookTitle(record.title)

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
        // Keydown events inside the iframe never reach the main document's
        // own listener (separate browsing context) — each rendered section
        // needs its own.
        contents.document.addEventListener('keydown', (e: KeyboardEvent) =>
          handleArrowKeyNavigation(rendition, e)
        )
        // Same reasoning for touch. No cleanup needed: epub.js tears down the
        // whole iframe document when it unrenders a section, taking its
        // listeners with it.
        registerSwipeNavigation(
          contents.document.documentElement,
          () => (canPageRef.current ? rendition : null),
          'livro'
        )
      })

      applyTheme(rendition, activeTheme)
      appliedThemeRef.current = { rendition, theme: activeTheme }

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
          setActiveTocId(computeActiveTocId(rendition, book, tocRef.current, location.start.href))

          const computedPercentage = percentageForCfi(location.start.cfi)
          const roundedPercentage = computedPercentage ?? (progress?.percentage ?? 0)
          // Tells the two possible failures apart on a device that can't be
          // inspected: a gesture that never fired logs nothing, while a
          // gesture that fired without the page moving logs the swipe and no
          // relocation after it.
          touchDebug.log?.(`relocated ${roundedPercentage}%`)
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
      // The view manager is attached and a page is on screen, so the
      // page-turn controls (buttons, arrow keys, swipe) are safe to use now.
      if (!cancelled) canPageRef.current = true

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
      tocRef.current = navigation.toc
      if (!cancelled) {
        setToc(navigation.toc)
        const href = renditionRef.current?.location?.start?.href
        if (href) setActiveTocId(computeActiveTocId(rendition, book, navigation.toc, href))
      }

      if (!cancelled) setLoading(false)
    }

    open()

    return () => {
      cancelled = true
      canPageRef.current = false
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

  // Covers keydowns that land on the main document instead of the book's
  // iframe — e.g. focus is on the header or nothing in particular.
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      const rendition = canPageRef.current ? renditionRef.current : null
      if (rendition) handleArrowKeyNavigation(rendition, e)
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [])

  // The gesture surface over the book is where swipes are actually handled —
  // see registerSwipeNavigation for why it isn't the book's iframe.
  useEffect(() => {
    const surface = swipeSurfaceRef.current
    const viewer = viewerRef.current
    if (!surface || !viewer) return
    return registerSwipeNavigation(
      surface,
      () => (canPageRef.current ? renditionRef.current : null),
      'superficie',
      (clientX, clientY) => forwardTapToLink(viewer, clientX, clientY)
    )
  }, [])

  // Handles live updates when the person changes the theme/settings panel
  // while already reading. The initial application (before the first
  // display()) happens inside the open() effect above.
  //
  // `loading` is in the dependency array so this can react as soon as a
  // rendition becomes available, but that also means it re-runs the instant
  // `loading` flips to false at the end of open() — with the *same* theme
  // that was already applied there. Guarding on whether this exact
  // (rendition, theme) pair was already applied skips that redundant call
  // without missing a genuine change.
  //
  // For a genuine change, re-displaying at the CFI we were at right before
  // reapplying is not optional: rendition.spread() unconditionally forces a
  // layout recalculation (needed for real column/font-size/font-family
  // changes), but epub.js's paginated manager recomputes page boundaries
  // from scratch on that recalculation and doesn't reliably keep showing the
  // same content — even a *palette-only* change (which touches no layout
  // property at all) was observed moving the visible page. Re-displaying at
  // the pre-reapply CFI re-settles on the exact same reading spot regardless
  // of what actually changed, and — since display() re-fires 'relocated' —
  // also re-saves progress at that same correct position instead of at
  // wherever the relayout happened to land.
  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition) return
    const applied = appliedThemeRef.current
    if (applied && applied.rendition === rendition && applied.theme === activeTheme) return
    appliedThemeRef.current = { rendition, theme: activeTheme }
    const cfi = rendition.location?.start?.cfi
    applyTheme(rendition, activeTheme)
    if (cfi) rendition.display(cfi)
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
    // h-dvh, not h-screen: 100vh on iOS measures the viewport as if the
    // browser's toolbars were hidden, so the reader ended up taller than the
    // space actually visible and the whole page scrolled. The dynamic unit
    // tracks the real visible height as those bars come and go.
    // overflow-hidden/overscroll-none then stop any residual scroll or bounce,
    // which matters beyond looks: a scrollable page lets WebKit treat a swipe
    // as a native scroll and cancel the gesture before it reaches the handler.
    <div className="flex h-dvh flex-col overflow-hidden overscroll-none" style={themeVars}>
      {/* grid (not the earlier absolute-centered title) so the center column
          actually shrinks to make room for the side groups — a long title
          plus the percentage badge could otherwise overlap on narrow phone
          screens, since absolute centering ignores the side groups' widths. */}
      <header className="grid grid-cols-[auto_1fr_auto] items-center gap-2 border-b px-4 py-2">
        <div className="flex items-center">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft />
          </Button>
          <TableOfContents
            toc={toc}
            activeTocId={activeTocId}
            onNavigate={(href) => {
              const book = bookRef.current
              const rendition = renditionRef.current
              if (book && rendition) {
                rendition.display(resolveTocHref(book, href)).catch(console.error)
              }
            }}
          />
        </div>
        <span className="min-w-0 truncate text-center text-sm font-medium">{bookTitle}</span>
        <div className="flex items-center justify-end gap-3">
          {percentage !== undefined && (
            <span className="text-sm text-muted-foreground">{percentage}%</span>
          )}
          <ReaderSettings />
        </div>
      </header>

      {/* The arrows are flex siblings of the book rather than floating over it:
          as real items they reserve their own width, so a line of text can
          never run underneath them the way it could while they were absolutely
          positioned on top. It also keeps their width defined in one place
          instead of having to mirror it as padding on the book container.
          They're hidden entirely on phones, where two strips cost ~16% of the
          screen width and swiping replaces them (registerSwipeNavigation). */}
      <div className="relative flex flex-1 overflow-hidden">
        {loading && (
          // z-10 because the arrows' opacity < 1 gives them their own stacking
          // context, which would otherwise paint them over this overlay.
          <div className="absolute inset-0 z-10 flex items-center justify-center text-muted-foreground">
            Carregando livro...
          </div>
        )}
        {debugTouch && <TouchDebugOverlay />}

        <button
          aria-label="Página anterior"
          onClick={() => renditionRef.current?.prev()}
          disabled={loading}
          className="hidden w-12 shrink-0 cursor-pointer items-center justify-center text-foreground opacity-50 transition-opacity hover:opacity-100 disabled:cursor-not-allowed sm:flex"
        >
          <ChevronLeft />
        </button>

        {/* Breathing room lives on this wrapper, never on the element handed to
            epub.js: epub.js measures that element to size its columns, and
            clientWidth counts padding, so padding applied directly to it makes
            it lay out wider than the space it actually occupies. */}
        <div className="relative min-w-0 flex-1 px-2 py-2 sm:px-3 sm:py-4">
          <div ref={viewerRef} className="h-full w-full" />
          {/* Gesture surface: transparent, covers the book, and is a sibling
              *after* the viewer so it paints over the iframe without needing a
              z-index. It deliberately stops at the book — laying it over the
              whole row would cover the arrow buttons on a touch tablet.
              touch-none is what stops WebKit from claiming a horizontal drag
              as a native pan and cancelling the gesture; nothing here scrolls,
              so no scrolling is lost. Pinch-zoom over the book is, and the
              font size control in the settings panel covers that need. */}
          {isTouchDevice && (
            <div
              ref={swipeSurfaceRef}
              data-swipe-surface
              aria-hidden
              className="absolute inset-0 touch-none"
            />
          )}
        </div>

        <button
          aria-label="Próxima página"
          onClick={() => renditionRef.current?.next()}
          disabled={loading}
          className="hidden w-12 shrink-0 cursor-pointer items-center justify-center text-foreground opacity-50 transition-opacity hover:opacity-100 disabled:cursor-not-allowed sm:flex"
        >
          <ChevronRight />
        </button>
      </div>
    </div>
  )
}
