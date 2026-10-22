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
