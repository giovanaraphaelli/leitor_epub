# Saneamento de EPUB na importação — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao importar um EPUB, sanear o CSS dele uma única vez (cor, fundo e `white-space` que brigam com o tema), medir a escala de fonte que faz o texto bater com o tamanho escolhido e pré-calcular as posições da porcentagem — salvando só a versão saneada.

**Architecture:** Um orquestrador `prepareEpub(file)` (`src/lib/epub/prepare.ts`) roda na importação: reescreve os `.css` do zip com regras puras (`src/lib/epub/sanitize.ts`), reempacota com o `repack` que já existe em `edit.ts`, renderiza os capítulos num iframe oculto para achar o tamanho de fonte dominante e gera `book.locations` com o epub.js. O `Book` ganha dois campos não indexados (`fontScale`, `locations`); o Reader multiplica o tamanho do tema por `fontScale` e carrega `locations` prontas em vez de gerar. O HTML dos capítulos nunca é tocado, então CFIs (progresso, grifos) continuam válidos.

**Tech Stack:** JSZip (já instalado, usado em `edit.ts`), epub.js 0.3.93 (`locations.generate/save/load`), Dexie, Vitest (ambiente `node` — só lógica pura).

## Contexto (diagnóstico que motivou o plano)

Medido com três livros reais em `public/epubs.local/` (gitignored, cópia local):

- *Ponto de Impacto*: o CSS fixa `color: #000` nas classes de parágrafo → texto preto no tema escuro (o tema só força cor no `body`). A `div.body` tem `white-space: pre-wrap` → as quebras de linha do HTML entre `<p>` viram linhas em branco. Os tamanhos são encadeados a partir de um `body { font-size: 1.29167em }` que o tema sobrescreve → 99,8% do texto sai com ~77% do tamanho escolhido.
- *Fortaleza Digital* / *Ponto de Impacto*: 137–138 arquivos na spine; `locations.generate(1024)` leva ~15 s e é refeito a cada abertura, então a porcentagem fica em 0% esse tempo todo. *Matéria escura* (25 arquivos) leva ~3 s.

Decisões da conversa: sanear **uma vez, na importação**, e salvar **só a versão saneada** (sem guardar o original). Calcular `locations` **na importação**. Livros já importados não são saneados (reimportar se precisar), mas passam a guardar as `locations` na primeira abertura.

**Limitação conhecida (fora do escopo):** só os arquivos `.css` são saneados. `style="color:…"` inline e blocos `<style>` dentro dos capítulos ficam como estão, porque mexer no HTML arrisca os CFIs. Nenhum dos três livros testados usa isso.

## Arquivos

- Create `src/lib/epub/sanitize.ts` — funções puras: `sanitizeCss(css)` e `fontScaleFor(samples, referencePx)`.
- Create `src/lib/epub/sanitize.test.ts` — testes Vitest das duas funções.
- Create `src/lib/epub/prepare.ts` — `prepareEpub(file)`, medição de fonte no iframe, geração de `locations`; constante `LOCATION_CHARS`. Só navegador.
- Modify `src/lib/epub/edit.ts` — exportar `assertNotProtected`, `loadPackage`, `resolvePath`, `repack` (hoje privados).
- Modify `src/lib/db/schema.ts` — `Book.fontScale?: number`, `Book.locations?: string` (não indexados → sem nova versão do Dexie, mesmo caso de `Highlight.note`).
- Modify `src/pages/Library.tsx` — `handleFiles` chama `prepareEpub` e salva o resultado; rótulo do botão durante a importação.
- Modify `src/pages/Reader.tsx` — `applyTheme` recebe `fontScale`; carregar `record.locations` quando existir; guardar as geradas quando não existir.
- Modify `CHANGELOG.md` — entrada com o porquê.

**Commits:** pelas regras da usuária, **nenhum commit intermediário**. Um único commit no fim, só depois de aprovação explícita (Task 7).

---

### Task 1: `sanitizeCss` (puro, TDD)

**Files:**
- Create: `src/lib/epub/sanitize.ts`
- Test: `src/lib/epub/sanitize.test.ts`

Regras: remover `color`, `background-color` e `background` sem `url(` de qualquer regra; remover `white-space: pre*`/`break-spaces` exceto em seletores que miram `pre` ou `code`. Comentários são descartados nos blocos reescritos. Se nada mudou, devolve a string original (bytes idênticos → o arquivo não é reempacotado à toa).

