import JSZip from 'jszip'

// Editing touches only the package document (the OPF, where the title, the
// authors and the cover live), the NCX's copy of the title, and the cover
// image. Every other file is copied byte for byte and the spine is never
// touched, so saved reading positions (CFIs walk the spine and the chapter
// documents) stay valid.

export interface BookInfo {
  title: string
  authors: string[]
}

export interface BookInfoEdits {
  title: string
  // Several authors separated by " & ", as Calibre shows them.
  author: string
  // Any image the browser can decode; re-encoded to fit the book.
  cover?: Blob
}

// Books under DRM (store purchases) are encrypted and bound to a license;
// rewriting their package could leave them unreadable.
export class ProtectedEpubError extends Error {
  constructor() {
    super('EPUB protegido por DRM')
  }
}

const DC_NS = 'http://purl.org/dc/elements/1.1/'
const OPF_NS = 'http://www.idpf.org/2007/opf'
const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

// Encryption entries that only obfuscate embedded fonts (against casual
// extraction) — not DRM: a book carrying just these is freely editable.
const FONT_OBFUSCATION = new Set([
  'http://www.idpf.org/2008/embedding',
  'http://ns.adobe.com/pdf/enc#RC',
])

// Amazon's recommended size for Kindle covers; a bigger image only weighs
// the file down.
const COVER_MAX_WIDTH = 1600
const COVER_MAX_HEIGHT = 2560

const AUTHOR_SEPARATOR = /\s+&\s+/

export function splitAuthors(author: string): string[] {
  return author
    .split(AUTHOR_SEPARATOR)
    .map((name) => name.trim())
    .filter(Boolean)
}

export function joinAuthors(authors: string[]): string {
  return authors.join(' & ')
}

export async function readBookInfo(file: Blob): Promise<BookInfo> {
  const zip = await JSZip.loadAsync(file)
  await assertNotProtected(zip)
  const { metadata } = await loadPackage(zip)
  return {
    title: mainTitle(metadata)?.textContent?.trim() ?? '',
    authors: authorsOf(metadata).map((creator) => creator.textContent?.trim() ?? ''),
  }
}

export async function editBookInfo(file: Blob, edits: BookInfoEdits): Promise<Blob> {
  const zip = await JSZip.loadAsync(file)
  await assertNotProtected(zip)
  const { opfPath, opfText, opf, metadata, manifest } = await loadPackage(zip)
  const epub3 = (opf.documentElement.getAttribute('version') ?? '').startsWith('3')
  const changed = new Map<string, string | Blob>()

  setTitle(opf, metadata, edits.title)
  setAuthors(opf, metadata, splitAuthors(edits.author))
  if (edits.cover) await setCover(zip, opf, opfPath, metadata, manifest, epub3, edits.cover, changed)
  if (epub3) touchModified(opf, metadata)
  await updateNcx(zip, opfPath, manifest, edits, changed)
  changed.set(opfPath, serializeXml(opf, opfText))

  return repack(zip, changed)
}

// The image a cover can be made from, or an error if the browser can't
// decode it — checked when it's picked, before anything is saved.
export async function loadImage(image: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(image)
  try {
    const element = new Image()
    element.src = url
    await element.decode()
    return element
  } finally {
    URL.revokeObjectURL(url)
  }
}

/* ------------------------------------------------------------- package */

async function assertNotProtected(zip: JSZip) {
  // rights.xml: Adobe's license; sinf.xml: Apple's.
  if (zip.file('META-INF/rights.xml') || zip.file('META-INF/sinf.xml')) throw new ProtectedEpubError()
  const encryption = await zip.file('META-INF/encryption.xml')?.async('string')
  if (!encryption) return
  const methods = parseXml(encryption).getElementsByTagNameNS('*', 'EncryptionMethod')
  for (const method of Array.from(methods)) {
    if (!FONT_OBFUSCATION.has(method.getAttribute('Algorithm') ?? '')) throw new ProtectedEpubError()
  }
}

