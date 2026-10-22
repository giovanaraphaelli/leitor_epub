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
