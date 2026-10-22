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
