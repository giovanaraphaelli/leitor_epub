import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import './index.css'
import { router } from '@/routes'
import { useThemeStore } from '@/store/theme-store'

// Awaited before the first render (not fired off in parallel with it): the
// reader applies the active theme before its first `display()` to avoid a
// reflow-after-display that shifts the restored CFI (see applyTheme's comment
// in Reader.tsx) — if the theme were still loading when Reader mounts, that
// same drift would reappear on every hard reload once the hydrated theme
// arrived a moment later and reflowed the already-settled page.
await useThemeStore.getState().loadActiveTheme()

// theme-color is what paints the status bar of the installed app (iOS 15+,
// Android) and the title bar on desktop — kept on the page's background so
// that strip follows the active theme instead of staying white. The document
// background follows too, since iOS paints the area outside the page with it.
// The copy in localStorage is only a hint for the inline script in
// index.html, which runs before the real theme (IndexedDB) can be read.
const themeColorMeta = document.querySelector('meta[name="theme-color"]')
function syncThemeColor(color: string) {
  themeColorMeta?.setAttribute('content', color)
  document.documentElement.style.backgroundColor = color
  try {
    localStorage.setItem('theme-color', color)
  } catch {
    // Storage blocked (private mode): the bar just starts white next launch.
  }
}
syncThemeColor(useThemeStore.getState().activeTheme.background)
useThemeStore.subscribe((state) => syncThemeColor(state.activeTheme.background))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
