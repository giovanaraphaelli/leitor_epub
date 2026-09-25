import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ePub, {
  EpubCFI,
  type Book as EpubBook,
  type Contents,
  type Location,
  type NavItem,
  type Rendition,
} from 'epubjs'
// Not re-exported from epub.js's main entry (unlike Book/Contents/NavItem/
// Rendition above), so it's pulled straight from its own declaration file.
import type Section from 'epubjs/types/section'
import { ChevronLeft, ChevronRight, ArrowLeft, List, Maximize, Minimize, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getBook } from '@/lib/db/books'
import { getProgress, saveProgress } from '@/lib/db/progress'
import { themeTint } from '@/lib/theme-colors'
import { cn } from '@/lib/utils'
import { useThemeStore } from '@/store/theme-store'
import { useReadingPrefsStore } from '@/store/reading-prefs-store'
import { useScreenWakeLock } from '@/hooks/use-screen-wake-lock'
import { DESKTOP_QUERY, useMediaQuery } from '@/hooks/use-media-query'
import { useElementWidth } from '@/hooks/use-element-width'
import ProgressBar from '@/components/ProgressBar'
import ReaderSettings from '@/components/reader/ReaderSettings'
import TableOfContents from '@/components/reader/TableOfContents'
import BookSearch, { type SearchResult } from '@/components/reader/BookSearch'
import type { ColumnLayout, Progress, Theme } from '@/lib/db/schema'
import readerFontsCss from '@/styles/reader-fonts.css?inline'

// minWidth applies even to 'always': epub.js only switches to 2 columns once
// the container is at least that wide (see Layout.calculate in its source),
// so a forced-double layout still falls back to a single column on a narrow
// phone screen instead of squeezing two illegibly thin columns onto it.
const SPREAD_MIN_WIDTH = 800
const SPREAD_BY_COLUMNS: Record<ColumnLayout, { spread: string; minWidth: number }> = {
  single: { spread: 'none', minWidth: SPREAD_MIN_WIDTH },
  double: { spread: 'always', minWidth: SPREAD_MIN_WIDTH },
  auto: { spread: 'auto', minWidth: SPREAD_MIN_WIDTH },
}

// About 70 characters of the reading font per line (45–75 is the comfortable
// range) — in em, so the measure holds as the font size changes. Without a
// cap, one column on a wide screen ran 126–197 characters per line.
const LINE_MAX_EM = 32
// ...but never narrower than that line at the default 18px: in em alone, the
// smallest font squeezed the column to ~380px in the middle of a wide screen.
// Below 18px a smaller font fits more words per line instead of a thinner column.
const LINE_MIN_PX = LINE_MAX_EM * 18
// Horizontal space the book row spends around the book itself: the two
// page-turn margins at their narrowest (w-12) plus the wrapper's padding.
const DESKTOP_FRAME_WIDTH = 2 * 48 + 24
const MOBILE_FRAME_WIDTH = 16

// Width to hand epub.js so its lines come out at LINE_MAX_EM. epub.js pads
// each page by a twelfth of its container (the column gap, Layout.calculate)
// and splits into two columns only from SPREAD_MIN_WIDTH up — so a 32em line
// takes a container of 12/11 of that for one column and 12/5 for two.
function bookWidthFor(available: number, theme: Theme): number {
  const spread = theme.columns !== 'single' && available >= SPREAD_MIN_WIDTH
  const line = Math.max(LINE_MAX_EM * theme.fontSize, LINE_MIN_PX)
  const max = line * (spread ? 12 / 5 : 12 / 11)
  return Math.floor(Math.min(available, max))
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

// The top-level TOC entry holding the active one: subsections ("1.2 …") are
// too fine-grained to label where the reader is in the header.
function chapterLabelFor(toc: NavItem[], activeTocId?: string): string | undefined {
  if (!activeTocId) return undefined
  return toc
    .find((item) => item.id === activeTocId || flattenNavItems(item.subitems ?? []).some((sub) => sub.id === activeTocId))
    ?.label.trim()
}

// Labels a search result with the chapter it was found in. Deliberately
// coarser than computeActiveTocId above: that one picks the exact subsection
// a *currently displayed* position falls under by comparing CFIs one at a
// time, which would mean a CFI comparison per toc entry per match. A search
// can turn up hundreds of matches, so this instead labels every match in a
// section with that section's first toc entry — cheap, and precise enough
// for "which chapter is this result in".
function chapterLabelForHref(book: EpubBook, toc: NavItem[], href: string): string | undefined {
  return flattenNavItems(toc).find((item) => resolveTocHref(book, item.href).split('#')[0] === href)
    ?.label.trim()
}

// A search across the whole book can turn up far more matches than anyone
// would scroll through (a short common word could hit hundreds of times) —
// capped so a broad query stops scanning once the list is already long
// enough to be useless, instead of walking every remaining section for
// matches nobody will see.
const MAX_SEARCH_RESULTS = 200

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

// A font request that hangs (flaky network) mustn't hold the loading overlay
// forever; positioning against the fallback font beats that.
const FONTS_TIMEOUT_MS = 3000
const SETTLE_MAX_ATTEMPTS = 3

function withTimeout(promise: Promise<unknown>, ms: number): Promise<unknown> {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))])
}

