import { create } from 'zustand'
import type { Theme } from '@/lib/db/schema'
import { PRESET_THEMES } from '@/lib/db/presets'

interface ThemeState {
  activeTheme: Theme
  setActiveTheme: (theme: Theme) => void
  updateActiveTheme: (patch: Partial<Theme>) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  activeTheme: PRESET_THEMES[0],
  setActiveTheme: (theme) => set({ activeTheme: theme }),
  updateActiveTheme: (patch) =>
    set((state) => ({ activeTheme: { ...state.activeTheme, ...patch } })),
}))
