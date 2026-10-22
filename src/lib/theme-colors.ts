import type { Theme } from './db/schema'

// The theme's text color blended into its background: opaque, so a border or
// a bar track doesn't pick up whatever is under it (a translucent text color
// did, on dark palettes), and it follows any palette the person creates.
export function themeTint(theme: Pick<Theme, 'textColor' | 'background'>, percent: number): string {
  return `color-mix(in oklab, ${theme.textColor} ${percent}%, ${theme.background})`
}

type Rgb = [number, number, number]

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1, 7), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// Plain sRGB mix: `weight` of `a` over `b`. Used where color-mix() can't be
// (inside the book's iframe, whose browser support isn't ours to assume).
export function mixHex(a: string, b: string, weight: number): string {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  return rgbToHex([0, 1, 2].map((i) => ca[i] * weight + cb[i] * (1 - weight)) as Rgb)
}

function oklabLightness(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
}

// Linear sRGB for an OKLCH color, or null when it falls outside sRGB.
function oklchToLinear(L: number, C: number, hueDeg: number): Rgb | null {
  const h = (hueDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const rgb: Rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return rgb.every((c) => c >= -1e-6 && c <= 1 + 1e-6) ? rgb : null
}

const LINK_HUE = 255
const LINK_MAX_CHROMA = 0.14
const LINK_TARGET = 7
const LINK_FLOOR = 4.5

function blueAt(L: number): string {
  for (let C = LINK_MAX_CHROMA; C > 0; C -= 0.005) {
    const rgb = oklchToLinear(L, C, LINK_HUE)
    if (rgb) return rgbToHex(rgb.map(fromLinear) as Rgb)
  }
  return rgbToHex(oklchToLinear(L, 0, LINK_HUE)!.map(fromLinear) as Rgb)
}

// The book's link color: a blue at the text's lightness, walked toward the
// middle (bluer) for as long as it still reads against the background. Up to
// 7:1, never below 4.5:1; a theme where not even that fits keeps its text color.
export function linkColor(theme: Pick<Theme, 'textColor' | 'background'>): string {
  const { textColor, background } = theme
  const textContrast = contrastRatio(textColor, background)
  if (textContrast < LINK_FLOOR) return textColor
  const target = Math.max(LINK_FLOOR, Math.min(LINK_TARGET, textContrast))
  const lightBackground = luminance(background) > luminance(textColor)
  const start = oklabLightness(textColor)
  const end = lightBackground ? Math.max(start, 0.75) : Math.min(start, 0.45)
  const step = lightBackground ? 0.01 : -0.01
  let best: string | undefined
  for (let L = start; lightBackground ? L <= end : L >= end; L += step) {
    const candidate = blueAt(L)
    if (contrastRatio(candidate, background) >= target) best = candidate
    else if (best) break
  }
  return best ?? textColor
}