function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (remaining: number) =>
      remaining === 0 ? resolve() : requestAnimationFrame(() => step(remaining - 1))
    step(count)
  })
}

function nextRelocation(rendition: Rendition, timeoutMs = 1000): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      rendition.off('relocated', done)
      resolve()
    }
    const timer = setTimeout(done, timeoutMs)
    rendition.on('relocated', done)
  })
}

function waitForFonts(rendition: Rendition): Promise<unknown> {
  const contentsList = rendition.getContents() as unknown as Contents[]
  return withTimeout(
    Promise.all(
      contentsList.map(({ document: doc }) => {
        if (!doc) return
        // Forces a layout pass so the fonts in use are actually requested —
        // otherwise fonts.ready can resolve before any of them starts loading.
        void doc.body?.offsetHeight
        return doc.fonts?.ready
      })
    ),
    FONTS_TIMEOUT_MS
  )
}

function locationContains(location: Location | undefined, cfi: string): boolean {
  if (!location?.start?.cfi || !location.end?.cfi) return false
  const epubCfi = new EpubCFI()
  return epubCfi.compare(cfi, location.start.cfi) >= 0 && epubCfi.compare(cfi, location.end.cfi) <= 0
}

// Whether the book is scrolled to a page boundary. A relayout that changes the
// page width (a font size that widens the book) keeps the old scroll offset,
// which then falls mid-page — a column cut at each edge — while the saved
// position can still count as on screen. Reads epub.js's view manager, which
// the .d.ts doesn't expose.
function isPageAligned(rendition: Rendition): boolean {
  const manager = (rendition as unknown as {
    manager?: { container?: HTMLElement; layout?: { delta: number } }
  }).manager
  const delta = manager?.layout?.delta
  if (!manager?.container || !delta) return true
  const offset = Math.abs(manager.container.scrollLeft) % delta
  return Math.min(offset, delta - offset) <= 1
}

// The part of epub.js's view manager that snapPageTurns reads and replaces.
interface PagingManager {
  container: HTMLElement
  layout: { delta: number }
  isPaginated: boolean
  settings: { axis?: string; direction?: string }
  next(): Promise<void> | undefined
  prev(): Promise<void> | undefined
  scrollTo(x: number, y: number, silent?: boolean): void
}

// epub.js turns a page inside a chapter with `scrollLeft += pageWidth`, and
// moves on to the next chapter once scrollLeft plus two pages passes the
// chapter's width — an exact comparison. With a fractional devicePixelRatio
// (2.625, 2.75… — common on Android) the browser snaps every scroll offset to
// a device pixel, so each turn leaves a sliver of error that the next one
// adds to; on the second-to-last page that sliver fails the comparison and
// the last page of every chapter was skipped. Here the page on screen is
// rounded from the offset and the scroll lands on an exact multiple of the
// page width. Changing chapters is still left to epub.js.
function snapPageTurns(rendition: Rendition) {
  const manager = (rendition as unknown as { manager?: PagingManager }).manager
  if (!manager) return
  const { next, prev } = manager
  const { container } = manager
  const pagedLtr = () =>
    manager.isPaginated &&
    manager.settings.axis === 'horizontal' &&
    (!manager.settings.direction || manager.settings.direction === 'ltr') &&
    manager.layout.delta > 0
  const currentPage = () => Math.round(container.scrollLeft / manager.layout.delta)

  manager.next = () => {
    if (!pagedLtr()) return next.call(manager)
    const { delta } = manager.layout
    const page = currentPage()
    if ((page + 1) * delta + container.offsetWidth <= container.scrollWidth) {
      manager.scrollTo((page + 1) * delta, 0, true)
      return
    }
    return next.call(manager)
  }

  manager.prev = () => {
    if (!pagedLtr()) return prev.call(manager)
    const page = currentPage()
    if (page > 0) {
      manager.scrollTo((page - 1) * manager.layout.delta, 0, true)
      return
    }
    // Any sliver left reads as "not at the start yet" to epub.js, which would
    // scroll back by a page instead of opening the previous chapter.
    if (container.scrollLeft !== 0) manager.scrollTo(0, 0, true)
    return prev.call(manager)
  }
}

// Unlike rendition.location, computed fresh: after a reflow the screen can
// differ from the last position epub.js reported.
function currentLocationOf(rendition: Rendition): Location | undefined {
  try {
    return rendition.currentLocation() as unknown as Location | undefined
  } catch {
    return undefined
  }
}

