import type { Theme } from './db/schema'

// The theme's text color blended into its background: opaque, so a border or
// a bar track doesn't pick up whatever is under it (a translucent text color
// did, on dark palettes), and it follows any palette the person creates.
export function themeTint(theme: Pick<Theme, 'textColor' | 'background'>, percent: number): string {
  return `color-mix(in oklab, ${theme.textColor} ${percent}%, ${theme.background})`
}
