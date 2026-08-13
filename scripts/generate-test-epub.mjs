// Generates the EPUB 3 fixture used to exercise the reader: a PNG cover, eight
// chapters with enough prose to paginate over many screens, and a nested table
// of contents whose entries point at in-chapter anchors (which is what the
// current-chapter detection compares CFIs against).
//
// Run with `npm run epub:generate`. Rewrites fixtures/livro-de-teste.epub in
// place; the output is deterministic, so regenerating produces the same book
// unless this script changes.
//
// Deliberately has no dependencies of its own: JSZip comes from epub.js, which
// the app already depends on, and the PNG is encoded by hand against Node's
// zlib rather than pulling in an image library for one gradient.
import { createRequire } from 'node:module'
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
// Resolve from the project root rather than this file's folder or the cwd, so
// the script works no matter where it's invoked from.
const require = createRequire(join(projectRoot, 'package.json'))
const JSZip = require('jszip')

const OUT_DIR = join(projectRoot, 'fixtures')
const OUT_FILE = join(OUT_DIR, 'livro-de-teste.epub')

// Every zip entry gets this timestamp instead of the current time. Without it
// JSZip stamps each entry with `new Date()`, so two runs of an unchanged
// script produce different bytes — and since the fixture is committed, that
// would mean a fresh 94 KB blob in git every time anyone regenerates it.
const FIXED_TIMESTAMP = new Date(Date.UTC(2026, 7, 13, 12, 0, 0))

/* ------------------------------------------------------------- PNG cover */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