// epub.js picks the page for a display() target as soon as the section's
// iframe exists, but the theme and the palette fonts only reach that iframe
// afterwards (content hooks, then async font loads). Each reflows the text
// under a fixed scroll offset, so the screen drifts away from the target and
// epub.js never re-seeks. This waits for styling, gives epub.js a few frames
// to re-expand the iframe (ResizeObserver + rAF on its side), and displays
// the target again if it isn't on screen, or the page is misaligned — within
// an already-rendered section that only scrolls, to a whole page. Hrefs can't
// be checked like a CFI, so they're re-displayed once.
async function settleAt(rendition: Rendition, target: string): Promise<void> {
  const isCfi = new EpubCFI().isCfiString(target)
  for (let attempt = 0; attempt < SETTLE_MAX_ATTEMPTS; attempt++) {
    await waitForFonts(rendition)
    await nextFrames(3)
    // destroy() clears `book`: the reader was closed mid-settle.
    if (!rendition.book) return
    const onTarget = isCfi ? locationContains(currentLocationOf(rendition), target) : attempt > 0
    if (onTarget && isPageAligned(rendition)) return
    const relocated = nextRelocation(rendition)
    await rendition.display(target)
    await relocated
  }
}

// The .d.ts requires width/height, but called without them epub.js
// re-measures its container (Stage.size) — and does nothing if that size
// hasn't changed.
function remeasure(rendition: Rendition) {
  ;(rendition as unknown as { resize(): void }).resize()
}

// Re-seeks the saved position after a relayout, one pass at a time. A request
// arriving mid-pass (a font change that also resizes the book, the next step
// of a slider drag) queues one follow-up pass instead of a second settleAt
// whose display() calls would race the first one's.
function createResettler(
  rendition: Rendition,
  anchor: () => string | undefined,
  settling: { current: number }
): () => void {
  let running = false
  let pending = false
  return () => {
    if (running) {
      pending = true
      return
    }
    running = true
    settling.current++
    void (async () => {
      try {
        do {
          pending = false
          const cfi = anchor()
          if (cfi) await settleAt(rendition, cfi).catch(console.error)
        } while (pending && rendition.book)
      } finally {
        running = false
        settling.current--
      }
    })()
  }
}

// Icon buttons (size="icon", a fixed square) that grow a text label from md.
const LABELLED_BUTTON = 'md:w-auto md:gap-1.5 md:px-2.5'

const isFullscreenSupported = typeof document !== 'undefined' && document.fullscreenEnabled

function toggleFullscreen() {
  const change = document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen()
  change.catch(() => {})
}

interface ReaderKeyActions {
  next: () => void
  prev: () => void
  openSearch: () => void
}

// Arrows, PageUp/PageDown and Space (Shift+Space back) turn pages, "/" opens
// the search, F toggles full screen. Left alone: anything with Ctrl/Cmd/Alt
// (browser shortcuts), typing in a field, keys inside a sheet — Slider and
// ToggleGroup use the arrows themselves, so turning the page at the same
// time would fight the control being operated — and Space on a button or
// link, where it means "press this". `closest` rather than `instanceof`
// checks: keydowns from the book's iframe carry elements of that document's
// realm, where an instanceof against this window's classes is always false.
function handleReaderKeydown(event: KeyboardEvent, actions: ReaderKeyActions) {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const target = event.target as Element | null
  const closest = (selector: string) => target?.closest?.(selector)
  if (closest('[data-slot="sheet-content"], input, textarea, select, [contenteditable="true"]')) return

  switch (event.key) {
    case 'ArrowRight':
    case 'PageDown':
      actions.next()
      break
    case 'ArrowLeft':
    case 'PageUp':
      actions.prev()
      break
    case ' ':
      if (closest('button, a[href]')) return
      if (event.shiftKey) actions.prev()
      else actions.next()
      break
    case '/':
      actions.openSearch()
      break
    case 'f':
    case 'F':
      if (!isFullscreenSupported) return
      toggleFullscreen()
      break
    default:
      return
  }
  event.preventDefault()
}

const SWIPE_MIN_DISTANCE = 50
// Anything that moves less than this in both axes is a tap, not a swipe that
// fell short — the gesture surface hands those to onTap (links, then the
// page-turn and show/hide-bars zones, see the surface's effect in Reader).
const TAP_MAX_DISTANCE = 10

