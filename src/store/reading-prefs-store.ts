import { create } from 'zustand'
import { getSetting, setSetting } from '@/lib/db/settings'

const KEEP_SCREEN_ON_SETTING_KEY = 'keepScreenOn'

interface ReadingPrefsState {
  keepScreenOn: boolean
  setKeepScreenOn: (value: boolean) => void
  loadReadingPrefs: () => Promise<void>
}

export const useReadingPrefsStore = create<ReadingPrefsState>((set) => ({
  keepScreenOn: false,
  setKeepScreenOn: (value) => {
    set({ keepScreenOn: value })
    void setSetting(KEEP_SCREEN_ON_SETTING_KEY, value)
  },
  loadReadingPrefs: async () => {
    const saved = await getSetting<boolean>(KEEP_SCREEN_ON_SETTING_KEY)
    if (saved !== undefined) set({ keepScreenOn: saved })
  },
}))
