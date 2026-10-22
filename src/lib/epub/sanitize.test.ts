import { describe, expect, it } from 'vitest'
import { fontScaleFor, sanitizeCss } from './sanitize'

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
