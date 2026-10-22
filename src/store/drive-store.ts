import { create } from 'zustand'
import { connectDrive, disconnectDrive, DriveAuthError, getAccessToken, invalidateAccessToken } from '@/lib/drive/auth'
import { getDriveAccount, type DriveAccount } from '@/lib/drive/account'
import { setDriveEnabled } from '@/lib/db/deletions'
import { requestPersistentStorage } from '@/lib/storage'
import { debugLog } from '@/lib/debug-log'

// 'verificando' until the first answer. 'indisponivel' when there's no login
// server behind /api (the static deploy, `npm run dev`) or no network; the
// Drive button stays hidden in both.
export type DriveStatus = 'verificando' | 'indisponivel' | 'desconectado' | 'conectado' | 'reconectar'

interface DriveState {
  status: DriveStatus
  account: DriveAccount | null
  check: () => Promise<void>
  connect: () => void
  disconnect: () => Promise<void>
}

// Whether this device is connected decides if its removals are recorded (see
// isDriveEnabled). Only an explicit disconnect turns it off: the server's
// `desconectado` just means there's no login cookie right now (it also clears
// the cookie after a `reconectar`), and removals made in that gap still have to
// reach the other devices. Fire and forget: a failed write must not break the screen.
function remember(enabled: boolean): void {
  setDriveEnabled(enabled).catch((error) => debugLog('drive: estado não guardado', String(error)))
}

// Bumped by disconnect(): a check() that started before it and answers after
// must not bring the connection back.
let generation = 0

export const useDriveStore = create<DriveState>((set) => ({
  status: 'verificando',
  account: null,
  check: async () => {
    const started = generation
    try {
      await getAccessToken()
    } catch (error) {
      if (started !== generation) return
      const status = error instanceof DriveAuthError ? error.problem : 'indisponivel'
      set({ status, account: null })
      debugLog(`drive: ${status}`)
      return
    }
    if (started !== generation) {
      // The token that just arrived was asked for before the disconnect: it
      // must not stay cached for the next check.
      invalidateAccessToken()
      return
    }
    remember(true)
    void requestPersistentStorage()
    try {
      const account = await getDriveAccount()
      if (started !== generation) return
      set({ status: 'conectado', account })
      debugLog('drive: conectado')
    } catch (error) {
      if (started !== generation) return
      // Logged in, but the Drive API refused, e.g. not enabled in the Cloud project.
      set({ status: 'conectado', account: null })
      debugLog('drive: conta ilegível', String(error))
      console.error('Não foi possível ler a conta do Google Drive', error)
    }
  },
  connect: connectDrive,
  // Throws when the server couldn't log out; the state then stays as it is.
  disconnect: async () => {
    generation++
    await disconnectDrive()
    remember(false)
    set({ status: 'desconectado', account: null })
    debugLog('drive: desconectado')
  },
}))
