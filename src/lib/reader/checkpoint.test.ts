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
