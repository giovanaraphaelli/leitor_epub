import { describe, expect, it } from 'vitest'
import { effectiveShelf, parseShelf } from './shelf'

describe('effectiveShelf', () => {
  it('a escolha salva vence sempre', () => {
    expect(effectiveShelf('disponiveis', true, false)).toBe('disponiveis')
    expect(effectiveShelf('baixados', false, false)).toBe('baixados')
  })

  it('sem escolha, abre em Baixados quando há livro baixado', () => {
    expect(effectiveShelf(null, true, false)).toBe('baixados')
  })

  it('sem escolha e nada baixado, abre em Disponíveis para não mostrar a grade vazia', () => {
    expect(effectiveShelf(null, false, false)).toBe('disponiveis')
  })

  it('uma importação em andamento conta como livro baixado', () => {
    expect(effectiveShelf(null, false, true)).toBe('baixados')
  })
})

describe('parseShelf', () => {
  it('lê os valores salvos, inclusive o antigo "aparelho"', () => {
    expect(parseShelf('disponiveis')).toBe('disponiveis')
    expect(parseShelf('baixados')).toBe('baixados')
    expect(parseShelf('aparelho')).toBe('baixados')
    expect(parseShelf('todos')).toBeNull()
    expect(parseShelf(null)).toBeNull()
  })
})
