# Abas, links, ponto de retorno e navegação no computador: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o spec `docs/superpowers/specs/2026-10-22-ux-abas-links-navegacao-design.md`:
- abas "Baixados | Todos";
- links do livro com cor legível e tratados pelo app;
- ponto de retorno depois de qualquer salto, com o Voltar do sistema integrado;
- roda e trackpad, Home/End e a lista de atalhos no computador.

**Architecture:** A lógica nova fica em módulos puros testados no Vitest:
- `src/lib/shelf.ts`
- `src/lib/theme-colors.ts` (`linkColor`)
- `src/lib/reader/links.ts`
- `src/lib/reader/checkpoint.ts`
- `src/lib/reader/wheel-paging.ts`

O `src/pages/Reader.tsx` só liga eventos do epub.js e do React Router a esses módulos. Componentes novos pequenos: `ReturnButton`, `ShortcutsDialog`.

**Tech Stack:** React 19 + TypeScript, epub.js 0.3.93, react-router-dom 7, Vitest, Tailwind v4, shadcn/ui.

**Regras do usuário que valem para o executor:**
- **Nenhum commit durante a execução.** Um commit único no fim (Task 14), só depois de o usuário aprovar na conversa. A mensagem tem uma linha só, no formato Conventional Commits em português.
- O working tree é CRLF. Use a ferramenta Edit, nunca `sed -i`, e não ponha barras invertidas em heredocs.
- Sem comentários óbvios. Só comente uma razão que o código não deixa evidente.
- Todo elemento clicável feito à mão leva `cursor-pointer`; os desabilitados, `cursor-not-allowed`.
- Não acessar `db.*` fora de `src/lib/db/`.

Comandos: `npm test` (Vitest), `npm run lint`, `npm run build`, `npm run epub:generate`, `npm run epub:validate`.

---

## Mapa de arquivos

| Arquivo | O que muda |
|---|---|
| `scripts/generate-test-epub.mjs` | capítulo 1 com links, `notas.xhtml`, `estilo.css`, `figura.png` |
| `scripts/validate-epub.mjs` | confere os links internos dos capítulos |
| `fixtures/livro-de-teste.epub` | regerado |
| `src/lib/shelf.ts` (+ `.test.ts`) | `effectiveShelf` |
| `src/pages/Library.tsx` | abas "Baixados \| Todos" |
| `src/lib/theme-colors.ts` (+ `.test.ts`) | `contrastRatio`, `mixHex`, `linkColor` |
| `src/lib/reader/links.ts` (+ `.test.ts`) | `linkStylesheet`, `isExternalHref` |
| `src/lib/reader/checkpoint.ts` (+ `.test.ts`) | máquina de estados do ponto de retorno |
| `src/lib/reader/wheel-paging.ts` (+ `.test.ts`) | detector de roda/trackpad |
| `src/components/ProgressBar.tsx` | prop `marker` |
| `src/components/reader/ReturnButton.tsx` | botão "↩ Voltar · 12%" + ✕ |
| `src/components/reader/ShortcutsDialog.tsx` | lista de atalhos |
| `src/components/reader/ReaderSettings.tsx` | item "Atalhos do teclado" |
| `src/pages/Reader.tsx` | ligação de tudo |
| `src/index.css` | `overscroll-behavior-x: none` |
| `CHANGELOG.md`, `CLAUDE.md` | registro e descrição do fixture |

---

### Task 1: Fixture com links

**Files:**
- Modify: `scripts/generate-test-epub.mjs`
- Modify: `scripts/validate-epub.mjs`
- Regenerate: `fixtures/livro-de-teste.epub`

- [ ] **Step 1: Validador confere os links internos dos capítulos**

Em `scripts/validate-epub.mjs`, depois do bloco `// 7. cheap well-formedness signal…` e antes dos `console.log` finais, acrescente:

```js
// 8. every internal link inside the chapters resolves, anchors included — the
// same silent failure as a broken TOC entry, but from inside the text.
let chapterLinksChecked = 0
for (const idref of spine) {
  if (!manifest.has(idref)) continue
  const chapterHref = manifest.get(idref).href
  const chapterDir = chapterHref.includes('/') ? chapterHref.slice(0, chapterHref.lastIndexOf('/') + 1) : ''
  const contents = await zip.file(opfDir + chapterHref).async('string')
  for (const match of contents.matchAll(/<a\s[^>]*href="([^"]+)"/g)) {
    const href = match[1]
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue
    const [file, fragment] = href.split('#')
    const targetPath = file ? opfDir + chapterDir + file : opfDir + chapterHref
    const entry = zip.file(targetPath)
    chapterLinksChecked++
    if (!entry) {
      problems.push(`${idref}: link para arquivo inexistente: ${href}`)
      continue
    }
    if (fragment && !(await entry.async('string')).includes(`id="${fragment}"`)) {
      problems.push(`${idref}: link para âncora inexistente: ${href}`)
    }
  }
}
```

Depois da linha `console.log(\`links no sumário: …\`)`, acrescente:

```js
console.log(`links nos capítulos: ${chapterLinksChecked} (todos conferidos)`)
```

- [ ] **Step 2: Rodar o validador no fixture atual**

Run: `npm run epub:validate`
Expected: `links nos capítulos: 0 (todos conferidos)` e `OK — nenhum problema encontrado`.

- [ ] **Step 3: Gerador — CSS, figura, links no capítulo 1 e capítulo de notas**

Em `scripts/generate-test-epub.mjs`:

(a) Troque `chapterXhtml(n)` inteira por:

```js
// Chapter 1 carries every link shape the reader handles: plain cross-reference,
// EPUB 3 noteref, the older <sup><a>, a link around an image and an external one.
function linksBlock() {
  return `    <p>Este capítulo tem links para testar o leitor: veja o <a href="cap3.xhtml#sec-3-2">trecho 3.2</a>, a nota longa<a epub:type="noteref" href="notas.xhtml#n1" id="ref-n1"><sup>1</sup></a>, a nota antiga<sup><a href="notas.xhtml#n2" id="ref-n2">2</a></sup> e o <a href="https://example.com/">site externo</a>.</p>
    <p><a href="cap2.xhtml"><img src="figura.png" alt="Figura que leva ao capítulo 2" /></a></p>
`
}

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
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="pt-BR" lang="pt-BR">
  <head>
    <title>Capítulo ${n}</title>
    <meta charset="utf-8" />
    <link rel="stylesheet" type="text/css" href="estilo.css" />
  </head>
  <body>
    <h1>Capítulo ${n}</h1>
${n === 1 ? linksBlock() : ''}${sections}
  </body>
</html>
`
}