async function loadPackage(zip: JSZip) {
  const container = await zip.file('META-INF/container.xml')?.async('string')
  const opfPath = container && parseXml(container).getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path')
  const opfText = opfPath && (await zip.file(opfPath)?.async('string'))
  if (!opfPath || !opfText) throw new Error('EPUB sem documento de pacote (OPF)')
  const opf = parseXml(opfText)
  const metadata = opf.getElementsByTagNameNS('*', 'metadata')[0]
  const manifest = opf.getElementsByTagNameNS('*', 'manifest')[0]
  if (!metadata || !manifest) throw new Error('OPF sem metadata ou manifest')
  return { opfPath, opfText, opf, metadata, manifest }
}

function metasOf(metadata: Element): Element[] {
  return Array.from(metadata.getElementsByTagNameNS('*', 'meta'))
}

// EPUB 3 describes an element through <meta refines="#its-id">.
function refinementsOf(metadata: Element, element: Element): Element[] {
  const id = element.getAttribute('id')
  return id ? metasOf(metadata).filter((meta) => meta.getAttribute('refines') === `#${id}`) : []
}

function refinement(metadata: Element, element: Element, property: string): string | undefined {
  return refinementsOf(metadata, element)
    .find((meta) => meta.getAttribute('property') === property)
    ?.textContent?.trim()
}

function removeWithRefinements(metadata: Element, element: Element) {
  refinementsOf(metadata, element).forEach((meta) => meta.remove())
  element.remove()
}

// A new element beside an existing one, in the same namespace and prefix
// style as its siblings (some packages spell them opf:item, opf:meta).
function createSibling(opf: Document, parent: Element, localName: string): Element {
  const namespace = parent.namespaceURI ?? OPF_NS
  return opf.createElementNS(namespace, parent.prefix ? `${parent.prefix}:${localName}` : localName)
}

/* ----------------------------------------------------- title and authors */

// The title marked as the main one (EPUB 3 can list a subtitle, a collection
// title...), else the first — what reading apps and the Kindle show.
function mainTitle(metadata: Element): Element | undefined {
  const titles = Array.from(metadata.getElementsByTagNameNS(DC_NS, 'title'))
  return titles.find((title) => refinement(metadata, title, 'title-type') === 'main') ?? titles[0]
}

function setTitle(opf: Document, metadata: Element, value: string) {
  const main = mainTitle(metadata)
  const title = opf.createElementNS(DC_NS, 'dc:title')
  title.textContent = value
  // Beside the old one, which old packages keep in a <dc-metadata> wrapper
  // rather than directly under <metadata>.
  ;(main?.parentNode ?? metadata).insertBefore(title, main ?? metadata.firstChild)
  // The edited title is the title: a leftover subtitle or sort key
  // (file-as) would still describe the old one.
  for (const old of Array.from(metadata.getElementsByTagNameNS(DC_NS, 'title'))) {
    if (old !== title) removeWithRefinements(metadata, old)
  }
  metasOf(metadata)
    .filter((meta) => meta.getAttribute('name') === 'calibre:title_sort')
    .forEach((meta) => meta.remove())
}

function roleOf(metadata: Element, creator: Element): string | undefined {
  return creator.getAttributeNS(OPF_NS, 'role') || refinement(metadata, creator, 'role')
}

// Creators credited as authors — or with no role, which means author.
// Translators, illustrators and the like are left as they were.
function authorsOf(metadata: Element): Element[] {
  return Array.from(metadata.getElementsByTagNameNS(DC_NS, 'creator')).filter((creator) => {
    const role = roleOf(metadata, creator)
    return !role || role === 'aut'
  })
}

function setAuthors(opf: Document, metadata: Element, names: string[]) {
  const previous = authorsOf(metadata)
  // Where the old authors were, or right after the title.
  const title = mainTitle(metadata)
  const parent = (previous[0] ?? title)?.parentNode ?? metadata
  const before = previous[0] ?? title?.nextSibling ?? null
  for (const name of names) {
    const creator = opf.createElementNS(DC_NS, 'dc:creator')
    creator.textContent = name
    parent.insertBefore(creator, before)
  }
  previous.forEach((creator) => removeWithRefinements(metadata, creator))
}

function touchModified(opf: Document, metadata: Element) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  let modified = metasOf(metadata).find((meta) => meta.getAttribute('property') === 'dcterms:modified')
  if (!modified) {
    modified = createSibling(opf, metadata, 'meta')
    modified.setAttribute('property', 'dcterms:modified')
    metadata.appendChild(modified)
  }
  modified.textContent = now
}

