import { describe, expect, it } from 'vitest'
import { appendEntry, formatDebugLog, resolveDebugFlag, type DebugEntry } from './debug-log'

describe('resolveDebugFlag', () => {
  it('turns on with ?debug=1 and off with ?debug=0, whatever was remembered', () => {
    expect(resolveDebugFlag('?debug=1', '0')).toBe(true)
    expect(resolveDebugFlag('?debug=0', '1')).toBe(false)
  })

  it('keeps what the device remembers when the address has no ?debug', () => {
    expect(resolveDebugFlag('', '1')).toBe(true)
    expect(resolveDebugFlag('?x=2', null)).toBe(false)
  })
})

describe('appendEntry', () => {
  it('keeps only the newest entries past the limit', () => {
    let list: DebugEntry[] = []
    for (let i = 0; i < 5; i++) list = appendEntry(list, { at: i, event: 'e' + i }, 3)
    expect(list.map((entry) => entry.event)).toEqual(['e2', 'e3', 'e4'])
  })
})

describe('formatDebugLog', () => {
  it('writes one line per entry, with its time and detail', () => {
    const at = new Date(2026, 9, 7, 9, 5, 3, 7).getTime()
    const log = formatDebugLog([
      { at, event: 'seleção: show', detail: '7 letras' },
      { at, event: 'toque terminou' },
    ])
    expect(log).toBe('09:05:03.007 seleção: show 7 letras\n09:05:03.007 toque terminou')
  })
})
