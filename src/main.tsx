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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
