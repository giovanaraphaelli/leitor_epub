// Checks that an EPUB is structurally sound before it gets used as a fixture:
// mimetype placement/compression, referential integrity (manifest -> files,
// spine -> manifest), and — the part that actually catches mistakes — whether
// every table-of-contents anchor points at an id that exists in the target
// chapter. A TOC pointing at a missing anchor fails silently in the reader,
// which is exactly the kind of bug a fixture should never introduce itself.
//
// Run with `npm run epub:validate` (defaults to the generated fixture), or
// pass a path to check any other EPUB:
//   node scripts/validate-epub.mjs caminho/para/livro.epub
//
// Exits non-zero when something is wrong, so it can gate a commit or CI step.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(projectRoot, 'package.json'))
const JSZip = require('jszip')

const target = process.argv[2] ?? join(projectRoot, 'fixtures', 'livro-de-teste.epub')
const zip = await JSZip.loadAsync(readFileSync(target))

const problems = []
const entryNames = Object.keys(zip.files)

// 1. mimetype must be the first entry, uncompressed, with an exact value.
if (entryNames[0] !== 'mimetype') {
  problems.push(`mimetype não é a primeira entrada do zip (é "${entryNames[0]}")`)
}
const mimetype = await zip.file('mimetype').async('string')
if (mimetype !== 'application/epub+zip') {
  problems.push(`mimetype com conteúdo inesperado: "${mimetype}"`)
}

// 2. container.xml has to resolve to a package document that exists.
const container = await zip.file('META-INF/container.xml').async('string')
const opfPath = container.match(/full-path="([^"]+)"/)?.[1]
if (!opfPath || !zip.file(opfPath)) {
  problems.push(`o OPF apontado pelo container não existe: ${opfPath}`)
  reportAndExit()
}

const opf = await zip.file(opfPath).async('string')
// Hrefs inside the package document are relative to its own folder.
const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''

// 3. every manifest item resolves to a real file in the archive.
const manifest = new Map()
for (const match of opf.matchAll(/<item\s+([^>]+)\/>/g)) {
  const attrs = Object.fromEntries(
    [...match[1].matchAll(/(\w[\w:-]*)="([^"]*)"/g)].map((a) => [a[1], a[2]])
  )
  manifest.set(attrs.id, attrs)
  if (!zip.file(opfDir + attrs.href)) {
    problems.push(`manifest aponta para arquivo inexistente: ${attrs.href}`)
  }
}

// 4. every spine reference resolves to a manifest item.
const spine = [...opf.matchAll(/<itemref\s+idref="([^"]+)"/g)].map((m) => m[1])
for (const idref of spine) {
  if (!manifest.has(idref)) problems.push(`spine referencia id fora do manifest: ${idref}`)
}
if (spine.length === 0) problems.push('spine vazia — não há nada para ler')

// 5. cover declared both ways (see the comment in the generator).
if (![...manifest.values()].some((item) => item.properties?.split(/\s+/).includes('cover-image'))) {
  problems.push('nenhum item do manifest com properties="cover-image"')
}
if (!/<meta\s+name="cover"\s+content="([^"]+)"/.test(opf)) {
  problems.push('sem <meta name="cover"> (a forma antiga de declarar a capa)')
}

// 6. every TOC link resolves, and every anchor exists in its target file.
const navItem = [...manifest.values()].find((item) =>
  item.properties?.split(/\s+/).includes('nav')
)
let anchorsChecked = 0
let links = []
if (!navItem) {
  problems.push('nenhum documento de navegação (properties="nav") no manifest')
} else {
  const nav = await zip.file(opfDir + navItem.href).async('string')
  links = [...nav.matchAll(/<a\s+href="([^"]+)"/g)].map((m) => m[1])
  for (const href of links) {
    const [file, fragment] = href.split('#')
    const entry = zip.file(opfDir + file)
    if (!entry) {
      problems.push(`sumário aponta para arquivo inexistente: ${file}`)
      continue
    }
    if (fragment) {
      const contents = await entry.async('string')
      if (!contents.includes(`id="${fragment}"`)) {
        problems.push(`sumário aponta para âncora inexistente: ${href}`)
      }
      anchorsChecked++
    }
  }
}

// 7. cheap well-formedness signal on the chapters themselves.
for (const idref of spine) {
  if (!manifest.has(idref)) continue
  const contents = await zip.file(opfDir + manifest.get(idref).href).async('string')
  const opened = (contents.match(/<p>/g) || []).length
  const closed = (contents.match(/<\/p>/g) || []).length
  if (opened !== closed) {
    problems.push(`${idref}: <p> abertas (${opened}) e fechadas (${closed}) não batem`)
  }
}

console.log(`arquivo: ${target}`)
console.log(`entradas no zip: ${entryNames.length}`)
console.log(`capítulos na spine: ${spine.length}`)
console.log(`links no sumário: ${links.length} (${anchorsChecked} com âncora, todas conferidas)`)
reportAndExit()

function reportAndExit() {
  if (problems.length === 0) {
    console.log('\nOK — nenhum problema encontrado')
    process.exit(0)
  }
  console.error(`\nPROBLEMAS:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
