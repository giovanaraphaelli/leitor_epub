import { useState, useSyncExternalStore } from 'react'
import { debugEntries, formatDebugLog, subscribeDebug } from '@/lib/debug-log'

// The newest lines of the debug trail over the page, and a way to get all of
// it out of a phone. Rendered only while ?debug=1 is on. Touches go through it
// (only the button takes them), so it can't be what stops a long press or
// covers the card's buttons.
export default function DebugPanel() {
  const entries = useSyncExternalStore(subscribeDebug, debugEntries)
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')

  function copy() {
    // navigator.clipboard only exists in a secure context (HTTPS or localhost).
    const written =
      navigator.clipboard?.writeText(formatDebugLog(entries)) ?? Promise.reject(new Error('clipboard unavailable'))
    written.then(
      () => setStatus('copied'),
      () => setStatus('failed')
    )
    setTimeout(() => setStatus('idle'), 1500)
  }

  return (
    <div
      data-debug-panel
      className="pointer-events-none fixed top-14 right-2 z-[60] w-64 max-w-[70vw] rounded-md bg-black/70 p-2 font-mono text-[10px] leading-tight text-white"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span>debug · {entries.length}</span>
        <button type="button" onClick={copy} className="pointer-events-auto cursor-pointer rounded bg-white/20 px-2 py-1">
          {status === 'copied' ? 'Copiado' : status === 'failed' ? 'Falhou' : 'Copiar log'}
        </button>
      </div>
      {/* Bottom-aligned, so when long lines wrap it's the oldest that get cut. */}
      <div className="flex max-h-40 flex-col justify-end overflow-hidden">
        <pre className="break-all whitespace-pre-wrap">{formatDebugLog(entries.slice(-12))}</pre>
      </div>
    </div>
  )
}