// Swiping (or tapping the sides) is how pages turn on a phone: the arrow buttons are
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
  onTap?: (clientX: number, clientY: number) => void
) {
  let startX = 0
  let startY = 0
  let lastX = 0
  let lastY = 0
  let tracking = false

  function onTouchStart(event: Event) {
    const { touches, changedTouches } = event as TouchEvent
    // A second finger means a pinch, not a page turn.
    if (touches.length !== 1) {
      tracking = false
      return
    }
    tracking = true
    startX = lastX = changedTouches[0].clientX
    startY = lastY = changedTouches[0].clientY
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
  }

  function settle(reason: string) {
    if (!tracking) return
    tracking = false

    const deltaX = lastX - startX
    const deltaY = lastY - startY
    const rendition = getRendition()

    if (
      reason === 'end' &&
      Math.abs(deltaX) < TAP_MAX_DISTANCE &&
      Math.abs(deltaY) < TAP_MAX_DISTANCE
    ) {
      onTap?.(lastX, lastY)
      return
    }

    if (!rendition) return
    // Require a deliberate, mostly-horizontal move so that a long-press to
    // select text or a vertical drag doesn't turn the page.
    if (Math.abs(deltaX) < SWIPE_MIN_DISTANCE || Math.abs(deltaX) <= Math.abs(deltaY)) return

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
// enough to keep footnote and cross-reference links working. Returns whether
// there was a link, so the tap isn't also taken as a page turn.
function forwardTapToLink(viewer: HTMLElement, clientX: number, clientY: number): boolean {
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
      return true
    }
  }
  return false
}