/* ----------------------------------------------------------------- cover */

function findCoverItem(metadata: Element, items: Element[]): Element | undefined {
  const byProperty = items.find((item) =>
    (item.getAttribute('properties') ?? '').split(/\s+/).includes('cover-image')
  )
  if (byProperty) return byProperty
  const pointer = metasOf(metadata)
    .find((meta) => meta.getAttribute('name') === 'cover')
    ?.getAttribute('content')
  // Some packages point at the href instead of the id.
  return pointer ? items.find((item) => item.getAttribute('id') === pointer || item.getAttribute('href') === pointer) : undefined
}

async function setCover(
  zip: JSZip,
  opf: Document,
  opfPath: string,
  metadata: Element,
  manifest: Element,
  epub3: boolean,
  image: Blob,
  changed: Map<string, string | Blob>
) {
  const items = Array.from(manifest.getElementsByTagNameNS('*', 'item'))
  let item = findCoverItem(metadata, items)
  const type = item?.getAttribute('media-type')

  if (item && (type === 'image/jpeg' || type === 'image/png')) {
    // Same file, same format: whatever shows the cover (a cover page, the
    // manifest) keeps pointing at it.
    const path = resolvePath(opfPath, item.getAttribute('href')!)
    const cover = await encodeCover(image, type)
    changed.set(path, cover.blob)
    await fitSvgCoverPages(zip, opfPath, items, path, cover, changed)
  } else {
    // No cover yet, or one in a format a canvas can't write back: a new JPEG
    // becomes the cover, and the old image (if any) stays for whatever
    // still references it.
    const cover = await encodeCover(image, 'image/jpeg')
    const href = uniqueName(zip, opfPath, 'cover-image.jpg')
    item?.setAttribute(
      'properties',
      (item.getAttribute('properties') ?? '').split(/\s+/).filter((p) => p && p !== 'cover-image').join(' ')
    )
    if (item && !item.getAttribute('properties')) item.removeAttribute('properties')
    item = createSibling(opf, manifest, 'item')
    item.setAttribute('id', uniqueId(opf, 'cover-image'))
    item.setAttribute('href', href)
    item.setAttribute('media-type', 'image/jpeg')
    if (epub3) item.setAttribute('properties', 'cover-image')
    manifest.appendChild(item)
    changed.set(resolvePath(opfPath, href), cover.blob)
  }

  // The EPUB 2 pointer, which the Kindle conversion reads — also added to
  // EPUB 3 packages that only use properties="cover-image".
  let pointer = metasOf(metadata).find((meta) => meta.getAttribute('name') === 'cover')
  if (!pointer) {
    pointer = createSibling(opf, metadata, 'meta')
    pointer.setAttribute('name', 'cover')
    metadata.appendChild(pointer)
  }
  pointer.setAttribute('content', item.getAttribute('id')!)
}

async function encodeCover(image: Blob, type: 'image/jpeg' | 'image/png') {
  const source = await loadImage(image)
  const scale = Math.min(1, COVER_MAX_WIDTH / source.naturalWidth, COVER_MAX_HEIGHT / source.naturalHeight)
  const width = Math.round(source.naturalWidth * scale)
  const height = Math.round(source.naturalHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!
  if (type === 'image/jpeg') {
    // JPEG has no transparency: a transparent PNG would come out black.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
  }
  context.drawImage(source, 0, 0, width, height)
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('Falha ao gerar a capa'))), type, 0.9)
  )
  return { blob, width, height }
}

