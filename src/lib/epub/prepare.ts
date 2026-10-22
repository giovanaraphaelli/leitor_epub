import ePub from 'epubjs'
import JSZip from 'jszip'
import { assertNotProtected, loadPackage, repack, resolvePath } from './edit'
import { fontScaleFor, sanitizeCss, type FontSample } from './sanitize'

// Same granularity the reader used to generate on open; locations saved with
// one value can't be read with another.
export const LOCATION_CHARS = 1024

// Body size forced while measuring: big enough that rounding to whole pixels
// doesn't blur 5% differences.
const REFERENCE_PX = 100

// epub.js's queue advances generate() one section per requestAnimationFrame,
// which the browser stops in a hidden tab (phone switched apps mid-import).
// Giving up keeps the import from hanging; the reader generates them on the
// book's first open instead.
const LOCATIONS_TIMEOUT_MS = 90_000

export interface PreparedEpub {
  fileBlob: Blob
  fontScale: number
  // book.locations.save(); absent when epub.js couldn't walk the book.
  locations?: string
}

// Runs once, on import. Whatever fails here keeps the book importable: the
// worst case is storing the file as it came, like before this existed.
export async function prepareEpub(file: Blob): Promise<PreparedEpub> {
  let fileBlob = file
  let fontScale = 1
  try {
    const zip = await JSZip.loadAsync(file)
    await assertNotProtected(zip)
    const { opfPath, opf, manifest } = await loadPackage(zip)

    const css = new Map<string, string>()
    const changed = new Map<string, string | Blob>()
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || !/\.css$/i.test(entry.name)) continue
      const original = await entry.async('string')
      const clean = sanitizeCss(original)
      css.set(entry.name, clean)
      if (clean !== original) changed.set(entry.name, clean)
    }
    if (changed.size > 0) fileBlob = await repack(zip, changed)

    fontScale = await measureFontScale(zip, spinePaths(opfPath, opf, manifest), css)
  } catch (error) {
    console.warn('Não foi possível sanear o EPUB; mantendo o arquivo original', error)
  }

  const locations = await withTimeout(generateLocations(fileBlob), LOCATIONS_TIMEOUT_MS).catch((error) => {
    console.warn('Não foi possível calcular as posições do livro', error)
    return undefined
  })
  return { fileBlob, fontScale, locations }
}

function spinePaths(opfPath: string, opf: Document, manifest: Element): string[] {
  const hrefById = new Map(
    Array.from(manifest.getElementsByTagNameNS('*', 'item')).map((item) => [
      item.getAttribute('id'),
      item.getAttribute('href'),
    ])
  )
  return Array.from(opf.getElementsByTagNameNS('*', 'itemref'))
    .map((ref) => hrefById.get(ref.getAttribute('idref')))
    .filter((href): href is string => Boolean(href))
    .map((href) => resolvePath(opfPath, href))
}

// Lays each chapter out with the (sanitized) book CSS and the body forced to
// REFERENCE_PX, as the theme does, and weighs every text node's computed size
// by its length. Off-screen and sandboxed: no scripts run. Images, links,
// @font-face and @import are stripped (none changes the computed font-size)
// so nothing is requested from the app's origin; leftover url() backgrounds
// may still 404 harmlessly.
async function measureFontScale(zip: JSZip, chapters: string[], css: Map<string, string>): Promise<number> {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-same-origin')
  iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:600px;height:800px;visibility:hidden'
  document.body.appendChild(iframe)
  const samples: FontSample[] = []
  try {
    const target = iframe.contentDocument!
    const view = iframe.contentWindow!
    for (const path of chapters) {
      const source = await zip.file(path)?.async('string')
      const doc = source ? parseChapter(source) : undefined
      if (!doc?.documentElement) continue

      const sheets: string[] = []
      for (const link of Array.from(doc.querySelectorAll('link'))) {
        const sheet = /stylesheet/i.test(link.getAttribute('rel') ?? '')
          ? css.get(resolvePath(path, link.getAttribute('href') ?? ''))
          : undefined
        if (sheet !== undefined) sheets.push(sheet.replace(FONT_FACE, '').replace(IMPORT, ''))
      }
      doc
        .querySelectorAll('link, script, img, image, video, audio, iframe, object, embed, source')
        .forEach((el) => el.remove())

      target.replaceChild(target.importNode(doc.documentElement, true), target.documentElement)
      for (const sheet of sheets) {
        const style = target.createElement('style')
        style.textContent = sheet
        ;(target.head ?? target.documentElement).appendChild(style)
      }
      if (!target.body) continue
      target.body.style.setProperty('font-size', `${REFERENCE_PX}px`, 'important')

      const walker = target.createTreeWalker(target.body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const chars = node.textContent?.trim().length ?? 0
        if (!chars || !node.parentElement) continue
        samples.push({ fontSize: parseFloat(view.getComputedStyle(node.parentElement).fontSize), chars })
      }
    }
  } finally {
    iframe.remove()
  }
  return fontScaleFor(samples, REFERENCE_PX)
}

const FONT_FACE = /@font-face\s*\{[^}]*\}/gi
const IMPORT = /@import[^;]*;/gi

// Chapters are meant to be XHTML, but plenty of books ship tag soup that the
// XML parser rejects; the HTML parser accepts anything.
function parseChapter(source: string): Document {
  const xml = new DOMParser().parseFromString(source, 'application/xhtml+xml')
  if (!xml.getElementsByTagName('parsererror').length) return xml
  return new DOMParser().parseFromString(source, 'text/html')
}

async function generateLocations(file: Blob): Promise<string> {
  const book = ePub(await file.arrayBuffer())
  try {
    // A file that isn't an EPUB never settles book.ready — see parse.ts.
    await new Promise<void>((resolve, reject) => {
      book.on('openFailed', reject)
      book.ready.then(() => resolve(), reject)
    })
    await book.locations.generate(LOCATION_CHARS)
    return book.locations.save()
  } finally {
    book.destroy()
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`sem resposta em ${ms} ms`)), ms)),
  ])
}