export default function Reader() {
  const { bookId } = useParams<{ bookId: string }>()
  const navigate = useNavigate()
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
  // Kept so a search (see performSearch) can spin up its own independent
  // Book from the same bytes on demand — same reasoning as locationsBook
  // below: searching loads and unloads every Section it scans, which isn't
  // safe to run against the same Book the rendition is displaying from.
  const bookBufferRef = useRef<ArrayBuffer | null>(null)
  // Created lazily on the first search rather than eagerly alongside
  // locationsBook, since most reading sessions never open the search panel.
  const searchBookRef = useRef<EpubBook | null>(null)
  // Bumped on every new search and on close/reopen of the book; a scan in
  // flight checks it before touching another section and bails out as soon
  // as it no longer matches, so an abandoned search doesn't keep loading and
  // unloading sections of a book nobody is looking at anymore.
  const searchRequestIdRef = useRef(0)
  // renderTo() hands back a Rendition immediately, but its view manager is
  // attached asynchronously — calling next()/prev() before that lands throws
  // from inside epub.js ("Cannot read properties of undefined (reading
  // 'next')"), so a null check on the rendition alone isn't enough to know
  // it's safe to page. Flipped once the first display has actually settled.
  const canPageRef = useRef(false)
  // The saved position. Re-seeks after a relayout aim here, not at what's on
  // screen — that's exactly what a relayout disturbs.
  const positionRef = useRef<Progress | null>(null)
  // Non-zero while restoring on open or re-seeking after a relayout:
  // relocations then are layout artefacts and must not be saved. A counter
  // because a re-seek can overlap a restore or a jump from the TOC.
  const settlingRef = useRef(0)
  // Set by open() for its rendition (see createResettler).
  const resettleRef = useRef<() => void>(() => {})
  // Set by open(), which owns the locations Book the percentage comes from.
  const persistCurrentLocationRef = useRef<() => void>(() => {})
  const [loading, setLoading] = useState(true)
  const [toc, setToc] = useState<NavItem[]>([])
  const [activeTocId, setActiveTocId] = useState<string>()
  const [percentage, setPercentage] = useState<number>()
  const [bookTitle, setBookTitle] = useState<string>()
  // Lifted here because each panel has two triggers: the header on desktop,
  // the bottom bar on phones.
  const [tocOpen, setTocOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  // Phones only (see the max-sm: classes on the bars): a tap on the middle of
  // the page hides the bars. They keep their space while hidden, like in
  // other e-book readers — letting the text grow into it would re-paginate
  // the book on every tap and move the page under the reader's eyes.
  const [barsHidden, setBarsHidden] = useState(false)
  const keepScreenOn = useReadingPrefsStore((s) => s.keepScreenOn)
  useScreenWakeLock(keepScreenOn)
  const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement)
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const bookRowRef = useRef<HTMLDivElement>(null)
  const bookRowWidth = useElementWidth(bookRowRef)
  // Stable, and reads everything through refs, so the listeners registered
  // once (window, and each section's iframe inside open()) never go stale.
  const keyActions = useMemo<ReaderKeyActions>(
    () => ({
      next: () => {
        if (canPageRef.current) renditionRef.current?.next()
      },
      prev: () => {
        if (canPageRef.current) renditionRef.current?.prev()
      },
      openSearch: () => setSearchOpen(true),
    }),
    []
  )
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
      // From here to renditionRef being set is synchronous. Without this
      // check, closing the reader during the await left a rendition the
      // cleanup never saw — still able to save a position computed against a
      // detached viewer.
      if (cancelled) return
      bookBufferRef.current = arrayBuffer
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
      let locationsGenerated = false
      const locationsReady = (async () => {
        await locationsBook.ready
        await locationsBook.locations.generate(1024)
        locationsGenerated = true
      })()

      const rendition = book.renderTo(viewerRef.current!, {
        width: '100%',
        height: '100%',
        flow: 'paginated',
      })
      renditionRef.current = rendition

      const resettle = createResettler(
        rendition,
        () => positionRef.current?.cfi ?? rendition.location?.start?.cfi,
        settlingRef
      )
      resettleRef.current = resettle
      // After any relayout — epub.js's own on window resizes, or remeasure()
      // for the rest. epub.js then re-displays the start of the page that was
      // on screen, which after a relayout can be a page off the saved one.
      // While opening, the restore below already settles on its own.
      rendition.on('resized', () => {
        if (canPageRef.current) resettle()
      })

      // The book's content renders in its own iframe document, which doesn't
      // inherit stylesheets from the main page — the palette fonts need to be
      // injected directly into each rendered section. Inline rather than a
      // <link>: WebKit never fires `load` for a link inside epub.js's srcdoc
      // iframe, so there'd be no way to know when its @font-face rules apply.
      rendition.hooks.content.register((contents: Contents) => {
        contents.addStylesheetCss(readerFontsCss, 'reader-fonts')
        // Keydown events inside the iframe never reach the main document's
        // own listener (separate browsing context) — each rendered section
        // needs its own.
        contents.document.addEventListener('keydown', (e: KeyboardEvent) =>
          handleReaderKeydown(e, keyActions)
        )
        // Same reasoning for touch. No cleanup needed: epub.js tears down the
        // whole iframe document when it unrenders a section, taking its
        // listeners with it.
        registerSwipeNavigation(contents.document.documentElement, () =>
          canPageRef.current ? rendition : null
        )
      })

      applyTheme(rendition, activeTheme)
      appliedThemeRef.current = { rendition, theme: activeTheme }

      const progress = await getProgress(bookId!)
      if (cancelled) return
      positionRef.current = progress ?? null
      setPercentage(progress?.percentage)
      const savedCfi = progress?.cfi ?? undefined

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

      // Not length() > 1: locations fill in during generate(), but `total` is
      // only set at the end, so every percentage is 0 until then. Callers get
      // undefined and keep the last known value.
      const percentageForCfi = (cfi: string): number | undefined =>
        locationsGenerated
          ? Math.round(locationsBook.locations.percentageFromCfi(cfi) * 100)
          : undefined

      // Retried once, only while still the newest write — a late retry would
      // put an older position back on top of a newer one.
      let saveSeq = 0
      const persist = (cfi: string, percentage: number) => {
        const record: Progress = { bookId: bookId!, cfi, percentage, lastReadAt: Date.now() }
        positionRef.current = record
        const seq = ++saveSeq
        saveProgress(record)
          .catch(() => (seq === saveSeq ? saveProgress(record) : undefined))
          .catch((error) => console.error('Não foi possível salvar o progresso de leitura', error))
      }

      // Only once the reader has left the page holding the saved position: a
      // relayout moves where that page *starts* without the reader moving,
      // and saving that start each time made the position creep backwards.
      const persistIfMoved = (location: Location | undefined) => {
        const cfi = location?.start?.cfi
        if (!cfi || settlingRef.current > 0) return
        const anchor = positionRef.current?.cfi
        if (anchor && locationContains(location, anchor)) return
        persist(cfi, percentageForCfi(cfi) ?? positionRef.current?.percentage ?? 0)
      }

      // 'relocated' lags a page turn by a debounce plus animation frames,
      // which never run if the rendition is destroyed first or the page is
      // hidden and then killed — so on exit, save what's on screen directly.
      persistCurrentLocationRef.current = () => {
        if (canPageRef.current) persistIfMoved(currentLocationOf(rendition))
      }

      rendition.on('relocated', (location: Location) => {
        resolveFirstRelocation?.()
        resolveFirstRelocation = undefined
        setActiveTocId(computeActiveTocId(rendition, book, tocRef.current, location.start.href))

        const computedPercentage = percentageForCfi(location.start.cfi)
        if (computedPercentage !== undefined) setPercentage(computedPercentage)
        persistIfMoved(location)
      })

      settlingRef.current++
      try {
        await rendition.display(savedCfi)
        await firstRelocation
        if (savedCfi && !cancelled) await settleAt(rendition, savedCfi).catch(console.error)
      } finally {
        settlingRef.current--
      }
      // The view manager is attached and a page is on screen, so the
      // page-turn controls (buttons, arrow keys, swipe) are safe to use now.
      if (!cancelled) {
        snapPageTurns(rendition)
        canPageRef.current = true
      }

      // If locationsBook finishes generating after the initial display, the
      // relocated event above had nothing to compute percentage from yet.
      // Recompute it now for the screen and for the saved position (its CFI
      // untouched) — reading positions directly, not re-calling
      // display()/reportLocation(), since either would re-touch the rendition
      // just to recompute a number that has nothing to do with it.
      locationsReady.then(() => {
        if (cancelled) return
        const onScreen = rendition.location?.start?.cfi
        if (onScreen) setPercentage(percentageForCfi(onScreen))
        const position = positionRef.current
        const percentage = position?.cfi ? percentageForCfi(position.cfi) : undefined
        if (position?.cfi && percentage !== undefined && percentage !== position.percentage) {
          persist(position.cfi, percentage)
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
      persistCurrentLocationRef.current()
      persistCurrentLocationRef.current = () => {}
      resettleRef.current = () => {}
      canPageRef.current = false
      renditionRef.current?.destroy()
      bookRef.current?.destroy()
      // locationsBook is deliberately not destroyed here: destroying it
      // while its own generate() is still mid-flight is the same crash this
      // whole separate-Book approach exists to avoid. It's unused after
      // `cancelled` flips, so it just finishes generating in the background
      // and gets garbage-collected once nothing references it anymore.
      //
      // searchBookRef follows the same logic, for the same reason: a scan
      // could be mid section-load when this runs. Bumping the request id
      // makes performSearch stop touching it on its own after the section
      // currently in flight settles; the ref is just dropped so the next
      // book search starts a fresh instance instead of reusing this one.
      // Not a ref to a rendered node, just a shared counter also written to
      // by performSearch — the "stale by cleanup time" concern the lint rule
      // warns about doesn't apply to it.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      searchRequestIdRef.current++
      searchBookRef.current = null
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
    const handleKeydown = (e: KeyboardEvent) => handleReaderKeydown(e, keyActions)
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [keyActions])

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // epub.js re-lays itself out on window resizes only, but the book's width
  // also changes with the font size and column mode (bookWidthFor). Any change
  // to its container is handed to epub.js, which ignores same-size calls; its
  // 'resized' event (see open()) re-seeks the saved position.
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    const observer = new ResizeObserver(() => {
      const rendition = renditionRef.current
      if (rendition && canPageRef.current) remeasure(rendition)
    })
    observer.observe(viewer)
    return () => observer.disconnect()
  }, [])

  // On a phone, closing the app is the page going hidden, after which it may
  // be killed with no further event. pagehide covers closing a desktop tab.
  useEffect(() => {
    const flush = () => persistCurrentLocationRef.current()
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', flushWhenHidden)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden)
      window.removeEventListener('pagehide', flush)
    }
  }, [])

  // The gesture surface over the book is where swipes are actually handled —
  // see registerSwipeNavigation for why it isn't the book's iframe. Taps: a
  // link under the finger wins; otherwise the left third of the page goes
  // back, the right third forward, and the middle shows/hides the bars.
  useEffect(() => {
    const surface = swipeSurfaceRef.current
    const viewer = viewerRef.current
    if (!surface || !viewer) return
    const pageable = () => (canPageRef.current ? renditionRef.current : null)
    return registerSwipeNavigation(surface, pageable, (clientX, clientY) => {
      if (forwardTapToLink(viewer, clientX, clientY)) return
      const { left, width } = viewer.getBoundingClientRect()
      const position = (clientX - left) / width
      if (position < 1 / 3) pageable()?.prev()
      else if (position > 2 / 3) pageable()?.next()
      else setBarsHidden((hidden) => !hidden)
    })
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
  // For a genuine change, re-seeking the reading position afterwards is not
  // optional: rendition.spread() unconditionally forces a layout
  // recalculation, and epub.js's paginated manager doesn't reliably keep
  // showing the same content through it — even a *palette-only* change was
  // observed moving the visible page. A new font family also reflows again
  // once it loads, hence settleAt. Targeting the saved position (not what's
  // on screen) makes overlapping changes (slider drag) converge on one spot.
  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition) return
    const applied = appliedThemeRef.current
    if (applied && applied.rendition === rendition && applied.theme === activeTheme) return
    appliedThemeRef.current = { rendition, theme: activeTheme }
    applyTheme(rendition, activeTheme)
    resettleRef.current()
  }, [activeTheme, loading])

  // TOC entries and search results usually open another section, which has
  // the same reflow-after-positioning problem as restoring on open. The final
  // flush covers a settle that needed no re-display, where the last saved
  // relocation predates the reflow.
  const navigateTo = useCallback((target: string) => {
    const rendition = renditionRef.current
    if (!rendition) return
    rendition
      .display(target)
      .then(() => settleAt(rendition, target))
      .then(() => persistCurrentLocationRef.current())
      .catch(console.error)
  }, [])

  // Scans every section of the book for `query`, independently of whatever
  // the rendition currently has displayed. Runs against searchBookRef, a
  // second Book parsed from the same bytes and created lazily on first use —
  // scanning means loading and unloading each Section in turn (the same
  // shape as book.locations.generate(), see the comment where locationsBook
  // is created above), which isn't safe to do against the Book the rendition
  // is actively reading from.
  //
  // useCallback keeps this identity-stable across renders so BookSearch's own
  // debounce effect (which depends on it) doesn't re-fire on every keystroke
  // it's not actually related to.
  const performSearch = useCallback(async (query: string): Promise<SearchResult[]> => {
    const requestId = ++searchRequestIdRef.current

    if (!searchBookRef.current) {
      const searchBook = ePub(bookBufferRef.current!.slice(0))
      await searchBook.ready
      // A search started elsewhere, or the book was closed, while this was
      // parsing — the freshly-created Book has nothing displayed and nothing
      // else references it, so it's simplest to just let it be discarded.
      if (searchRequestIdRef.current !== requestId) return []
      searchBookRef.current = searchBook
    }
    const searchBook = searchBookRef.current
    const toc = tocRef.current

    const sections: Section[] = []
    searchBook.spine.each((section: Section) => sections.push(section))

    const results: SearchResult[] = []
    for (const section of sections) {
      if (searchRequestIdRef.current !== requestId || results.length >= MAX_SEARCH_RESULTS) break

      await section.load(searchBook.load.bind(searchBook))
      try {
        if (searchRequestIdRef.current !== requestId) break
        // Typed manually: search() exists in epub.js's source (preferred
        // over the older find() — it matches across element boundaries, not
        // just within a single text node) but isn't in its .d.ts file.
        const matches = (
          section as unknown as { search(q: string): { cfi: string; excerpt: string }[] }
        ).search(query)
        const chapterLabel = chapterLabelForHref(searchBook, toc, section.href)
        for (const match of matches) {
          results.push({ cfi: match.cfi, excerpt: match.excerpt, chapterLabel })
          if (results.length >= MAX_SEARCH_RESULTS) break
        }
      } finally {
        section.unload()
      }
    }

    return results
  }, [])

  // Icons and text in the reader chrome use the `text-foreground` /
  // `text-muted-foreground` / `hover:bg-muted` utilities, which read CSS
  // variables — not the book's per-theme colors. Overriding those variables
  // here (scoped to this subtree) makes the chrome follow the active theme
  // instead of the app's global light/dark colors, which otherwise made
  // icons unreadable (and hover backgrounds mismatched) against a dark theme.
  // Presets only ever use 6-digit hex colors, so appending an alpha suffix
  // for the hover background is safe.
  // --border too: the header and bottom-bar dividers used the app's fixed
  // light gray, which on a dark palette read as a bright line — and showed
  // through the progress bar's translucent track, drowning out its fill.
  // The progress bars' colors are opaque for the same reason (ProgressBar).
  const themeVars = {
    background: activeTheme.background,
    color: activeTheme.textColor,
    '--foreground': activeTheme.textColor,
    '--muted-foreground': activeTheme.textColor,
    '--muted': `${activeTheme.textColor}1a`,
    '--border': themeTint(activeTheme, 15),
  } as CSSProperties

  const chapterLabel = chapterLabelFor(toc, activeTocId)
  const bookWidth =
    bookRowWidth === undefined
      ? undefined
      : isDesktop
        ? bookWidthFor(bookRowWidth - DESKTOP_FRAME_WIDTH, activeTheme) + 24
        : bookWidthFor(bookRowWidth - MOBILE_FRAME_WIDTH, activeTheme) + MOBILE_FRAME_WIDTH

  // invisible (not just transparent) so hidden buttons can't be tapped.
  const bottomBarButtonClass = cn(
    'flex h-14 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg text-xs text-foreground transition-[opacity,visibility] duration-200 disabled:cursor-not-allowed disabled:opacity-50',
    barsHidden && 'invisible opacity-0'
  )

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
      {/* On phones this keeps only back, title and settings, at 44px (the
          touch-target size iOS and Android recommend); contents and search
          move to the bottom bar. From md up the buttons (all but back) get
          text labels, like the phone's bottom bar; the chapter shows from lg,
          where it fits next to the title without truncating it. */}
      <header
        className={cn(
          'relative grid grid-cols-[auto_1fr_auto] items-center gap-2 border-b px-4 py-2 transition-[opacity,visibility] duration-200 max-sm:px-2 max-sm:py-1',
          barsHidden && 'max-sm:invisible max-sm:border-transparent max-sm:opacity-0'
        )}
      >
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Voltar para a biblioteca"
            title="Voltar para a biblioteca"
            className="max-sm:size-11"
            onClick={() => navigate('/')}
          >
            <ArrowLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sumário"
            title="Sumário"
            className={cn('hidden sm:inline-flex', LABELLED_BUTTON)}
            disabled={toc.length === 0}
            onClick={() => setTocOpen(true)}
          >
            <List />
            <span className="hidden md:inline">Sumário</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Buscar no livro"
            title="Buscar no livro (/)"
            className={cn('hidden sm:inline-flex', LABELLED_BUTTON)}
            onClick={() => setSearchOpen(true)}
          >
            <Search />
            <span className="hidden md:inline">Buscar</span>
          </Button>
        </div>
        <span className="min-w-0 truncate text-center text-sm font-medium">
          {bookTitle}
          {chapterLabel && (
            <span className="hidden font-normal text-muted-foreground lg:inline"> · {chapterLabel}</span>
          )}
        </span>
        <div className="flex items-center justify-end gap-1 sm:gap-2">
          {percentage !== undefined && (
            <span className="hidden px-1 text-sm text-muted-foreground sm:inline">{percentage}%</span>
          )}
          {isFullscreenSupported && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
              title={`${isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'} (F)`}
              className={cn('hidden sm:inline-flex', 'lg:w-auto lg:gap-1.5 lg:px-2.5')}
              onClick={toggleFullscreen}
            >
              {isFullscreen ? <Minimize /> : <Maximize />}
              <span className="hidden lg:inline">{isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}</span>
            </Button>
          )}
          <ReaderSettings />
        </div>
        <ProgressBar
          aria-hidden
          theme={activeTheme}
          percentage={percentage ?? 0}
          className="absolute inset-x-0 -bottom-px hidden h-0.5 sm:block"
        />
      </header>
      <TableOfContents
        open={tocOpen}
        onOpenChange={setTocOpen}
        toc={toc}
        activeTocId={activeTocId}
        onNavigate={(href) => {
          const book = bookRef.current
          if (book) navigateTo(resolveTocHref(book, href))
        }}
      />
      <BookSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onSearch={performSearch}
        onNavigate={navigateTo}
      />

      {/* The arrows are flex siblings of the book rather than floating over it:
          as real items they reserve their own width, so a line of text can
          never run underneath them the way it could while they were absolutely
          positioned on top. It also keeps their width defined in one place
          instead of having to mirror it as padding on the book container.
          With the book capped to a comfortable line (bookWidthFor), they
          stretch over the margins left beside it, so the whole margin turns
          the page — not just a 48px strip. They're hidden entirely on phones,
          where two strips cost ~16% of the screen width and swiping replaces
          them (registerSwipeNavigation). */}
      <div ref={bookRowRef} className="relative flex flex-1 overflow-hidden">
        {loading && (
          // z-10 because the arrows' opacity < 1 gives them their own stacking
          // context, which would otherwise paint them over this overlay. Opaque
          // because the book is already rendered underneath while its position
          // is still being settled.
          <div
            className="absolute inset-0 z-10 flex items-center justify-center text-muted-foreground"
            style={{ background: activeTheme.background }}
          >
            Carregando livro...
          </div>
        )}
        <button
          aria-label="Página anterior"
          title="Página anterior (←)"
          onClick={keyActions.prev}
          disabled={loading}
          className="hidden min-w-12 flex-1 cursor-pointer items-center justify-center text-foreground opacity-50 transition-opacity hover:opacity-100 disabled:cursor-not-allowed sm:flex"
        >
          <ChevronLeft />
        </button>

        {/* Breathing room lives on this wrapper, never on the element handed to
            epub.js: epub.js measures that element to size its columns, and
            clientWidth counts padding, so padding applied directly to it makes
            it lay out wider than the space it actually occupies. */}
        <div
          className="relative min-w-0 flex-1 px-2 py-2 sm:px-3 sm:py-4"
          style={bookWidth === undefined ? undefined : { flex: `0 1 ${bookWidth}px` }}
        >
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
          title="Próxima página (→)"
          onClick={keyActions.next}
          disabled={loading}
          className="hidden min-w-12 flex-1 cursor-pointer items-center justify-center text-foreground opacity-50 transition-opacity hover:opacity-100 disabled:cursor-not-allowed sm:flex"
        >
          <ChevronRight />
        </button>
      </div>

      {/* Phones only: the controls within thumb reach, with labels. While the
          bars are hidden the percentage stays, as the only thing left on
          screen besides the text. */}
      <nav
        aria-label="Navegação do livro"
        className={cn(
          'grid grid-cols-3 items-center border-t px-2 transition-colors duration-200 sm:hidden',
          barsHidden && 'border-transparent'
        )}
      >
        <button
          type="button"
          onClick={() => setTocOpen(true)}
          disabled={toc.length === 0}
          className={bottomBarButtonClass}
        >
          <List className="size-5" />
          Sumário
        </button>
        <div className="flex flex-col items-center gap-1.5 text-xs text-muted-foreground">
          <ProgressBar
            theme={activeTheme}
            percentage={percentage ?? 0}
            className={cn(
              'h-1 w-16 rounded-full transition-[opacity,visibility] duration-200',
              barsHidden && 'invisible opacity-0'
            )}
          />
          <span>{percentage ?? 0}%</span>
        </div>
        <button type="button" onClick={() => setSearchOpen(true)} className={bottomBarButtonClass}>
          <Search className="size-5" />
          Buscar
        </button>
      </nav>
    </div>
  )
}
