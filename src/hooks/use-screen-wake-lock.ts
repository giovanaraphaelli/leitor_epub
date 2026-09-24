import { useEffect } from 'react'

export const isScreenWakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator

// Keeps the screen from dimming/locking while `enabled`. The browser drops
// the lock on its own whenever the page is hidden (switching apps, locking
// the phone), so it's requested again each time the page becomes visible.
// Failures (unsupported, low battery mode, denied) are ignored: the screen
// simply behaves as it normally would.
export function useScreenWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !isScreenWakeLockSupported) return
    let sentinel: WakeLockSentinel | null = null
    let disposed = false

    async function acquire() {
      if (document.visibilityState !== 'visible') return
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (disposed) void lock.release()
        else sentinel = lock
      } catch {
        // See above: not being able to keep the screen on isn't an error.
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      void sentinel?.release()
    }
  }, [enabled])
}