// The long note spans more than one page on a phone, which is the case the
// return button must survive (turning pages inside the note keeps it).
function notesXhtml() {
  const longNote = Array.from({ length: 14 }, (_, i) => `      <p>${paragraph(900 + i)}</p>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="pt-BR" lang="pt-BR">
  <head>
    <title>Notas</title>
    <meta charset="utf-8" />
    <link rel="stylesheet" type="text/css" href="estilo.css" />
  </head>
  <body>
    <h1 id="notas">Notas</h1>
    <aside epub:type="footnote" id="n1">
      <p><a href="cap1.xhtml#ref-n1">&#8617;</a> 1. Uma nota longa, de várias páginas.</p>
${longNote}
    </aside>
    <aside epub:type="footnote" id="n2">
      <p><a href="cap1.xhtml#ref-n2">&#8617;</a> 2. Uma nota curta.</p>
    </aside>
  </body>
</html>
`
}

// The book's own link styling, which the reader theme has to beat: the import
// sanitizer drops `color`, but `text-decoration: none` survives it.
const STYLESHEET = `a { color: #0000cc; text-decoration: none; }
img { max-width: 100%; }
`
```

(b) Em `manifestItems`, depois da linha do `cover-image`, acrescente:

```js
  '    <item id="figura" href="figura.png" media-type="image/png"/>',
  '    <item id="estilo" href="estilo.css" media-type="text/css"/>',
```

e, no fim do array (depois do spread dos capítulos):

```js
  '    <item id="notas" href="notas.xhtml" media-type="application/xhtml+xml"/>',
```

(c) `spineItems` passa a terminar com as notas:

```js
const spineItems = [
  ...Array.from({ length: CHAPTER_COUNT }, (_, i) => `    <itemref idref="cap${i + 1}"/>`),
  '    <itemref idref="notas"/>',
].join('\n')
```

(d) Em `navXhtml`, depois de `${navEntries}`, acrescente a linha:

```js
      <li><a href="notas.xhtml#notas">Notas</a></li>
```

(e) Depois do laço que grava os capítulos no zip, acrescente:

```js
zip.file('OEBPS/notas.xhtml', notesXhtml())
zip.file('OEBPS/estilo.css', STYLESHEET)
zip.file('OEBPS/figura.png', makeCoverPng(300, 180))
```

(f) No comentário do topo, troque "eight chapters" por "eight chapters plus a notes section, links of every shape the reader handles". No último `console.log`, acrescente `+ notas`.

- [ ] **Step 4: Regerar e validar**

Run: `npm run epub:generate; npm run epub:validate`
Expected: `capítulos na spine: 9`, `links nos capítulos: 6 (todos conferidos)` e `OK`. São 4 links no `linksBlock` (3.2, n1, n2 e a figura; o externo é pulado) e 2 ↩ nas notas.

- [ ] **Step 5: Determinismo**

Run: `npm run epub:generate` duas vezes e `git hash-object fixtures/livro-de-teste.epub` depois de cada uma.
Expected: o mesmo hash nas duas.

---

### Task 2: Abas "Baixados | Todos"

**Files:**
- Create: `src/lib/shelf.ts`, `src/lib/shelf.test.ts`
- Modify: `src/pages/Library.tsx` (~193-200, 211, 333-346, 480-512)

- [ ] **Step 1: Teste**

`src/lib/shelf.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { effectiveShelf, parseShelf } from './shelf'

describe('effectiveShelf', () => {
  it('a escolha salva vence sempre', () => {
    expect(effectiveShelf('todos', true, false)).toBe('todos')
    expect(effectiveShelf('baixados', false, false)).toBe('baixados')
  })

  it('sem escolha, abre em Baixados quando há livro baixado', () => {
    expect(effectiveShelf(null, true, false)).toBe('baixados')
  })

  it('sem escolha e nada baixado, abre em Todos para não mostrar a grade vazia', () => {
    expect(effectiveShelf(null, false, false)).toBe('todos')
  })

  it('uma importação em andamento conta como livro baixado', () => {
    expect(effectiveShelf(null, false, true)).toBe('baixados')
  })
})

describe('parseShelf', () => {
  it('lê os valores salvos, inclusive o antigo "aparelho"', () => {
    expect(parseShelf('todos')).toBe('todos')
    expect(parseShelf('baixados')).toBe('baixados')
    expect(parseShelf('aparelho')).toBe('baixados')
    expect(parseShelf(null)).toBeNull()
    expect(parseShelf('outra')).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/shelf.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementação**

`src/lib/shelf.ts`:

```ts
// Which books the library grid shows while some are only on Drive.
export type Shelf = 'baixados' | 'todos'

export function parseShelf(saved: string | null): Shelf | null {
  if (saved === 'todos') return 'todos'
  // "aparelho" is what the tab was called before it became "Baixados".
  if (saved === 'baixados' || saved === 'aparelho') return 'baixados'
  return null
}

// Without a choice made this session, a device whose books are all still on
// Drive would open on an empty "Baixados" grid.
export function effectiveShelf(saved: Shelf | null, anyDownloaded: boolean, importing: boolean): Shelf {
  return saved ?? (anyDownloaded || importing ? 'baixados' : 'todos')
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/shelf.test.ts`
Expected: PASS.

- [ ] **Step 5: Library.tsx**

(a) Troque o bloco `type Shelf … function readShelf() {…}` por:

```tsx
// Kept for the session, so coming back from the reader (which navigates to
// "/") doesn't reset it.
const SHELF_KEY = "mybooks:estante";

function readShelf(): Shelf | null {
  try {
    return parseShelf(sessionStorage.getItem(SHELF_KEY));
  } catch {
    return null;
  }
}
```

e importe `import { effectiveShelf, parseShelf, type Shelf } from "@/lib/shelf";`.

(b) `const [shelf, setShelf] = useState<Shelf>(readShelf);` vira:

```tsx
  const [savedShelf, setSavedShelf] = useState<Shelf | null>(readShelf);
```

(c) Logo depois da linha `const someInCloud = …`, troque o cálculo de `visibleBooks` por:

```tsx
  const shelf = effectiveShelf(savedShelf, books.some(hasFile), importItems.length > 0);
  const visibleBooks: Book[] =
    someInCloud && shelf === "baixados" ? sortedBooks.filter(hasFile) : sortedBooks;
```

`importItems` é declarado na linha ~257, antes deste trecho. Confira.

(d) Em `chooseShelf`, troque `setShelf(next)` por `setSavedShelf(next)`.

(e) No seletor: troque `className="mb-4 flex w-full max-w-xs gap-1 …"` por `className="mb-4 flex w-full gap-1 rounded-lg bg-muted p-1 text-sm sm:max-w-xs"` e o array por:

```tsx
                    ["baixados", "Baixados"],
                    ["todos", "Todos"],
```

Atualize o comentário `{/* "No aparelho" is what … */}` para `{/* "Baixados" is what can be read without a connection. */}`.

- [ ] **Step 6: Testes, lint e tipos**

Run: `npm test; npm run lint; npx tsc -b`
Expected: tudo passa.

---

### Task 3: `linkColor`

**Files:**
- Modify: `src/lib/theme-colors.ts`
- Create: `src/lib/theme-colors.test.ts`

- [ ] **Step 1: Teste**

`src/lib/theme-colors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PRESET_THEMES } from '@/lib/db/presets'
import { contrastRatio, linkColor, mixHex } from './theme-colors'

const target = (text: string, background: string) => Math.max(4.5, Math.min(7, contrastRatio(text, background)))
const isBluish = (hex: string) => parseInt(hex.slice(5, 7), 16) > parseInt(hex.slice(1, 3), 16)

describe('contrastRatio', () => {
  it('bate com os valores conhecidos do WCAG', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrastRatio('#0000ee', '#1a1a1f')).toBeCloseTo(1.84, 1)
  })
})

describe('mixHex', () => {
  it('mistura em proporção', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixHex('#123456', '#ffffff', 1)).toBe('#123456')
  })
})

describe('linkColor', () => {
  it.each(PRESET_THEMES.map((theme) => [theme.name, theme] as const))(
    '%s: azul com o contraste do alvo contra o fundo',
    (_, theme) => {
      const color = linkColor(theme)
      expect(color).toMatch(/^#[0-9a-f]{6}$/)
      expect(isBluish(color)).toBe(true)
      expect(contrastRatio(color, theme.background)).toBeGreaterThanOrEqual(target(theme.textColor, theme.background) - 0.01)
    }
  )

  it('no Escuro sai claro (o problema que motivou isto)', () => {
    const escuro = PRESET_THEMES.find((theme) => theme.id === 'preset-escuro')!
    expect(contrastRatio(linkColor(escuro), escuro.background)).toBeGreaterThan(6.9)
  })

  it.each([
    ['preto/branco', { textColor: '#ffffff', background: '#000000' }],
    ['azul-noite', { textColor: '#ffffff', background: '#0b1e3a' }],
    ['cinza sobre cinza escuro', { textColor: '#9a9a9a', background: '#2b2b2b' }],
    ['texto marrom', { textColor: '#5a3b00', background: '#fdf6e3' }],
  ])('personalizado %s: passa do alvo ou volta para a cor do texto', (_, theme) => {
    const color = linkColor(theme)
    if (color !== theme.textColor) {
      expect(contrastRatio(color, theme.background)).toBeGreaterThanOrEqual(target(theme.textColor, theme.background) - 0.01)
    }
  })

  it('sem contraste mínimo possível, usa a cor do texto', () => {
    expect(linkColor({ textColor: '#777777', background: '#888888' })).toBe('#777777')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/theme-colors.test.ts`
Expected: FAIL (exports inexistentes).

- [ ] **Step 3: Implementação**

Acrescente ao fim de `src/lib/theme-colors.ts`:

```ts
type Rgb = [number, number, number]

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1, 7), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// Plain sRGB mix: `weight` of `a` over `b`. Used where color-mix() can't be
// (inside the book's iframe, whose browser support isn't ours to assume).
export function mixHex(a: string, b: string, weight: number): string {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  return rgbToHex([0, 1, 2].map((i) => ca[i] * weight + cb[i] * (1 - weight)) as Rgb)
}

function oklabLightness(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
}

// Linear sRGB for an OKLCH color, or null when it falls outside sRGB.
function oklchToLinear(L: number, C: number, hueDeg: number): Rgb | null {
  const h = (hueDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const rgb: Rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return rgb.every((c) => c >= -1e-6 && c <= 1 + 1e-6) ? rgb : null
}

const LINK_HUE = 255
const LINK_MAX_CHROMA = 0.14
const LINK_TARGET = 7
const LINK_FLOOR = 4.5

function blueAt(L: number): string {
  for (let C = LINK_MAX_CHROMA; C > 0; C -= 0.005) {
    const rgb = oklchToLinear(L, C, LINK_HUE)
    if (rgb) return rgbToHex(rgb.map(fromLinear) as Rgb)
  }
  return rgbToHex(oklchToLinear(L, 0, LINK_HUE)!.map(fromLinear) as Rgb)
}

// The book's link color: a blue at the text's lightness, walked toward the
// middle (bluer) for as long as it still reads against the background. Up to
// 7:1, never below 4.5:1; a theme where not even that fits keeps its text color.
export function linkColor(theme: Pick<Theme, 'textColor' | 'background'>): string {
  const { textColor, background } = theme
  const textContrast = contrastRatio(textColor, background)
  if (textContrast < LINK_FLOOR) return textColor
  const target = Math.max(LINK_FLOOR, Math.min(LINK_TARGET, textContrast))
  const lightBackground = luminance(background) > luminance(textColor)
  const start = oklabLightness(textColor)
  const end = lightBackground ? Math.max(start, 0.75) : Math.min(start, 0.45)
  const step = lightBackground ? 0.01 : -0.01
  let best: string | undefined
  for (let L = start; lightBackground ? L <= end : L >= end; L += step) {
    const candidate = blueAt(L)
    if (contrastRatio(candidate, background) >= target) best = candidate
    else if (best) break
  }
  return best ?? textColor
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/theme-colors.test.ts`
Expected: PASS. Se `isBluish` falhar num preset, imprima `linkColor` dele e confira: o canal azul precisa ser maior que o vermelho. Se não for, o laço parou cedo demais.

---

### Task 4: CSS dos links (`links.ts`)

**Files:**
- Create: `src/lib/reader/links.ts`, `src/lib/reader/links.test.ts`

- [ ] **Step 1: Teste**

```ts
import { describe, expect, it } from 'vitest'
import { PRESET_THEMES } from '@/lib/db/presets'
import { linkColor } from '@/lib/theme-colors'
import { isExternalHref, linkStylesheet } from './links'

describe('linkStylesheet', () => {
  const escuro = PRESET_THEMES.find((theme) => theme.id === 'preset-escuro')!

  it('pinta todo link com a cor do tema, por cima do CSS do livro', () => {
    expect(linkStylesheet(escuro)).toContain(`a[href] { color: ${linkColor(escuro)} !important; }`)
  })

  it('sublinha os links e tira o sublinhado de notas e imagens', () => {
    const css = linkStylesheet(escuro)
    expect(css).toContain('text-decoration-line: underline !important')
    expect(css).toMatch(/a\[epub\\:type~="noteref"\][^{]*\{ text-decoration-line: none !important; \}/)
    expect(css).toContain('a[href]:has(img, svg)')
  })

  it('isola o :has() numa regra própria', () => {
    const rule = linkStylesheet(escuro).split('\n').find((line) => line.includes(':has('))!
    expect(rule).not.toContain('noteref')
  })
})

describe('isExternalHref', () => {
  it('reconhece endereços com esquema', () => {
    expect(isExternalHref('https://example.com/')).toBe(true)
    expect(isExternalHref('mailto:a@b.c')).toBe(true)
    expect(isExternalHref('cap2.xhtml#x')).toBe(false)
    expect(isExternalHref('#n1')).toBe(false)
    expect(isExternalHref('../Text/cap2.xhtml')).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/reader/links.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementação**

`src/lib/reader/links.ts`:

```ts
import type { Theme } from '@/lib/db/schema'
import { linkColor, mixHex } from '@/lib/theme-colors'

export const LINK_STYLE_ID = 'mybooks-links'

// One rule per line: set as a <style>'s text, a rule the browser can't parse
// (:has() on an old engine) drops alone. Through rendition.themes.default()
// the same rule would throw from insertRule and abort the rest of the theme.
// Both spellings of epub:type, because the chapter is read as HTML (srcdoc),
// where only the escaped one matches, and as XHTML elsewhere.
export function linkStylesheet(theme: Pick<Theme, 'textColor' | 'background'>): string {
  const color = linkColor(theme)
  const underline = mixHex(color, theme.background, 0.6)
  return [
    `a[href] { color: ${color} !important; }`,
    `a[href] { text-decoration-line: underline !important; text-decoration-thickness: 1px; text-underline-offset: 0.15em; text-decoration-color: ${underline}; }`,
    `a[epub\\:type~="noteref"], a[*|type~="noteref"], a[role~="doc-noteref"], sup > a[href] { text-decoration-line: none !important; }`,
    `a[href]:has(> sup:only-child), a[href]:has(img, svg) { text-decoration-line: none !important; }`,
  ].join('\n')
}

export function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href)
}

export function applyLinkStyles(doc: Document, css: string): void {
  let style = doc.getElementById(LINK_STYLE_ID)
  if (!style) {
    style = doc.createElement('style')
    style.id = LINK_STYLE_ID
    doc.head.appendChild(style)
  }
  style.textContent = css
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/reader/links.test.ts`
Expected: PASS.

---

### Task 5: Cor dos links no livro

**Files:**
- Modify: `src/pages/Reader.tsx` (hook de conteúdo ~932; efeito de tema ~1367)

- [ ] **Step 1: Hook de conteúdo**

Importe `import { applyLinkStyles, linkStylesheet } from '@/lib/reader/links'`. No `rendition.hooks.content.register(...)`, logo depois de `contents.addStylesheetCss(readerFontsCss, 'reader-fonts')`:

```ts
        applyLinkStyles(contents.document, linkStylesheet(useThemeStore.getState().activeTheme))
```

Ler da store em vez do `activeTheme` capturado: o hook roda a cada seção nova, e o tema pode ter mudado desde a abertura.

- [ ] **Step 2: Troca de tema**

No efeito de tema ao vivo, logo depois de `applyTheme(rendition, activeTheme, fontScaleRef.current)`:

```ts
    const css = linkStylesheet(activeTheme)
    for (const contents of rendition.getContents() as unknown as Contents[]) {
      if (contents.document) applyLinkStyles(contents.document, css)
    }
```

- [ ] **Step 3: Verificar no navegador**

Suba o preview (`preview_start`), importe `fixtures/livro-de-teste.epub` e abra o capítulo 1. Com `javascript_tool`, leia `getComputedStyle` de um link dentro do iframe (`document.querySelector('iframe').contentDocument.querySelector('a[href^="cap3"]')`) nos temas Claro e Escuro.

Expected: `color` igual a `linkColor` do tema e `text-decoration-line: underline`. Na nota `epub:type`, no `sup > a` e no link da figura, `none`. Tire um screenshot no Escuro.

---

### Task 6: Máquina de estados do ponto de retorno

**Files:**
- Create: `src/lib/reader/checkpoint.ts`, `src/lib/reader/checkpoint.test.ts`

- [ ] **Step 1: Teste**

```ts
import { describe, expect, it } from 'vitest'
import { IDLE_CHECKPOINT, savedOrigin, stepCheckpoint, type CheckpointEvent, type CheckpointState, type Origin } from './checkpoint'

const origin: Origin = { cfi: 'epubcfi(/6/4!/4/2/1:0)', percentage: 12, chapterLabel: 'Capítulo 3' }

function run(events: CheckpointEvent[], from: CheckpointState = IDLE_CHECKPOINT) {
  let state = from
  const effects: string[] = []
  for (const event of events) {
    const step = stepCheckpoint(state, event)
    state = step.state
    effects.push(...step.effects.map((effect) => effect.type))
  }
  return { state, effects }
}

describe('stepCheckpoint', () => {
  it('um salto fica pendente até sair da origem, e aí guarda a entrada no histórico', () => {
    expect(run([{ type: 'jump', origin }]).state).toEqual({ status: 'pending', origin })
    expect(run([{ type: 'jump', origin }, { type: 'relocated', showsOrigin: false }])).toEqual({
      state: { status: 'active', origin },
      effects: ['pushGuard'],
    })
  })

  it('um relocated ainda na origem não descarta o pendente (refit antes do salto)', () => {
    expect(run([{ type: 'jump', origin }, { type: 'relocated', showsOrigin: true }]).state.status).toBe('pending')
  })

  it('salto que assenta na mesma página é descartado', () => {
    expect(run([{ type: 'jump', origin }, { type: 'jumpSettled', showsOrigin: true }])).toEqual({ state: IDLE_CHECKPOINT, effects: [] })
  })

  it('salto que assenta fora da origem ativa o ponto, uma vez só', () => {
    const { state, effects } = run([
      { type: 'jump', origin },
      { type: 'relocated', showsOrigin: false },
      { type: 'jumpSettled', showsOrigin: false },
    ])
    expect(state.status).toBe('active')
    expect(effects).toEqual(['pushGuard'])
  })

  it('salto que falha volta para idle', () => {
    expect(run([{ type: 'jump', origin }, { type: 'jumpFailed' }]).state).toEqual(IDLE_CHECKPOINT)
  })

  it('saltos seguintes não trocam a origem', () => {
    const other: Origin = { cfi: 'epubcfi(/6/20!/4/2/1:0)', percentage: 91 }
    const { state } = run([
      { type: 'jump', origin },
      { type: 'relocated', showsOrigin: false },
      { type: 'jump', origin: other },
      { type: 'relocated', showsOrigin: false },
    ])
    expect(state).toEqual({ status: 'active', origin })
  })

  it('virar páginas dentro da nota não tira o ponto', () => {
    const active: CheckpointState = { status: 'active', origin }
    expect(run([{ type: 'relocated', showsOrigin: false }, { type: 'relocated', showsOrigin: false }], active)).toEqual({
      state: active,
      effects: [],
    })
  })

  it('chegar na origem por outro caminho tira o ponto e consome a entrada', () => {
    expect(run([{ type: 'relocated', showsOrigin: true }], { status: 'active', origin })).toEqual({
      state: IDLE_CHECKPOINT,
      effects: ['popGuard'],
    })
  })

  it('Voltar consome a entrada e vai para a origem', () => {
    const step = stepCheckpoint({ status: 'active', origin }, { type: 'back' })
    expect(step.state).toEqual(IDLE_CHECKPOINT)
    expect(step.effects).toEqual([{ type: 'popGuard' }, { type: 'goTo', cfi: origin.cfi }])
  })

  it('Voltar do sistema vai para a origem sem mexer no histórico (a entrada já saiu)', () => {
    const step = stepCheckpoint({ status: 'active', origin }, { type: 'systemBack' })
    expect(step.state).toEqual(IDLE_CHECKPOINT)
    expect(step.effects).toEqual([{ type: 'goTo', cfi: origin.cfi }])
  })

  it('✕ fica onde está: consome a entrada e grava a posição atual', () => {
    expect(run([{ type: 'dismiss' }], { status: 'active', origin })).toEqual({
      state: IDLE_CHECKPOINT,
      effects: ['popGuard', 'saveCurrent'],
    })
  })

  it('fechar o livro descarta o ponto', () => {
    expect(run([{ type: 'close' }], { status: 'active', origin }).state).toEqual(IDLE_CHECKPOINT)
  })

  it('a porcentagem da origem chega depois', () => {
    const without: Origin = { cfi: origin.cfi }
    expect(run([{ type: 'percentageReady', percentage: 40 }], { status: 'active', origin: without }).state).toEqual({
      status: 'active',
      origin: { cfi: origin.cfi, percentage: 40 },
    })
  })

  it('eventos sem ponto não fazem nada', () => {
    for (const event of [
      { type: 'relocated', showsOrigin: true },
      { type: 'back' },
      { type: 'systemBack' },
      { type: 'dismiss' },
      { type: 'jumpSettled', showsOrigin: false },
    ] as CheckpointEvent[]) {
      expect(stepCheckpoint(IDLE_CHECKPOINT, event)).toEqual({ state: IDLE_CHECKPOINT, effects: [] })
    }
  })
})

describe('savedOrigin', () => {
  it('enquanto o ponto existe, a posição gravada é a origem', () => {
    expect(savedOrigin(IDLE_CHECKPOINT)).toBeUndefined()
    expect(savedOrigin({ status: 'pending', origin })).toBe(origin)
    expect(savedOrigin({ status: 'active', origin })).toBe(origin)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/reader/checkpoint.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementação**

`src/lib/reader/checkpoint.ts`:

```ts
// The "back to where I was reading" point. One point only: the page before the
// first jump; jumps made while it exists (a link inside a note) keep it.
// `pending` until the jump has actually left the origin page — a jump to the
// page already on screen leaves nothing to go back to.

export interface Origin {
  cfi: string
  percentage?: number
  chapterLabel?: string
}

export type CheckpointState =
  | { status: 'idle' }
  | { status: 'pending'; origin: Origin }
  | { status: 'active'; origin: Origin }

export type CheckpointEvent =
  | { type: 'jump'; origin: Origin }
  | { type: 'relocated'; showsOrigin: boolean }
  | { type: 'jumpSettled'; showsOrigin: boolean }
  | { type: 'jumpFailed' }
  | { type: 'back' }
  | { type: 'systemBack' }
  | { type: 'dismiss' }
  | { type: 'close' }
  | { type: 'percentageReady'; percentage: number }

export type CheckpointEffect =
  | { type: 'pushGuard' }
  | { type: 'popGuard' }
  | { type: 'goTo'; cfi: string }
  | { type: 'saveCurrent' }

export const IDLE_CHECKPOINT: CheckpointState = { status: 'idle' }

interface Step {
  state: CheckpointState
  effects: CheckpointEffect[]
}

const stay = (state: CheckpointState): Step => ({ state, effects: [] })

export function stepCheckpoint(state: CheckpointState, event: CheckpointEvent): Step {
  if (event.type === 'close') return stay(IDLE_CHECKPOINT)
  if (state.status === 'idle') {
    return event.type === 'jump' ? stay({ status: 'pending', origin: event.origin }) : stay(state)
  }
  const { origin } = state
  if (state.status === 'pending') {
    switch (event.type) {
      case 'relocated':
        return event.showsOrigin ? stay(state) : { state: { status: 'active', origin }, effects: [{ type: 'pushGuard' }] }
      case 'jumpSettled':
        return event.showsOrigin
          ? stay(IDLE_CHECKPOINT)
          : { state: { status: 'active', origin }, effects: [{ type: 'pushGuard' }] }
      case 'jumpFailed':
        return stay(IDLE_CHECKPOINT)
      case 'percentageReady':
        return stay({ status: 'pending', origin: { ...origin, percentage: event.percentage } })
      default:
        return stay(state)
    }
  }
  switch (event.type) {
    case 'relocated':
      return event.showsOrigin ? { state: IDLE_CHECKPOINT, effects: [{ type: 'popGuard' }] } : stay(state)
    case 'back':
      return { state: IDLE_CHECKPOINT, effects: [{ type: 'popGuard' }, { type: 'goTo', cfi: origin.cfi }] }
    case 'systemBack':
      return { state: IDLE_CHECKPOINT, effects: [{ type: 'goTo', cfi: origin.cfi }] }
    case 'dismiss':
      return { state: IDLE_CHECKPOINT, effects: [{ type: 'popGuard' }, { type: 'saveCurrent' }] }
    case 'percentageReady':
      return stay({ status: 'active', origin: { ...origin, percentage: event.percentage } })
    default:
      return stay(state)
  }
}

export function savedOrigin(state: CheckpointState): Origin | undefined {
  return state.status === 'idle' ? undefined : state.origin
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/reader/checkpoint.test.ts`
Expected: PASS.

---

### Task 7: Marca na barra de progresso e botão de voltar

**Files:**
- Modify: `src/components/ProgressBar.tsx`
- Create: `src/components/reader/ReturnButton.tsx`

- [ ] **Step 1: `ProgressBar` com `marker`**

Troque o componente por:

```tsx
type ProgressBarProps = ComponentProps<'div'> & {
  theme: Pick<Theme, 'textColor' | 'background'>
  percentage: number
  // Where the return point is (0–100), drawn above the bar; outside the
  // clipped track so the tick isn't cut off.
  marker?: number
  markerColor?: string
}

export default function ProgressBar({ theme, percentage, marker, markerColor, className, style, ...props }: ProgressBarProps) {
  return (
    <div className={cn('relative', className)} style={style} {...props}>
      <div className="h-full overflow-hidden rounded-[inherit]" style={{ background: themeTint(theme, 15) }}>
        <div className="h-full" style={{ width: `${percentage}%`, background: themeTint(theme, 60) }} />
      </div>
      {marker !== undefined && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-full mb-px size-0 -translate-x-1/2 border-x-4 border-t-[6px] border-x-transparent"
          style={{ left: `${marker}%`, borderTopColor: markerColor ?? theme.textColor }}
        />
      )}
    </div>
  )
}
```

O `cn('relative', 'absolute …')` da barra do cabeçalho resolve para `absolute` (tailwind-merge). Confira no Step 3 da Task 8 que a linha continua no rodapé do cabeçalho.

- [ ] **Step 2: `ReturnButton`**

`src/components/reader/ReturnButton.tsx`:

```tsx
import { Undo2, X } from 'lucide-react'
import type { Origin } from '@/lib/reader/checkpoint'
import { cn } from '@/lib/utils'

interface ReturnButtonProps {
  origin: Origin
  color: string
  background: string
  // From lg, the header has room for the chapter's name.
  withChapter?: boolean
  onBack: () => void
  onDismiss: () => void
  className?: string
}

export default function ReturnButton({ origin, color, background, withChapter, onBack, onDismiss, className }: ReturnButtonProps) {
  const percentage = origin.percentage === undefined ? '' : ` · ${origin.percentage}%`
  const where = [origin.chapterLabel, origin.percentage !== undefined && `${origin.percentage}%`].filter(Boolean).join(', ')
  return (
    <div
      className={cn('inline-flex items-stretch overflow-hidden rounded-lg text-xs font-semibold', className)}
      style={{ color, background }}
    >
      <button
        type="button"
        onClick={onBack}
        aria-label={`Voltar para onde você lia${where ? ` (${where})` : ''}`}
        title="Voltar para onde você lia (Alt+←)"
        className="flex min-w-0 cursor-pointer items-center gap-1 px-3 whitespace-nowrap"
      >
        <Undo2 className="size-4 shrink-0" />
        {withChapter && origin.chapterLabel ? (
          <>
            <span className="hidden max-w-56 truncate lg:inline">Voltar para {origin.chapterLabel}</span>
            <span className="lg:hidden">Voltar</span>
          </>
        ) : (
          'Voltar'
        )}
        {percentage}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Ficar aqui"
        title="Ficar aqui"
        className="flex cursor-pointer items-center border-l px-2.5"
        style={{ borderColor: `${color}33` }}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
```

`color` sempre vem de `linkColor` (hex de 6 dígitos), então o sufixo `33` de alfa é seguro.

- [ ] **Step 3: Tipos**

Run: `npx tsc -b`
Expected: sem erros.

---

### Task 8: Ponto de retorno no Reader

**Files:**
- Modify: `src/pages/Reader.tsx`

Os trechos abaixo vão em ordem, e cada um diz onde fica.

- [ ] **Step 1: Imports e estado**

Imports: `useLocation` de `react-router-dom`; `import { IDLE_CHECKPOINT, savedOrigin, stepCheckpoint, type CheckpointEvent, type CheckpointState, type Origin } from '@/lib/reader/checkpoint'`; `import ReturnButton from '@/components/reader/ReturnButton'`; `linkColor` de `@/lib/theme-colors`.

Logo depois de `const persistCurrentLocationRef = …` (~733):

```ts
  // The return point (checkpoint.ts). The ref is what the callbacks registered
  // once read; the state is what renders.
  const checkpointRef = useRef<CheckpointState>(IDLE_CHECKPOINT)
  const [checkpoint, setCheckpoint] = useState<CheckpointState>(IDLE_CHECKPOINT)
  // Set by open(): persist() and percentageForCfi() live in its closure.
  const persistRef = useRef<(cfi: string, percentage: number) => void>(() => {})
  const percentageForCfiRef = useRef<(cfi: string) => number | undefined>(() => undefined)
  // The next history change is one the reader made itself (dropping the guard
  // entry), not the system Back.
  const appHistoryChangeRef = useRef(false)
  const dispatchCheckpointRef = useRef<(event: CheckpointEvent) => void>(() => {})
  const navigateToRef = useRef<(target: string, options?: { checkpoint?: boolean }) => void>(() => {})
  const location = useLocation()
```

- [ ] **Step 2: `persist` grava a origem enquanto o ponto existe**

Dentro de `open()`, troque `persist` por:

```ts
      // positionRef stays what's on screen (the re-seek anchor: rotating
      // inside a note keeps the note); what's written is the origin while a
      // return point exists, so closing the app in a note reopens where the
      // reader was reading, here and on every synced device.
      const persist = (cfi: string, percentage: number) => {
        const record: Progress = { bookId: bookId!, cfi, percentage, lastReadAt: Date.now() }
        positionRef.current = record
        const origin = savedOrigin(checkpointRef.current)
        const saved = origin ? { ...record, cfi: origin.cfi, percentage: origin.percentage ?? percentage } : record
        const seq = ++saveSeq
        saveProgress(saved)
          .catch(() => (seq === saveSeq ? saveProgress(saved) : undefined))
          .catch((error) => console.error('Não foi possível salvar o progresso de leitura', error))
      }
      persistRef.current = persist
      percentageForCfiRef.current = percentageForCfi
```

`percentageForCfi` precisa estar declarado antes. Ele já está (~1013), e `persist` vem logo depois. Confira.

- [ ] **Step 3: `relocated` e `locationsReady` alimentam o ponto**

No primeiro `rendition.on('relocated', …)` (~1046), como primeira linha depois de `resolveFirstRelocation = undefined`:

```ts
        const current = checkpointRef.current
        if (current.status !== 'idle') {
          dispatchCheckpointRef.current({ type: 'relocated', showsOrigin: locationContains(location, current.origin.cfi) })
        }
```

No `locationsReady.then(…)`, no fim do corpo:

```ts
        const current = checkpointRef.current
        if (current.status !== 'idle' && current.origin.percentage === undefined) {
          const originPercentage = percentageForCfi(current.origin.cfi)
          if (originPercentage !== undefined) dispatchCheckpointRef.current({ type: 'percentageReady', percentage: originPercentage })
        }
```

No cleanup do efeito de abertura, depois de `persistCurrentLocationRef.current()`:

```ts
      dispatchCheckpointRef.current({ type: 'close' })
      persistRef.current = () => {}
      percentageForCfiRef.current = () => undefined
```

- [ ] **Step 4: `dispatchCheckpoint`, `navigateTo` com ponto e o Voltar do sistema**

Troque `navigateTo` (~1381) por:

```ts
  const originNow = useCallback((): Origin | undefined => {
    const rendition = renditionRef.current
    if (!rendition) return undefined
    const anchor = positionRef.current?.cfi
    const onScreen = currentLocationOf(rendition)
    const cfi = anchor && locationContains(onScreen, anchor) ? anchor : onScreen?.start?.cfi
    if (!cfi) return undefined
    const book = bookRef.current
    return {
      cfi,
      percentage: percentageForCfiRef.current(cfi) ?? positionRef.current?.percentage,
      chapterLabel: book ? chapterLabelForCfi(book, tocRef.current, cfi) : undefined,
    }
  }, [])

  // TOC entries, search results, annotations, links and Home/End: a jump,
  // which leaves a way back (checkpoint.ts). Going back to it is a jump too,
  // without one. Re-seeks after a relayout call display() directly and never
  // come through here. The final flush covers a settle that needed no
  // re-display, where the last saved relocation predates the reflow.
  const navigateTo = useCallback((target: string, options: { checkpoint?: boolean } = {}) => {
    const rendition = renditionRef.current
    if (!rendition) return
    const origin = options.checkpoint ? originNow() : undefined
    if (origin) dispatchCheckpointRef.current({ type: 'jump', origin })
    rendition
      .display(target)
      .then(() => settleAt(rendition, target))
      .then(() => {
        const current = checkpointRef.current
        if (origin && current.status !== 'idle') {
          dispatchCheckpointRef.current({
            type: 'jumpSettled',
            showsOrigin: locationContains(currentLocationOf(rendition), current.origin.cfi),
          })
        }
        persistCurrentLocationRef.current()
      })
      .catch((error) => {
        if (origin) dispatchCheckpointRef.current({ type: 'jumpFailed' })
        console.error(error)
      })
  }, [originNow])

  const dispatchCheckpoint = useCallback(
    (event: CheckpointEvent) => {
      const { state, effects } = stepCheckpoint(checkpointRef.current, event)
      checkpointRef.current = state
      setCheckpoint(state)
      for (const effect of effects) {
        switch (effect.type) {
          case 'pushGuard':
            navigate(`/read/${bookId}`, { state: { checkpointGuard: true } })
            break
          case 'popGuard':
            appHistoryChangeRef.current = true
            navigate(-1)
            break
          case 'goTo':
            navigateToRef.current(effect.cfi)
            break
          case 'saveCurrent': {
            const position = positionRef.current
            if (position?.cfi) persistRef.current(position.cfi, position.percentage)
            break
          }
        }
      }
    },
    [navigate, bookId]
  )

  useEffect(() => {
    dispatchCheckpointRef.current = dispatchCheckpoint
    navigateToRef.current = navigateTo
  }, [dispatchCheckpoint, navigateTo])

  // The guard entry pushed when a return point became active: the system Back
  // (Android, Alt+←) pops it, which is the cue to go back to the origin. One
  // left over without a return point (a reload on it, or Forward) is dropped
  // rather than replaced, so no duplicate reader entry is left behind.
  useEffect(() => {
    const hasGuard = (location.state as { checkpointGuard?: boolean } | null)?.checkpointGuard === true
    if (appHistoryChangeRef.current) {
      appHistoryChangeRef.current = false
      return
    }
    const { status } = checkpointRef.current
    if (hasGuard && status !== 'active') {
      appHistoryChangeRef.current = true
      navigate(-1)
    } else if (!hasGuard && status === 'active') {
      dispatchCheckpointRef.current({ type: 'systemBack' })
    }
  }, [location, navigate])
```

`navigateTo` passa a ser declarado antes de `dispatchCheckpoint`, e os dois se chamam pelos refs. Os trechos que usam `navigateTo` mais abaixo no JSX continuam funcionando.

- [ ] **Step 5: Saltos pelo painel criam ponto**

No JSX (~1702-1715):

```tsx
        onNavigate={(href) => {
          const book = bookRef.current
          if (book) navigateTo(resolveTocHref(book, href), { checkpoint: true })
        }}
        annotations={annotations}
        onOpenAnnotation={(cfi) => navigateTo(cfi, { checkpoint: true })}
```

e no `BookSearch`: `onNavigate={(cfi) => navigateTo(cfi, { checkpoint: true })}`.

- [ ] **Step 6: Seta ← do cabeçalho e botão da tela de falha**

Antes do `return` do componente:

```ts
  // Back through history when the reader was opened from inside the app (a
  // push of "/" left [/, /read/x, /], and the system Back then reopened the
  // book), skipping the guard entry; replaced when the reader is the first
  // entry (direct link, reload in the installed app). React Router's data
  // router keeps the entry's index in history.state.idx.
  function leaveReader() {
    const index = (window.history.state as { idx?: number } | null)?.idx ?? 0
    const guard = checkpointRef.current.status === 'active' ? 1 : 0
    if (index - guard >= 1) navigate(-(1 + guard))
    else navigate('/', { replace: true })
  }
```

Troque `onClick={() => navigate('/')}` da seta (~1637) e do botão "Voltar para a biblioteca" da tela de falha (~1743) por `onClick={leaveReader}`.

- [ ] **Step 7: Botão e marca na UI**

Antes do `return`:

```ts
  const returnPoint = checkpoint.status === 'active' ? checkpoint.origin : undefined
  const link = linkColor(activeTheme)
  const returnButtonProps = returnPoint && {
    origin: returnPoint,
    color: link,
    background: themeTint(activeTheme, 8),
    onBack: () => dispatchCheckpoint({ type: 'back' }),
    onDismiss: () => dispatchCheckpoint({ type: 'dismiss' }),
  }
```

Cabeçalho, no grupo da direita, antes do `{percentage !== undefined && (…)}`:

```tsx
          {returnButtonProps && <ReturnButton {...returnButtonProps} withChapter className="hidden h-8 sm:inline-flex" />}
```

Na `ProgressBar` do cabeçalho, acrescente `marker={returnPoint?.percentage}` e `markerColor={link}`.

Barra de baixo (~1805):
- troque `'grid grid-cols-3 items-center …'` por `cn('grid items-center border-t px-2 transition-colors duration-200 sm:hidden', returnPoint ? 'grid-cols-[1fr_auto_1fr]' : 'grid-cols-3', barsHidden && 'border-transparent')`, ajustando o `cn` que já existe ali;
- na coluna do meio, acrescente `marker={returnPoint?.percentage}` e `markerColor={link}` à `ProgressBar`;
- troque `<span>{percentage ?? 0}%</span>` por:

```tsx
          {returnButtonProps ? (
            <ReturnButton {...returnButtonProps} className="h-11" />
          ) : (
            <span>{percentage ?? 0}%</span>
          )}
```

O `bottomBarButtonClass` deixa as laterais invisíveis com as barras escondidas. O botão de voltar não usa essa classe, então continua visível, como a % hoje.

- [ ] **Step 8: Lint, tipos e testes**

Run: `npm run lint; npx tsc -b; npm test`
Expected: tudo passa. Se o lint reclamar de ref lida durante o render, o motivo é `checkpointRef.current` dentro de `leaveReader`. Ele roda só no clique, não no render; se mesmo assim o lint acusar, leia via `checkpoint.status`.

- [ ] **Step 9: Verificar no navegador (Chromium, desktop)**

Com o fixture aberto no capítulo 1, pelo sumário, vá a "3.2".
- Expected: "↩ Voltar para Capítulo 1 · N%" no cabeçalho e a marca ▾ na linha de progresso.
- Vire 2 páginas: o botão continua.
- Clique em Voltar: volta ao capítulo 1 e o botão some.

Repita e clique no ✕: o botão some e a posição fica. Feche o leitor e reabra: deve abrir no 3.2.

Repita, feche o leitor com o ponto ativo e reabra: deve abrir no capítulo 1 (a origem). Confira com `javascript_tool` que `history.length` não cresceu além de uma entrada por salto ativo.

Alt+← com o ponto ativo: volta à origem.

---

### Task 9: Links tratados pelo app

**Files:**
- Modify: `src/pages/Reader.tsx` (`forwardTapToLink` ~665, hook de conteúdo ~932, superfície ~1228)

- [ ] **Step 1: `followLink`**

Depois de `navigateTo`:

```ts
  // Every link in the book goes through here — epub.js's own onclick runs no
  // settleAt and leaves no way back, and never runs at all in WebKit, whose
  // sandboxed book iframe runs no scripts. External links open from the app's
  // document: the sandbox has no allow-popups, so from inside the book they
  // did nothing.
  const followLink = useCallback(
    (link: HTMLAnchorElement, doc: Document) => {
      const raw = link.getAttribute('href')
      const book = bookRef.current
      if (!raw || !book) return
      if (isExternalHref(raw)) {
        window.open(link.href, '_blank', 'noopener')
        return
      }
      let url: URL
      try {
        url = new URL(raw, doc.querySelector('base')?.getAttribute('href') ?? doc.baseURI)
      } catch {
        return
      }
      navigateTo(resolveTocHref(book, book.path.relative(url.pathname) + url.hash), { checkpoint: true })
    },
    [navigateTo]
  )
  useEffect(() => {
    followLinkRef.current = followLink
  }, [followLink])
```

Importe `isExternalHref` de `@/lib/reader/links`. O efeito de abertura usa `followLinkRef` no hook de conteúdo, então ele precisa vir antes: junto dos refs do Step 1 da Task 8, declare `const followLinkRef = useRef<(link: HTMLAnchorElement, doc: Document) => void>(() => {})`.

- [ ] **Step 2: Clique com o mouse**

No hook de conteúdo, depois do `applyLinkStyles`:

```ts
        // After epub.js's Contents set its own onclick on each link, so this
        // one replaces it (an onclick property, not a listener: only one runs).
        for (const link of contents.document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
          link.onclick = (event) => {
            event.preventDefault()
            followLinkRef.current(link, contents.document)
            return false
          }
        }
```

- [ ] **Step 3: Toque**

Troque a assinatura e o corpo de `forwardTapToLink`:

```ts
function forwardTapToLink(
  viewer: HTMLElement,
  clientX: number,
  clientY: number,
  follow: (link: HTMLAnchorElement, doc: Document) => void
): boolean {
```

e, dentro do `if (link)`, troque `link.click()` por `follow(link, doc)`. Atualize o comentário de cima: o toque não reencaminha mais o clique ao livro; ele entrega o link ao app, o que funciona também no WebKit. Na chamada (~1228): `forwardTapToLink(viewer, clientX, clientY, followLinkRef.current)`.

- [ ] **Step 4: Verificar no navegador**

Chromium desktop, capítulo 1 do fixture:
- A nota 1 vai para as notas com o botão de voltar. Vire páginas dentro da nota: o botão fica. O ↩ da nota volta ao capítulo 1 e o botão some (chegou na origem).
- A nota 2 (formato antigo) e a figura levam ao destino.
- O link externo abre uma aba nova.
- Confira no console que não há `display` duplo: um só `relocated` de destino por clique.

Chromium com toque emulado (`resize_window` mobile, recarregar): o toque na nota leva às notas e a barra de baixo mostra "↩ Voltar · N%" e o ✕. Tire screenshots com as barras visíveis e escondidas.

WebKit (Playwright, como nas verificações anteriores do CHANGELOG): toque em link funciona; clique com mouse no desktop. Anote o resultado para o CHANGELOG.

---

### Task 10: Detector de roda

**Files:**
- Create: `src/lib/reader/wheel-paging.ts`, `src/lib/reader/wheel-paging.test.ts`

- [ ] **Step 1: Teste**

```ts
import { describe, expect, it } from 'vitest'
import { createWheelPager, type WheelSample } from './wheel-paging'

function feedAll(deltas: Partial<WheelSample>[], gapMs = 16) {
  const pager = createWheelPager()
  return deltas
    .map((delta, i) => pager.feed({ deltaX: 0, deltaY: 0, deltaMode: 0, timeStamp: 1000 + i * gapMs, ...delta }))
    .filter(Boolean)
}

describe('createWheelPager', () => {
  it('um dente da roda vira uma página', () => {
    expect(feedAll([{ deltaY: 100 }])).toEqual(['next'])
    expect(feedAll([{ deltaY: -100 }])).toEqual(['prev'])
  })

  it('o trackpad acumula até o limiar e vira uma vez', () => {
    expect(feedAll([10, 10, 10, 10, 10, 10, 10].map((deltaY) => ({ deltaY })))).toEqual(['next'])
  })

  it('a cauda da inércia não vira mais páginas', () => {
    expect(feedAll([40, 60, 50, 30, 20, 10, 5, 3, 2, 1].map((deltaY) => ({ deltaY })))).toEqual(['next'])
  })

  it('dois gestos separados por uma pausa viram duas', () => {
    const pager = createWheelPager()
    expect(pager.feed({ deltaX: 0, deltaY: 100, deltaMode: 0, timeStamp: 0 })).toBe('next')
    expect(pager.feed({ deltaX: 0, deltaY: 100, deltaMode: 0, timeStamp: 300 })).toBe('next')
  })

  it('um novo flick no meio da inércia vira outra página', () => {
    expect(feedAll([60, 40, 20, 10, 5, 60].map((deltaY) => ({ deltaY })))).toEqual(['next', 'next'])
  })

  it('inverter a direção começa outro gesto', () => {
    expect(feedAll([{ deltaY: 100 }, { deltaY: -100 }], 50)).toEqual(['next', 'prev'])
  })

  it('a roda em linhas (Firefox) vira na hora', () => {
    expect(feedAll([{ deltaY: 1, deltaMode: 1 }])).toEqual(['next'])
  })

  it('o eixo horizontal do trackpad também vira', () => {
    expect(feedAll([{ deltaX: 80, deltaY: 5 }])).toEqual(['next'])
    expect(feedAll([{ deltaX: -80, deltaY: 5 }])).toEqual(['prev'])
  })

  it('reset esquece o gesto em andamento', () => {
    const pager = createWheelPager()
    expect(pager.feed({ deltaX: 0, deltaY: 100, deltaMode: 0, timeStamp: 0 })).toBe('next')
    pager.reset()
    expect(pager.feed({ deltaX: 0, deltaY: 100, deltaMode: 0, timeStamp: 16 })).toBe('next')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/reader/wheel-paging.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementação**

`src/lib/reader/wheel-paging.ts`:

```ts
// One page per wheel gesture. A trackpad flick arrives as dozens of events
// with a decaying tail; a mouse wheel as discrete notches. A gesture ends
// after a pause, a change of direction, or a fresh acceleration in the middle
// of the inertia (a second flick before the first has died down). Starting
// points, to be tuned on real hardware.
export const WHEEL_THRESHOLD_PX = 50
export const WHEEL_IDLE_MS = 200
const LINE_PX = 40
const PAGE_PX = 800
const REACCELERATION = 1.5
const DECELERATING_EVENTS = 3

export interface WheelSample {
  deltaX: number
  deltaY: number
  deltaMode: number
  timeStamp: number
}

export type PageDirection = 'next' | 'prev'

export function createWheelPager({ threshold = WHEEL_THRESHOLD_PX, idleMs = WHEEL_IDLE_MS } = {}) {
  let lastTime = -Infinity
  let lastMagnitude = 0
  let direction = 0
  let total = 0
  let fired = false
  let decelerating = 0

  function reset() {
    lastTime = -Infinity
    lastMagnitude = 0
    direction = 0
    total = 0
    fired = false
    decelerating = 0
  }

  function feed({ deltaX, deltaY, deltaMode, timeStamp }: WheelSample): PageDirection | null {
    // deltaMode first: Firefox reports lines, and the deltas mean nothing without it.
    const scale = deltaMode === 1 ? LINE_PX : deltaMode === 2 ? PAGE_PX : 1
    const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX * scale : deltaY * scale
    const magnitude = Math.abs(delta)
    if (magnitude < 1) return null
    const sign = Math.sign(delta)
    const reaccelerated = decelerating >= DECELERATING_EVENTS && magnitude > lastMagnitude * REACCELERATION
    if (timeStamp - lastTime > idleMs || sign !== direction || reaccelerated) {
      direction = sign
      total = 0
      fired = false
      decelerating = 0
    } else {
      decelerating = magnitude <= lastMagnitude ? decelerating + 1 : 0
    }
    lastTime = timeStamp
    lastMagnitude = magnitude
    if (fired) return null
    total += magnitude
    if (deltaMode !== 0 || total >= threshold) {
      fired = true
      return sign > 0 ? 'next' : 'prev'
    }
    return null
  }

  return { feed, reset }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/reader/wheel-paging.test.ts`
Expected: PASS.

---

### Task 11: Roda no Reader

**Files:**
- Modify: `src/pages/Reader.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Handler**

Importe `createWheelPager` de `@/lib/reader/wheel-paging`. Função de módulo, perto de `handleReaderKeydown`:

```ts
// A <pre> or a table that scrolls on its own keeps the wheel.
function scrollsOnItsOwn(target: EventTarget | null, horizontal: boolean): boolean {
  for (let el = target as Element | null; el && el.tagName !== 'BODY' && el.tagName !== 'HTML'; el = el.parentElement) {
    const style = el.ownerDocument.defaultView?.getComputedStyle(el)
    const overflow = horizontal ? style?.overflowX : style?.overflowY
    const overflows = horizontal ? el.scrollWidth > el.clientWidth : el.scrollHeight > el.clientHeight
    if (overflows && (overflow === 'auto' || overflow === 'scroll')) return true
  }
  return false
}
```

No componente, logo depois de `keyActions` (~832):

```ts
  // One detector for the whole reader, not one per section: a chapter change
  // creates a new iframe mid-gesture, and a fresh detector would read the
  // rest of the flick as a new gesture. A turn asked for while one is still
  // landing is dropped — epub.js queues next()/prev(), which would stack pages.
  const wheelPagerRef = useRef(createWheelPager())
  const wheelTurningRef = useRef(false)
  const onWheel = useMemo(
    () => (event: WheelEvent) => {
      const pager = wheelPagerRef.current
      if (event.ctrlKey) {
        pager.reset()
        return
      }
      if (event.metaKey || event.altKey || !canPageRef.current) return
      if (scrollsOnItsOwn(event.target, Math.abs(event.deltaX) > Math.abs(event.deltaY))) {
        pager.reset()
        return
      }
      // Also what keeps a sideways two-finger swipe from being Chrome's Back on a Mac.
      if (event.cancelable) event.preventDefault()
      const direction = pager.feed(event)
      const rendition = renditionRef.current
      if (!direction || !rendition || wheelTurningRef.current) return
      wheelTurningRef.current = true
      const landed = nextRelocation(rendition)
      void (direction === 'next' ? rendition.next() : rendition.prev())
      void landed.then(() => {
        wheelTurningRef.current = false
      })
    },
    []
  )
```

O `nextRelocation` resolve no `relocated` ou depois de 1 s, o que cobre o fim e o início do livro.

- [ ] **Step 2: Registros**

No hook de conteúdo, ao lado do listener de `keydown`:

```ts
        contents.document.addEventListener('wheel', onWheel, { passive: false })
```

Depois do efeito do `ResizeObserver` (~1188):

```ts
  // The margins, the side buttons and the touch surface; the book's own
  // iframe gets the same handler in open() (wheel events don't cross documents).
  useEffect(() => {
    const row = bookRowRef.current
    if (!row) return
    row.addEventListener('wheel', onWheel, { passive: false })
    return () => row.removeEventListener('wheel', onWheel)
  }, [onWheel])
```

Não use `onWheel` do React: ele registra o listener como passivo, e aí o `preventDefault` não funciona.

- [ ] **Step 3: CSS**

Em `src/index.css`, dentro do `@layer base`, no bloco `html { … }`:

```css
  html {
    @apply font-sans;
    overscroll-behavior-x: none;
    }
```

- [ ] **Step 4: Verificar no navegador**

Chromium desktop, com `javascript_tool`, despache no documento do iframe:
- um `WheelEvent` com `deltaY: 100`: vira uma página;
- uma rajada de 10 eventos `deltaY: 10` a cada 16 ms: vira uma;
- os mesmos eventos na margem (`bookRow`): mesmo resultado;
- no último capítulo, na última página, mais um `wheel` não trava as viradas seguintes para trás.

Peça ao usuário para testar com o mouse e o trackpad dele no fim (Task 13).

---

### Task 12: Teclado, Home/End e lista de atalhos

**Files:**
- Create: `src/components/reader/ShortcutsDialog.tsx`
- Modify: `src/pages/Reader.tsx`, `src/components/reader/ReaderSettings.tsx`

- [ ] **Step 1: Alvos de Home e End**

Funções de módulo, perto de `currentLocationOf`:

```ts
function chapterStartTarget(rendition: Rendition, book: EpubBook): string | undefined {
  const index = currentLocationOf(rendition)?.start?.index
  return index === undefined ? undefined : book.spine.get(index)?.href
}

// The last text of the chapter on screen, as a CFI: its page is the chapter's last.
function chapterEndTarget(rendition: Rendition): string | undefined {
  const index = currentLocationOf(rendition)?.start?.index
  const contents = (rendition.getContents() as unknown as Contents[]).find((item) => item.sectionIndex === index)
  const doc = contents?.document
  if (!contents || !doc?.body) return undefined
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  })
  let last: Node | null = null
  while (walker.nextNode()) last = walker.currentNode
  if (!last) return undefined
  const range = doc.createRange()
  range.setStart(last, last.textContent?.length ?? 0)
  range.collapse(true)
  return contents.cfiFromRange(range)
}
```

- [ ] **Step 2: `handleReaderKeydown`**

`ReaderKeyActions` ganha `chapterStart: () => void`, `chapterEnd: () => void` e `openShortcuts: () => void`. No `switch`:

```ts
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
      actions.next()
      break
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      actions.prev()
      break
    case 'Home':
      actions.chapterStart()
      break
    case 'End':
      actions.chapterEnd()
      break
    case '?':
      actions.openShortcuts()
      break
```

O `case '/'` continua como está: `?` e `/` são valores de `event.key` diferentes, tanto no teclado US quanto no ABNT2. Atualize o comentário de cima da função com as teclas novas.

- [ ] **Step 3: `keyActions`**

Junto dos estados (~748): `const [shortcutsOpen, setShortcutsOpen] = useState(false)`. Em `keyActions`:

```ts
      chapterStart: () => {
        const rendition = renditionRef.current
        const book = bookRef.current
        const target = canPageRef.current && rendition && book ? chapterStartTarget(rendition, book) : undefined
        if (target) navigateToRef.current(target, { checkpoint: true })
      },
      chapterEnd: () => {
        const rendition = renditionRef.current
        const target = canPageRef.current && rendition ? chapterEndTarget(rendition) : undefined
        if (target) navigateToRef.current(target, { checkpoint: true })
      },
      openShortcuts: () => setShortcutsOpen(true),
```

`navigateToRef` precisa ser declarado antes de `keyActions`. Os refs da Task 8 Step 1 ficam em ~733, antes. Confira.

- [ ] **Step 4: `ShortcutsDialog`**

`src/components/reader/ShortcutsDialog.tsx`:

```tsx
import type { CSSProperties } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const SHORTCUTS: [string, string][] = [
  ['→  ↓  PageDown  Espaço', 'Próxima página'],
  ['←  ↑  PageUp  Shift+Espaço', 'Página anterior'],
  ['Roda do mouse ou trackpad', 'Vira uma página por gesto'],
  ['Home  /  End', 'Início ou fim do capítulo'],
  ['/', 'Buscar no livro'],
  ['F', 'Tela cheia'],
  ['Alt+←', 'Voltar para onde você lia, depois de um salto'],
  ['?', 'Esta lista'],
]

interface ShortcutsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Renders through a portal, outside the reader's themed subtree.
  style: CSSProperties
}

export default function ShortcutsDialog({ open, onOpenChange, style }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={style} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Atalhos do teclado</DialogTitle>
          <DialogDescription className="sr-only">Teclas que funcionam durante a leitura</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={keys} className="contents">
              <dt className="font-mono text-xs whitespace-nowrap">{keys}</dt>
              <dd className="text-muted-foreground">{action}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
```

No Reader, perto do `<BookSearch …/>`:

```tsx
      <ShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        style={
          {
            background: themeTint(activeTheme, 5),
            color: activeTheme.textColor,
            '--foreground': activeTheme.textColor,
            '--muted-foreground': activeTheme.textColor,
            '--border': themeTint(activeTheme, 20),
          } as CSSProperties
        }
      />
```

e troque `<ReaderSettings />` por `<ReaderSettings onShowShortcuts={() => setShortcutsOpen(true)} />`.

- [ ] **Step 5: Item no painel de ajustes**

Em `ReaderSettings.tsx`:
- assinatura: `export default function ReaderSettings({ onShowShortcuts }: { onShowShortcuts?: () => void })`;
- `const hasMouse = useMediaQuery('(pointer: fine)')`;
- importe `SheetClose` de `@/components/ui/sheet` e `Keyboard` de `lucide-react`;
- no fim do conteúdo, depois do bloco do `Switch`:

```tsx
          {hasMouse && onShowShortcuts && (
            <SheetClose asChild>
              <Button variant="outline" className="w-full" onClick={onShowShortcuts}>
                <Keyboard />
                Atalhos do teclado
              </Button>
            </SheetClose>
          )}
```

O `SheetClose` fecha o painel antes de o diálogo abrir. Assim os dois modais não disputam o foco.

- [ ] **Step 6: Lint, tipos e testes**

Run: `npm run lint; npx tsc -b; npm test`
Expected: tudo passa.

- [ ] **Step 7: Verificar no navegador**

Chromium desktop:
- ↓ e ↑ viram página.
- End vai à última página do capítulo e mostra o botão de voltar; Home vai ao início; Voltar volta.
- `?` abre a lista.
- O item "Atalhos do teclado" aparece no painel de ajustes e abre a lista.
- Com o toque emulado (`pointer: coarse`), o item não aparece.

---

### Task 13: Verificação geral

- [ ] **Step 1: Suíte e build**

Run: `npm test; npm run lint; npm run build; npm run epub:validate`
Expected: tudo passa.

- [ ] **Step 2: Abas**

No preview, simule um livro só na nuvem, do mesmo jeito da verificação da etapa anterior no CHANGELOG (estados simulados). Confira:
- a 375 px, o seletor ocupa a largura toda; no desktop, fica compacto;
- "Baixados" vem primeiro e é o padrão;
- com todos os livros só na nuvem e sem escolha na sessão, abre em "Todos".

- [ ] **Step 3: Cor nas 6 paletas e numa personalizada escura**

Screenshot do capítulo 1 em Claro, Escuro e Sépia.

- [ ] **Step 4: O que fica para o usuário**

Liste na mensagem final o que só dá para testar nos aparelhos dele:
- Voltar do Android com o ponto ativo;
- toque nas notas no celular;
- mouse e trackpad reais (calibrar `WHEEL_THRESHOLD_PX` e `WHEEL_IDLE_MS`);
- link externo abrindo no Chrome Android.

---

### Task 14: Registro e commit

**Files:**
- Modify: `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: CLAUDE.md**

Na seção "Arquivo de teste", troque "8 capítulos, capa PNG, sumário aninhado com âncoras e texto acentuado" por "8 capítulos e um de notas, capa PNG, sumário aninhado com âncoras, links de todo tipo (referência, nota EPUB 3, nota antiga, imagem e externo) e texto acentuado". Mencione que o validador também confere os links internos dos capítulos.

- [ ] **Step 2: CHANGELOG**

Nova seção `## 2026-10-22`, no estilo das entradas de 2026-10-21. Itens:
- abas "Baixados | Todos";
- cor e clique dos links;
- ponto de retorno;
- navegação no computador;
- fixture com links.

Cada item com _Por quê_, as _Decisões_ e a _Verificação_ real (o que passou e o que ficou para o celular).

Decisões a registrar:
- ponto único;
- origem gravada enquanto o botão existe;
- `jumpSettled`;
- entrada de histórico (guard) e `navigate(-1)` para a que sobra;
- `<style>` própria em vez de `themes.default()`;
- `linkColor` em TS com contraste mínimo;
- link externo aberto pelo app;
- uma página por gesto da roda;
- correção da seta ← que empilhava `/`.

Limites a registrar:
- Safari no Mac (roda e clique sobre o texto), com o resultado do WebKit da Task 9;
- mouses de roda livre.

- [ ] **Step 3: Pedir o commit**

Não commite. Diga ao usuário que a tarefa está pronta, com o resumo e as pendências do Step 4 da Task 13, e pergunte se pode commitar. Com o "sim", faça um único commit com os arquivos da tarefa (código, testes, fixture, `CHANGELOG.md`, `CLAUDE.md`, o spec e este plano). A mensagem tem uma linha:

```bash
git commit -m "feat(reader): adiciona ponto de retorno, cor e clique dos links, roda do mouse e abas Baixados/Todos"
```