- [ ] **Step 1: Escrever os testes que falham**

```ts
// src/lib/epub/sanitize.test.ts
import { describe, expect, it } from 'vitest'
import { sanitizeCss } from './sanitize'

describe('sanitizeCss', () => {
  it('remove a cor fixa e mantém o resto da regra', () => {
    const out = sanitizeCss('.s2 {\n  color: #000;\n  display: block\n}')
    expect(out).not.toMatch(/color/)
    expect(out).toMatch(/display: block/)
  })

  it('remove fundo de cor sólida mas mantém fundo com imagem', () => {
    const out = sanitizeCss('.a { background-color: #fff } .b { background: white } .c { background: url(bg.png) no-repeat }')
    expect(out).not.toMatch(/#fff|white/)
    expect(out).toMatch(/url\(bg\.png\) no-repeat/)
  })

  it('tira white-space pre-wrap de blocos comuns mas não de pre/code', () => {
    const out = sanitizeCss('.body { white-space: pre-wrap; display: block } pre { white-space: pre } p code { white-space: pre-line }')
    expect(out).toMatch(/\.body \{ display: block \}/)
    expect(out).toMatch(/pre \{ white-space: pre \}/)
    expect(out).toMatch(/p code \{ white-space: pre-line \}/)
  })

  it('não quebra url com ponto e vírgula (data URI) dentro de @font-face', () => {
    const css = '@font-face { font-family: X; src: url(data:font/ttf;base64,AAA=) } .p { color: red }'
    expect(sanitizeCss(css)).toMatch(/src: url\(data:font\/ttf;base64,AAA=\)/)
  })

  it('reescreve regras dentro de @media', () => {
    expect(sanitizeCss('@media screen { .p { color: red; margin: 0 } }')).toBe('@media screen { .p { margin: 0 } }')
  })

  it('devolve exatamente a mesma string quando não há nada para tirar', () => {
    const css = '/* fonte */\n.texto { font-size: 1em; color-adjust: exact }\n'
    expect(sanitizeCss(css)).toBe(css)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/epub/sanitize.test.ts`
Expected: FAIL — `Failed to resolve import "./sanitize"`.

- [ ] **Step 3: Implementar**

```ts
// src/lib/epub/sanitize.ts

// Book stylesheets fight the reader's theme in ways the theme can't win from
// body alone: a class's own `color` beats the inherited theme color, and a
// `white-space: pre-wrap` wrapper turns the HTML's indentation into blank
// lines. Only stylesheets are rewritten, never the chapter HTML, so CFIs
// (reading position, highlights) stay valid.

// Innermost `selector { declarations }` blocks — also the ones nested in @media.
const BLOCK = /([^{}]*)\{([^{}]*)\}/g
const COMMENT = /\/\*[\s\S]*?\*\//g
const PRE_SELECTOR = /(^|[\s>+~,(])(pre|code)\b/i

export function sanitizeCss(css: string): string {
  let changed = false
  const out = css.replace(COMMENT, '').replace(BLOCK, (block, selector: string, body: string) => {
    const keepPre = PRE_SELECTOR.test(selector)
    const declarations = splitDeclarations(body)
    const kept = declarations.filter((declaration) => !shouldDrop(declaration, keepPre))
    if (kept.length === declarations.length) return block
    changed = true
    return `${selector}{${kept.join(';')}}`
  })
  return changed ? out : css
}

function shouldDrop(declaration: string, keepPre: boolean): boolean {
  const colon = declaration.indexOf(':')
  if (colon < 0) return false
  const property = declaration.slice(0, colon).trim().toLowerCase()
  const value = declaration.slice(colon + 1).trim().toLowerCase()
  if (property === 'color' || property === 'background-color') return true
  if (property === 'background') return !value.includes('url(')
  if (property === 'white-space') return !keepPre && /^(pre|break-spaces)/.test(value)
  return false
}

// `;` inside url(...) or quotes (data URIs: `;base64,`) isn't a separator.
function splitDeclarations(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const char = body[i]
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if (char === '(') depth++
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if (char === ';' && depth === 0) {
      parts.push(body.slice(start, i))
      start = i + 1
    }
  }
  parts.push(body.slice(start))
  return parts
}
```

