import { describe, expect, it } from 'vitest'
import { IDLE, stepWatch, type WatchAction, type WatchState } from './selection-watch'

function run(keys: Array<string | null>, from: WatchState = IDLE): WatchAction[] {
  let state = from
  return keys.map((key) => {
    const step = stepWatch(state, key)
    state = step.state
    return step.action
  })
}

describe('stepWatch', () => {
  it('stays quiet while nothing is selected', () => {
    expect(run([null, null, null])).toEqual([null, null, null])
  })

  it('shows a new selection once it has held for two reads, and only once', () => {
    expect(run(['a', 'a', 'a', 'a'])).toEqual([null, 'show', null, null])
  })

  it('hides while a pin is dragged and shows again where the selection settles', () => {
    expect(run(['a', 'a', 'b', 'c', 'c'])).toEqual([null, 'show', 'hide', null, 'show'])
  })

  it('closes when the selection goes, whether or not the popover had shown', () => {
    expect(run(['a', 'a', null])).toEqual([null, 'show', 'close'])
    expect(run(['a', null])).toEqual([null, 'close'])
  })

  it('starts over after a close', () => {
    expect(run(['a', 'a', null, 'a', 'a'])).toEqual([null, 'show', 'close', null, 'show'])
  })
})
