import type { DriveStatus } from './drive-store'
import type { SyncState } from './sync-store'

export type SyncStripContent =
  | { kind: 'progresso'; done: number; total: number }
  | { kind: 'erro'; message: string; action: 'tentar' | 'reconectar' }

// What the strip under the library's header shows, if anything: work worth
// watching (books going up) or a problem the reader can act on. The quick sync
// of every visit stays in the icon, and so does being offline, which is when
// the "No aparelho" tab gets used.
export function syncStripState(
  sync: Pick<SyncState, 'status' | 'progress' | 'problem' | 'error' | 'dismissedError'>,
  driveStatus: DriveStatus,
): SyncStripContent | null {
  if (driveStatus !== 'conectado' && driveStatus !== 'reconectar') return null
  if (sync.status === 'sincronizando') {
    return sync.progress && sync.progress.total > 0 ? { kind: 'progresso', ...sync.progress } : null
  }
  if (sync.status !== 'erro' || !sync.error) return null
  if (sync.problem === 'offline' || sync.error === sync.dismissedError) return null
  // With the login gone, trying again can't work: reconnecting is the way out.
  const reconnect = sync.problem === 'conta' || driveStatus === 'reconectar'
  return { kind: 'erro', message: sync.error, action: reconnect ? 'reconectar' : 'tentar' }
}
