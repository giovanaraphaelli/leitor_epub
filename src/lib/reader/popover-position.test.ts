import { describe, expect, it } from 'vitest'
import { placePopover } from './popover-position'

const size = { width: 220, height: 56 }
const viewport = { width: 375, height: 812 }

describe('placePopover', () => {
  it('fica embaixo do trecho, centrado, depois dos pins do sistema', () => {
    const text = { top: 100, bottom: 120, left: 100, right: 200 }
    expect(placePopover(text, size, viewport)).toEqual({ top: 156, left: 40, side: 'below' })
  })

  it('não passa da borda esquerda', () => {
    const text = { top: 100, bottom: 120, left: 0, right: 40 }
    expect(placePopover(text, size, viewport).left).toBe(8)
  })

  it('não passa da borda direita', () => {
    const text = { top: 100, bottom: 120, left: 330, right: 370 }
    expect(placePopover(text, size, viewport).left).toBe(147)
  })

  it('vai para cima do trecho quando não cabe embaixo', () => {
    const text = { top: 700, bottom: 720, left: 100, right: 200 }
    expect(placePopover(text, size, viewport)).toEqual({ top: 636, left: 40, side: 'above' })
  })

  it('numa seleção alta demais, fica dentro da tela mesmo por cima do texto', () => {
    const text = { top: 20, bottom: 790, left: 100, right: 200 }
    expect(placePopover(text, size, viewport)).toEqual({ top: 748, left: 40, side: 'below' })
  })

  it('numa tela mais estreita que o cartão, fica na margem esquerda', () => {
    const text = { top: 100, bottom: 120, left: 100, right: 200 }
    expect(placePopover(text, size, { width: 150, height: 812 }).left).toBe(8)
  })
})
