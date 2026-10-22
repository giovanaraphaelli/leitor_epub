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