// Soft vertical gradient with faint banding — just enough texture that the
// cover doesn't read as a flat rectangle in the library grid. 2:3 to match the
// aspect ratio the grid reserves for covers.
function makeCoverPng(width = 600, height = 900) {
  const raw = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3)
    raw[rowStart] = 0 // "None" filter for this scanline
    const t = y / height
    for (let x = 0; x < width; x++) {
      const band = Math.sin(y / 45) * 8 + Math.sin(x / 70) * 6
      const i = rowStart + 1 + x * 3
      raw[i] = Math.max(0, Math.min(255, Math.round(247 - t * 60 + band)))
      raw[i + 1] = Math.max(0, Math.min(255, Math.round(214 - t * 30 + band)))
      raw[i + 2] = Math.max(0, Math.min(255, Math.round(232 + t * 10 + band)))
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolor RGB
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlacing

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/* ----------------------------------------------------------------- prose */

// Original filler text. Accented Portuguese on purpose: it's what makes font
// switching and encoding problems visible while reading the fixture.
const OPENERS = [
  'A luz entrava pela janela estreita e assentava no chão de tábuas gastas',
  'Ninguém na casa sabia dizer desde quando o relógio da sala estava parado',
  'O caderno tinha as bordas onduladas de tanto ser folheado com as mãos molhadas',
  'Era o tipo de manhã em que o silêncio pesa mais do que qualquer barulho',
  'Do lado de fora, a chuva insistia em bater no mesmo canto do telhado',
  'A estrada seguia reta por quilômetros, sem uma curva que justificasse a pressa',
  'Havia um cheiro de papel velho que não saía das paredes da biblioteca',
  'Ela guardava as cartas numa caixa de metal, embaixo da cama, há anos',
]

const CLOSERS = [
  'e ninguém achou aquilo estranho, nem naquele dia nem nos que vieram depois.',
  'como se o tempo tivesse combinado de passar mais devagar ali dentro.',
  'até que alguém finalmente resolveu perguntar o que estava acontecendo.',
  'e a resposta, quando veio, não explicava quase nada.',
  'o que, pensando bem, já era um começo razoável para uma história.',
  'mesmo sabendo que aquilo não ia durar muito mais tempo.',
  'e foi assim, sem aviso, que a rotina inteira mudou de lugar.',
  'ainda que ninguém fosse admitir isso em voz alta tão cedo.',
]

// Indexed by a seed rather than randomised so the fixture is byte-stable
// across runs — a regenerated file that differs only in noise would show up as
// a meaningless diff in git.
function paragraph(seed) {
  const sentences = []
  for (let i = 0; i < 4; i++) {
    const opener = OPENERS[(seed * 7 + i * 3) % OPENERS.length]
    const closer = CLOSERS[(seed * 5 + i * 2) % CLOSERS.length]
    sentences.push(`${opener}, ${closer}`)
  }
  return sentences.join(' ')
}

const CHAPTER_COUNT = 8
const SECTIONS_PER_CHAPTER = 3
const PARAGRAPHS_PER_SECTION = 9
const TITLE = 'O Relógio Parado da Sala'
const AUTHOR = 'Joana Vieira'

function chapterXhtml(n) {
  const sections = Array.from({ length: SECTIONS_PER_CHAPTER }, (_, s) => {
    const index = s + 1
    const paragraphs = Array.from(
      { length: PARAGRAPHS_PER_SECTION },
      (_, i) => `    <p>${paragraph(n * 100 + index * 10 + i)}</p>`
    ).join('\n')
    return `    <h2 id="sec-${n}-${index}">${n}.${index} &#8212; Uma seção qualquer</h2>\n${paragraphs}`
  }).join('\n\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="pt-BR" lang="pt-BR">
  <head>
    <title>Capítulo ${n}</title>
    <meta charset="utf-8" />
  </head>
  <body>
    <h1>Capítulo ${n}</h1>
${sections}
  </body>
</html>
`
}

/* -------------------------------------------------------------- assembly */

const manifestItems = [
  '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
  '    <item id="cover-image" href="capa.png" media-type="image/png" properties="cover-image"/>',
  ...Array.from(
    { length: CHAPTER_COUNT },
    (_, i) =>
      `    <item id="cap${i + 1}" href="cap${i + 1}.xhtml" media-type="application/xhtml+xml"/>`
  ),
].join('\n')

const spineItems = Array.from(
  { length: CHAPTER_COUNT },
  (_, i) => `    <itemref idref="cap${i + 1}"/>`
).join('\n')

const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">urn:uuid:8f2a1c40-5b7e-4c31-9d6a-testeleitorepub</dc:identifier>
    <dc:title>${TITLE}</dc:title>
    <dc:creator>${AUTHOR}</dc:creator>
    <dc:language>pt-BR</dc:language>
    <dc:description>Arquivo de teste gerado para exercitar o leitor de EPUB.</dc:description>
    <meta property="dcterms:modified">2026-08-13T00:00:00Z</meta>
    <!-- The EPUB 2 way of naming the cover, kept alongside properties="cover-image"
         because readers differ on which one they look for. -->
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
${manifestItems}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>
`

const navEntries = Array.from({ length: CHAPTER_COUNT }, (_, i) => {
  const n = i + 1
  const subitems = Array.from({ length: SECTIONS_PER_CHAPTER }, (_, s) => {
    const index = s + 1
    return `          <li><a href="cap${n}.xhtml#sec-${n}-${index}">${n}.${index} Uma seção qualquer</a></li>`
  }).join('\n')
  return `      <li>
        <a href="cap${n}.xhtml">Capítulo ${n}</a>
        <ol>
${subitems}
        </ol>
      </li>`
}).join('\n')

const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="pt-BR" lang="pt-BR">
  <head>
    <title>Sumário</title>
    <meta charset="utf-8" />
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Sumário</h1>
      <ol>
${navEntries}
      </ol>
    </nav>
  </body>
</html>
`

const zip = new JSZip()

// The spec requires mimetype to be the first entry and stored uncompressed.
zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
zip.file(
  'META-INF/container.xml',
  `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`
)
zip.file('OEBPS/content.opf', contentOpf)
zip.file('OEBPS/nav.xhtml', navXhtml)
zip.file('OEBPS/capa.png', makeCoverPng())
for (let n = 1; n <= CHAPTER_COUNT; n++) {
  zip.file(`OEBPS/cap${n}.xhtml`, chapterXhtml(n))
}

// Stamp the fixed date on every entry after the fact rather than per file:
// JSZip also creates directory entries implicitly (META-INF/, OEBPS/) as a
// side effect of adding files inside them, and those never pass through a
// file() call where a date could be set. Missing them left two entries
// carrying the wall clock, which was enough to change the bytes between runs.
for (const entry of Object.values(zip.files)) {
  entry.date = FIXED_TIMESTAMP
}

const buffer = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
})

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT_FILE, buffer)

const paragraphCount = CHAPTER_COUNT * SECTIONS_PER_CHAPTER * PARAGRAPHS_PER_SECTION
console.log(`gerado: ${OUT_FILE}`)
console.log(`tamanho: ${(buffer.length / 1024).toFixed(1)} KB`)
console.log(`${CHAPTER_COUNT} capítulos, ${SECTIONS_PER_CHAPTER} seções cada, ${paragraphCount} parágrafos`)