// Cover pages made by Calibre and others wrap the image in an SVG sized to
// the old image (viewBox, width, height): without updating them, a cover
// with other proportions would show squashed or stretched.
async function fitSvgCoverPages(
  zip: JSZip,
  opfPath: string,
  items: Element[],
  coverPath: string,
  cover: { width: number; height: number },
  changed: Map<string, string | Blob>
) {
  const fileName = coverPath.split('/').pop()!
  for (const item of items) {
    if (item.getAttribute('media-type') !== 'application/xhtml+xml') continue
    const path = resolvePath(opfPath, item.getAttribute('href') ?? '')
    const text = await zip.file(path)?.async('string')
    if (!text?.includes(fileName)) continue
    let page: Document
    try {
      page = parseXml(text, 'application/xhtml+xml')
    } catch {
      continue
    }
    let fitted = false
    for (const image of Array.from(page.getElementsByTagNameNS(SVG_NS, 'image'))) {
      const href = image.getAttributeNS(XLINK_NS, 'href') ?? image.getAttribute('href')
      if (!href || resolvePath(path, href) !== coverPath) continue
      image.setAttribute('width', String(cover.width))
      image.setAttribute('height', String(cover.height))
      image.closest('svg')?.setAttribute('viewBox', `0 0 ${cover.width} ${cover.height}`)
      fitted = true
    }
    if (fitted) changed.set(path, serializeXml(page, text))
  }
}

/* ------------------------------------------------------------------- NCX */

// EPUB 2's table of contents repeats the title and author.
async function updateNcx(
  zip: JSZip,
  opfPath: string,
  manifest: Element,
  edits: BookInfoEdits,
  changed: Map<string, string | Blob>
) {
  const item = Array.from(manifest.getElementsByTagNameNS('*', 'item')).find(
    (candidate) => candidate.getAttribute('media-type') === 'application/x-dtbncx+xml'
  )
  const path = item && resolvePath(opfPath, item.getAttribute('href') ?? '')
  const text = path && (await zip.file(path)?.async('string'))
  if (!path || !text) return
  let ncx: Document
  try {
    ncx = parseXml(text)
  } catch {
    return
  }
  const setText = (container: Element | undefined, value: string) => {
    const node = container?.getElementsByTagNameNS('*', 'text')[0]
    if (node) node.textContent = value
  }
  setText(ncx.getElementsByTagNameNS('*', 'docTitle')[0], edits.title)
  setText(ncx.getElementsByTagNameNS('*', 'docAuthor')[0], joinAuthors(splitAuthors(edits.author)))
  changed.set(path, serializeXml(ncx, text))
}

/* ----------------------------------------------------------------- files */

function parseXml(text: string, type: DOMParserSupportedType = 'application/xml'): Document {
  const doc = new DOMParser().parseFromString(text, type)
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('XML inválido')
  return doc
}

// XMLSerializer drops the XML declaration; put the original one back (`\s`
// also skips a leading byte-order mark).
function serializeXml(doc: Document, original: string): string {
  const xml = new XMLSerializer().serializeToString(doc)
  const declaration = original.match(/^\s*(<\?xml[^>]*\?>)/)?.[1]
  return declaration && !xml.startsWith('<?xml') ? `${declaration}\n${xml}` : xml
}

// Hrefs are relative to the document holding them and may be URL-encoded.
function resolvePath(fromFile: string, href: string): string {
  const parts = fromFile.split('/').slice(0, -1)
  for (const segment of decodeURIComponent(href.split('#')[0]).split('/')) {
    if (segment === '..') parts.pop()
    else if (segment && segment !== '.') parts.push(segment)
  }
  return parts.join('/')
}

function uniqueName(zip: JSZip, opfPath: string, name: string): string {
  const [base, extension] = [name.slice(0, name.lastIndexOf('.')), name.slice(name.lastIndexOf('.'))]
  let candidate = name
  for (let n = 2; zip.file(resolvePath(opfPath, candidate)); n++) candidate = `${base}-${n}${extension}`
  return candidate
}

function uniqueId(opf: Document, id: string): string {
  const taken = new Set(Array.from(opf.querySelectorAll('[id]')).map((element) => element.getAttribute('id')))
  let candidate = id
  for (let n = 2; taken.has(candidate); n++) candidate = `${id}-${n}`
  return candidate
}

// The spec requires mimetype as the first entry, stored uncompressed — the
// Kindle conversion rejects files that get this wrong.
async function repack(zip: JSZip, changed: Map<string, string | Blob>): Promise<Blob> {
  const out = new JSZip()
  out.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || entry.name === 'mimetype') continue
    out.file(entry.name, changed.get(entry.name) ?? (await entry.async('uint8array')), { date: entry.date })
    changed.delete(entry.name)
  }
  for (const [path, content] of changed) out.file(path, content)
  return out.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' })
}
