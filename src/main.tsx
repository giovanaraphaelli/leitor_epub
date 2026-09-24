import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import './index.css'
import { router } from '@/routes'
import { useThemeStore } from '@/store/theme-store'
import { useReadingPrefsStore } from '@/store/reading-prefs-store'

// Awaited before the first render (not fired off in parallel with it): the
// reader applies the active theme before its first `display()` to avoid a
// reflow-after-display that shifts the restored CFI (see applyTheme's comment
// in Reader.tsx) — if the theme were still loading when Reader mounts, that
// same drift would reappear on every hard reload once the hydrated theme
// arrived a moment later and reflowed the already-settled page.
await Promise.all([
  useThemeStore.getState().loadActiveTheme(),
  useReadingPrefsStore.getState().loadReadingPrefs(),
])

// Keeps the system bars on the active theme's background instead of white.
// Android (and the desktop app's title bar) paint them from the theme-color
// meta; iOS 26 ignores that meta and takes the body's background color — the
// pages paint the theme on their own root divs, so without this the body
// stayed white underneath and so did the iPhone's status bar.
const themeColorMeta = document.querySelector('meta[name="theme-color"]')
function syncSystemBars(color: string) {
  themeColorMeta?.setAttribute('content', color)
  document.body.style.backgroundColor = color
}
syncSystemBars(useThemeStore.getState().activeTheme.background)
useThemeStore.subscribe((state) => syncSystemBars(state.activeTheme.background))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
