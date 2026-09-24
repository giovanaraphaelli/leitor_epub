import { useThemeStore } from '@/store/theme-store'

// iOS 26 ignores the theme-color meta (which Android still uses, see
// main.tsx): it tints the status bar from a position: fixed/sticky element
// touching the top edge of the page, reading its background-color, and falls
// back to white when there's none. This strip is that element. Same color as
// the page, and 4px tall — the band iOS samples — so it stays clear of the
// header buttons' focus ring; pointer-events-none keeps it from swallowing
// taps. Below the z-50 overlays,
// so an open sheet tints the bar instead, as it covers the whole screen.
export default function StatusBarTint() {
  const background = useThemeStore((s) => s.activeTheme.background)
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-40 h-1"
      style={{ backgroundColor: background }}
    />
  )
}
