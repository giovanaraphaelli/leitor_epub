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
