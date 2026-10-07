// A trail of what the reader saw, for testing on a phone, where there is no
// console to look at. Off unless ?debug=1 was opened on the device (?debug=0
// turns it off again). Remembered in localStorage rather than in the database,
// so it still works when IndexedDB is what's broken.

export interface DebugEntry {
  at: number
  event: string
  detail?: string
}

const STORAGE_KEY = 'leitor-debug'
const LIMIT = 200

// The ?debug= parameter wins; without one, what the device remembers.
export function resolveDebugFlag(search: string, stored: string | null): boolean {
  const param = new URLSearchParams(search).get('debug')
  if (param === '1') return true
  if (param === '0') return false
  return stored === '1'
}

export function appendEntry(entries: readonly DebugEntry[], entry: DebugEntry, limit = LIMIT): DebugEntry[] {
  const next = [...entries, entry]
  return next.length > limit ? next.slice(next.length - limit) : next
}

function clock(at: number): string {
  const time = new Date(at)
  const two = (value: number) => String(value).padStart(2, '0')
  const millis = String(time.getMilliseconds()).padStart(3, '0')
  return `${two(time.getHours())}:${two(time.getMinutes())}:${two(time.getSeconds())}.${millis}`
}

export function formatDebugLog(entries: readonly DebugEntry[]): string {
  return entries.map((entry) => `${clock(entry.at)} ${entry.event}${entry.detail ? ' ' + entry.detail : ''}`).join('\n')
}

// String() throws for an object without a prototype (a rejection reason can be one).
function asText(detail: unknown): string {
  try {
    return String(detail)
  } catch {
    return Object.prototype.toString.call(detail)
  }
}

let enabled = false
let entries: readonly DebugEntry[] = []
const listeners = new Set<() => void>()

export function initDebug() {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(STORAGE_KEY)
  } catch {
    // Storage blocked: the flag lasts for this page only.
  }
  const param = new URLSearchParams(window.location.search).get('debug')
  if (param === '1' || param === '0') {
    try {
      localStorage.setItem(STORAGE_KEY, param)
    } catch {
      // Same as above.
    }
  }
  enabled = resolveDebugFlag(window.location.search, stored)
  if (!enabled) return
  window.addEventListener('error', (event) => debugLog('erro', event.message))
  window.addEventListener('unhandledrejection', (event) => debugLog('promessa rejeitada', event.reason))
  debugLog('início', `build ${__BUILD_ID__} · ${navigator.userAgent}`)
}

export function isDebugEnabled(): boolean {
  return enabled
}

export function debugLog(event: string, detail?: unknown) {
  if (!enabled) return
  entries = appendEntry(entries, { at: Date.now(), event, detail: detail === undefined ? undefined : asText(detail) })
  for (const listener of listeners) listener()
}

export function debugEntries(): readonly DebugEntry[] {
  return entries
}

export function subscribeDebug(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
