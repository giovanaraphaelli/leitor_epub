import { describe, expect, it } from 'vitest'
import { wordBoundsAt } from './selection'

function wordAt(text: string, offset: number) {
  const bounds = wordBoundsAt(text, offset)
  return bounds ? text.slice(bounds[0], bounds[1]) : null
}

describe('wordBoundsAt', () => {
  it('acha a palavra no meio dela', () => {
    expect(wordAt('Uma noite destas', 6)).toBe('noite')
  })

  it('acha a palavra quando o ponto cai logo depois dela', () => {
    expect(wordAt('Uma noite destas', 9)).toBe('noite')
    expect(wordAt('fim', 3)).toBe('fim')
  })

  it('não pega a palavra anterior quando o ponto cai depois da pontuação', () => {
    expect(wordBoundsAt('fim.', 4)).toBeNull()
  })

  it('mantém acentos e cedilha', () => {
    expect(wordAt('que eu conheço de vista', 10)).toBe('conheço')
  })

  it('mantém acentos de texto decomposto (NFD)', () => {
    expect(wordAt('de chapéu'.normalize('NFD'), 5)).toBe('chapéu'.normalize('NFD'))
  })

  it('não leva a pontuação junto', () => {
    expect(wordAt('de chapéu.', 5)).toBe('chapéu')
  })

  it('mantém apóstrofo e hífen entre letras', () => {
    expect(wordAt('uma gota d’água', 12)).toBe('d’água')
    expect(wordAt("olho d'água", 6)).toBe("d'água")
    expect(wordAt('o guarda-chuva caiu', 5)).toBe('guarda-chuva')
  })

  it('junta a palavra partida por hífen opcional ou hífen Unicode', () => {
    expect(wordAt('uma pa\u00ADla\u00ADvra', 7)).toBe('pa\u00ADla\u00ADvra')
    expect(wordAt('guarda\u2011chuva', 2)).toBe('guarda\u2011chuva')
    expect(wordAt('guarda\u2010chuva', 2)).toBe('guarda\u2010chuva')
  })

  it('deixa de fora apóstrofo e hífen nas bordas', () => {
    expect(wordAt('disse ‘sim’', 8)).toBe('sim')
    expect(wordAt('bem- x', 1)).toBe('bem')
  })

  it('devolve null entre espaços, em pontuação solta e em texto vazio', () => {
    expect(wordBoundsAt('a  b', 2)).toBeNull()
    expect(wordBoundsAt('-- ...', 1)).toBeNull()
    expect(wordBoundsAt('', 0)).toBeNull()
  })

  it('limita o offset ao tamanho do texto', () => {
    expect(wordAt('fim', 99)).toBe('fim')
  })
})