Nota sobre o teste do `@media`: `kept.join(';')` de `[' color: red', ' margin: 0 ']` sem o `color` dá `' margin: 0 '`, então o bloco vira `.p { margin: 0 }` — confere com o esperado.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/epub/sanitize.test.ts`
Expected: 6 passed.

### Task 2: `fontScaleFor` (puro, TDD)

**Files:**
- Modify: `src/lib/epub/sanitize.ts`
- Test: `src/lib/epub/sanitize.test.ts`

Recebe amostras `{ fontSize, chars }` medidas com o `body` forçado a `referencePx` e devolve o multiplicador que leva o tamanho dominante (o de mais caracteres, arredondado ao px) de volta a `referencePx`. Devolve `1` sem amostras, quando a diferença é < 5% (ruído) e quando o dominante está fora de 0,5×–2× (texto em `px`/`pt` absoluto não responde ao tamanho do body — escalar não ajudaria).

- [ ] **Step 1: Testes que falham** — trocar o import para `import { fontScaleFor, sanitizeCss } from './sanitize'` e acrescentar ao fim de `sanitize.test.ts`:

```ts
describe('fontScaleFor', () => {
  it('compensa o texto que sai menor que o tamanho escolhido', () => {
    const samples = [
      { fontSize: 77.4, chars: 100_000 },
      { fontSize: 142, chars: 300 },
    ]
    expect(fontScaleFor(samples, 100)).toBe(1.299)
  })

  it('usa o tamanho com mais caracteres, não a média', () => {
    const samples = [
      { fontSize: 100, chars: 5_000 },
      { fontSize: 50, chars: 4_000 },
    ]
    expect(fontScaleFor(samples, 100)).toBe(1)
  })

  it('ignora diferença pequena', () => {
    expect(fontScaleFor([{ fontSize: 97, chars: 10 }], 100)).toBe(1)
  })

  it('não escala livro com fonte absoluta (fora de 0,5x–2x)', () => {
    expect(fontScaleFor([{ fontSize: 16, chars: 10 }], 100)).toBe(1)
  })

  it('devolve 1 sem amostras', () => {
    expect(fontScaleFor([], 100)).toBe(1)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/epub/sanitize.test.ts`
Expected: FAIL — `fontScaleFor is not a function` (ou erro de export).

- [ ] **Step 3: Implementar** — acrescentar a `sanitize.ts`:

```ts
export interface FontSample {
  fontSize: number
  chars: number
}

// The theme forces its size on <body>, discarding the book's own body size —
// and books whose text sizes are chained from it (body 1.29em × p 0.58em)
// end up smaller than what the reader picked. This is the factor that brings
// the most common text size back to the body size.
export function fontScaleFor(samples: FontSample[], referencePx: number): number {
  const charsBySize = new Map<number, number>()
  for (const { fontSize, chars } of samples) {
    const size = Math.round(fontSize)
    charsBySize.set(size, (charsBySize.get(size) ?? 0) + chars)
  }
  let dominant = 0
  let most = 0
  for (const [size, chars] of charsBySize) {
    if (chars > most) [dominant, most] = [size, chars]
  }
  if (!dominant) return 1
  const ratio = dominant / referencePx
  if (ratio < 0.5 || ratio > 2 || Math.abs(ratio - 1) < 0.05) return 1
  return Math.round((referencePx / dominant) * 1000) / 1000
}
```

Conferência do primeiro teste: dominante = `round(77.4)` = 77 → `100/77` = 1.2987 → `1.299`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/epub/sanitize.test.ts`
Expected: 11 passed.

### Task 3: Expor helpers de `edit.ts`

**Files:**
- Modify: `src/lib/epub/edit.ts` (funções `assertNotProtected` ~l.103, `loadPackage` ~l.114, `resolvePath` ~l.389, `repack` ~l.414)

- [ ] **Step 1:** Trocar `async function assertNotProtected(` por `export async function assertNotProtected(`, `async function loadPackage(` por `export async function loadPackage(`, `function resolvePath(` por `export function resolvePath(` e `async function repack(` por `export async function repack(`. Nada mais muda nesses corpos.

- [ ] **Step 2:** Run: `npx tsc -b` — Expected: sem erros.

### Task 4: `prepareEpub` (navegador)

**Files:**
- Create: `src/lib/epub/prepare.ts`

- [ ] **Step 1: Implementar**

```ts
// src/lib/epub/prepare.ts
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
      doc.querySelectorAll('link, script, img, image, video, audio, iframe, object, embed, source').forEach((el) => el.remove())

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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`sem resposta em ${ms} ms`)), ms)),
  ])
}

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
```

- [ ] **Step 2:** Run: `npx tsc -b && npm run lint` — Expected: sem erros. (Se o tipo de `book.on` reclamar, é o mesmo uso de `parse.ts`; copiar de lá.)

### Task 5: Salvar o livro preparado

**Files:**
- Modify: `src/lib/db/schema.ts` (interface `Book`)
- Modify: `src/pages/Library.tsx` (`handleFiles`, ~l.312-330; rótulos "Importando..." ~l.409, 469, 574)

- [ ] **Step 1: Schema** — em `interface Book`, depois de `addedAt: number`:

```ts
  // Multiplies the theme's font size so the book's main text lands on it;
  // measured on import (see prepareEpub). Absent on books imported before.
  fontScale?: number
  // book.locations.save() for the stored file. Not indexed, so adding these
  // needed no new database version.
  locations?: string
```

- [ ] **Step 2: Library** — importar `import { prepareEpub } from "@/lib/epub/prepare";` e trocar o corpo do `try` dentro do `for`:

```tsx
          const metadata = await parseEpubMetadata(file);
          const prepared = await prepareEpub(file);
          await addBook({
            id: uuid(),
            title: metadata.title,
            author: metadata.author,
            coverBlob: metadata.coverBlob,
            fileBlob: prepared.fileBlob,
            fontScale: prepared.fontScale,
            locations: prepared.locations,
            addedAt: Date.now(),
          });
```

- [ ] **Step 3:** Trocar os três `"Importando..."` por `"Preparando livro..."` — a importação agora leva até ~15 s em livros com muitos capítulos e o texto explica a espera.

- [ ] **Step 4:** Run: `npx tsc -b` — Expected: sem erros.

### Task 6: Reader usa `fontScale` e `locations` salvas

**Files:**
- Modify: `src/pages/Reader.tsx` — `applyTheme` (~l.204-223), `appliedThemeRef` (~l.829), `open()` (~l.836-870, ~l.938, ~l.970-977, ~l.1060-1075), comentário do cleanup (~l.1098), efeito de tema (~l.1330-1336); import de `updateBook` (~l.19).

- [ ] **Step 1: `applyTheme`** — assinatura `function applyTheme(rendition: Rendition, theme: Theme, fontScale: number)` e a linha do tamanho:

```ts
  rendition.themes.fontSize(`${theme.fontSize * fontScale}px`)
```

- [ ] **Step 2: ref da escala** — junto de `appliedThemeRef`:

```ts
  // The open book's own correction (Book.fontScale); 1 until open() reads it.
  const fontScaleRef = useRef(1)
```

e no efeito de tema: `applyTheme(rendition, activeTheme, fontScaleRef.current)`.

- [ ] **Step 3: `open()`** — logo depois de `setBookTitle(record.title)`:

```ts
      fontScaleRef.current = record.fontScale ?? 1
```

e na chamada inicial: `applyTheme(rendition, activeTheme, fontScaleRef.current)`.

- [ ] **Step 4: locations** — substituir o bloco `const locationsBook = ...` / `locationsGenerated` / `locationsReady` por:

```ts
      // Saved on import (prepareEpub): loading them is instant and touches
      // no Section, so the rendering Book can hold them. Books imported
      // before that generate them here once and keep them for next time.
      let locations: EpubBook['locations'] | undefined
      const locationsReady = record.locations
        ? book.ready.then(() => {
            book.locations.load(record.locations!)
            locations = book.locations
          })
        : (async () => {
            // book.locations.generate() walks the spine loading and unloading
            // each Section — not safe alongside the rendition reading those
            // same Sections (crashed inside epub.js), so it runs on a second,
            // independent Book parsed from the same bytes.
            const locationsBook = ePub(arrayBuffer.slice(0))
            await locationsBook.ready
            await locationsBook.locations.generate(LOCATION_CHARS)
            locations = locationsBook.locations
            await updateBook(bookId!, { locations: locationsBook.locations.save() })
          })()
```

`percentageForCfi` passa a ser:

```ts
      const percentageForCfi = (cfi: string): number | undefined =>
        locations ? Math.round(locations.percentageFromCfi(cfi) * 100) : undefined
```

Manter o comentário existente acima dele ("Not length() > 1 …") — continua valendo para o caminho que gera. Imports: `import { getBook, updateBook } from '@/lib/db/books'` e `import { LOCATION_CHARS } from '@/lib/epub/prepare'`. No `locationsReady.then(...)` existente nada muda. Acrescentar `.catch((error) => console.error('Não foi possível calcular as posições do livro', error))` antes do `.then` se o lint acusar promise sem tratamento — hoje não há, então só se o comportamento mudar.

- [ ] **Step 5: comentário do cleanup** — o parágrafo que começa com "locationsBook is deliberately not destroyed here" continua verdadeiro (agora só no caminho que gera); trocar "locationsBook" por "the locations Book (books imported before prepareEpub)" na primeira frase.

- [ ] **Step 6:** Run: `npx tsc -b && npm run lint && npm test` — Expected: tudo verde.

### Task 7: Verificar no navegador, CHANGELOG e commit

O painel do navegador precisa estar **visível** durante toda a verificação: com ele oculto o `requestAnimationFrame` para, e tanto a importação (`generate`) quanto a abertura do livro parecem travadas — já aconteceu no diagnóstico.

- [ ] **Step 1: Limpar a biblioteca de teste** — no app (`preview_start` com `leitor-epub`), remover os três livros importados antes desta mudança.

- [ ] **Step 2: Importar os três** de `public/epubs.local/` (via `DataTransfer` no `input[type=file]`, como no diagnóstico). Conferir no console que não houve `console.warn` de saneamento; conferir com `javascript_tool` em `indexedDB` (Dexie `leitor-epub`, tabela `books`) que cada registro tem `locations` (string) e `fontScale` — esperado ≈1.299 no *Ponto de Impacto* e 1 nos outros dois.

- [ ] **Step 3: Ponto de Impacto, tema escuro** — abrir um capítulo; no iframe, `getComputedStyle` de `p.s2`/`span.c`: cor = cor do tema, tamanho do texto de `span.c` = tamanho do tema (18px no padrão) ±1px; sem vãos entre parágrafos (`div.body` com `white-space: normal`). Screenshot como prova.

- [ ] **Step 4: Porcentagem** — abrir *Fortaleza Digital* num capítulo do meio: a porcentagem aparece certa logo que a página carrega (não 0%). Reabrir: idem.

- [ ] **Step 5: Regressões** — *Matéria escura* e `fixtures/livro-de-teste.epub` abrem e paginam como antes; grifar um trecho e reabrir mantém o grifo; editar título de um livro saneado (diálogo de edição) continua funcionando e a porcentagem segue certa.

- [ ] **Step 6: CHANGELOG** — nova seção `## 2026-10-14` em `CHANGELOG.md`:

```markdown
- **Saneamento do EPUB na importação** (`src/lib/epub/prepare.ts`, `src/lib/epub/sanitize.ts`): os CSS do livro perdem `color`, fundos de cor sólida e `white-space: pre*` (fora de `pre`/`code`); mede-se o tamanho de fonte dominante e guarda-se um `fontScale` que o Reader aplica sobre o tamanho do tema; as posições da porcentagem (`locations`) são calculadas e salvas junto do livro.
  - _Por quê_: livros reais (convertidos pelo Calibre/Kobo) fixavam texto preto, mostravam a indentação do HTML como linhas em branco e encadeavam tamanhos a partir de um `body` que o tema sobrescreve (texto ~23% menor que o escolhido). Saneia-se só o CSS, nunca o HTML dos capítulos, para os CFIs (progresso e grifos) continuarem válidos. Decisão de salvar só a versão saneada (sem guardar o original): EPUBs variam demais para valer reprocessar, e guardar dois arquivos dobraria o espaço. As `locations` levavam ~15 s para gerar em livros com 130+ arquivos e eram refeitas a cada abertura — a porcentagem ficava em 0% esse tempo todo; agora o custo é pago uma vez, na importação. Livros importados antes guardam as suas na primeira abertura.
```

- [ ] **Step 7: Pedir aprovação e commitar** — avisar que está pronto e perguntar se pode commitar. Só com o "sim":

```bash
git add src/lib/epub/sanitize.ts src/lib/epub/sanitize.test.ts src/lib/epub/prepare.ts src/lib/epub/edit.ts src/lib/db/schema.ts src/pages/Library.tsx src/pages/Reader.tsx CHANGELOG.md docs/superpowers/plans/2026-10-14-saneamento-de-epub.md
git commit -m "feat(import): saneia o CSS do EPUB e pré-calcula a porcentagem na importação"
```

`public/epubs.local/` fica fora do commit (gitignored por `*.local`).
