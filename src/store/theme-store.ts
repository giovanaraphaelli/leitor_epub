import { create } from 'zustand'
import type { Theme } from '@/lib/db/schema'
import { PRESET_THEMES } from '@/lib/db/presets'
import { getSetting, setSetting } from '@/lib/db/settings'

const ACTIVE_THEME_SETTING_KEY = 'activeTheme'

interface ThemeState {
  activeTheme: Theme
  setActiveTheme: (theme: Theme) => void
  updateActiveTheme: (patch: Partial<Theme>) => void
  loadActiveTheme: () => Promise<void>
}

export const useThemeStore = create<ThemeState>((set) => ({
  activeTheme: PRESET_THEMES[0],
  setActiveTheme: (theme) => {
    set({ activeTheme: theme })
    void setSetting(ACTIVE_THEME_SETTING_KEY, theme)
  },
  updateActiveTheme: (patch) =>
    set((state) => {
      const activeTheme = { ...state.activeTheme, ...patch }
      void setSetting(ACTIVE_THEME_SETTING_KEY, activeTheme)
      return { activeTheme }
    }),
  loadActiveTheme: async () => {
    const saved = await getSetting<Theme>(ACTIVE_THEME_SETTING_KEY)
    if (saved) set({ activeTheme: saved })
  },
}))
