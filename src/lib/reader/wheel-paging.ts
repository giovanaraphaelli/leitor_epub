// One page per wheel gesture. A trackpad flick arrives as dozens of events
// with a decaying tail; a mouse wheel as discrete notches. A gesture ends
// after a pause, a change of direction, or a fresh acceleration in the middle
// of the inertia (a second flick before the first has died down). Starting
// points, to be tuned on real hardware.
export const WHEEL_THRESHOLD_PX = 50
export const WHEEL_IDLE_MS = 200
const LINE_PX = 40
const PAGE_PX = 800
const REACCELERATION = 1.5
const DECELERATING_EVENTS = 3

export interface WheelSample {
  deltaX: number
  deltaY: number
  deltaMode: number
  timeStamp: number
}

export type PageDirection = 'next' | 'prev'

export function createWheelPager({ threshold = WHEEL_THRESHOLD_PX, idleMs = WHEEL_IDLE_MS } = {}) {
  let lastTime = -Infinity
  let lastMagnitude = 0
  let direction = 0
  let total = 0
  let fired = false
  let decelerating = 0

  function reset() {
    lastTime = -Infinity
    lastMagnitude = 0
    direction = 0
    total = 0
    fired = false
    decelerating = 0
  }

  function feed({ deltaX, deltaY, deltaMode, timeStamp }: WheelSample): PageDirection | null {
    // deltaMode first: Firefox reports lines, and the deltas mean nothing without it.
    const scale = deltaMode === 1 ? LINE_PX : deltaMode === 2 ? PAGE_PX : 1
    const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX * scale : deltaY * scale
    const magnitude = Math.abs(delta)
    if (magnitude < 1) return null
    const sign = Math.sign(delta)
    const reaccelerated = decelerating >= DECELERATING_EVENTS && magnitude > lastMagnitude * REACCELERATION
    if (timeStamp - lastTime > idleMs || sign !== direction || reaccelerated) {
      direction = sign
      total = 0
      fired = false
      decelerating = 0
    } else {
      decelerating = magnitude <= lastMagnitude ? decelerating + 1 : 0
    }
    lastTime = timeStamp
    lastMagnitude = magnitude
    if (fired) return null
    total += magnitude
    if (deltaMode !== 0 || total >= threshold) {
      fired = true
      return sign > 0 ? 'next' : 'prev'
    }
    return null
  }

  return { feed, reset }
}
