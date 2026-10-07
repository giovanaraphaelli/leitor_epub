// The numbers of a CFI's start, in order: spine step, path inside the chapter,
// character offset. Id assertions ([...]) and temporal or spatial offsets (~, @)
// carry no order. A range CFI (base,start,end) starts at base + start.
export function cfiSteps(cfi: string): number[] {
  const body = cfi.replace(/^epubcfi\(/, '').replace(/\)$/, '')
  const [base, start = ''] = body.split(',')
  return (base + start)
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[~@][^/!:,]*/g, '')
    .split(/[/!:]/)
    .filter((part) => part !== '')
    .map(Number)
    .filter((step) => Number.isFinite(step))
}

// Negative when a comes first in the book, positive when b does, 0 when they
// start at the same place.
export function compareCfi(a: string, b: string): number {
  const x = cfiSteps(a)
  const y = cfiSteps(b)
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i] - y[i]
  }
  return x.length - y.length
}

export function byBookOrder<T extends { cfiRange: string; createdAt: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => compareCfi(a.cfiRange, b.cfiRange) || a.createdAt - b.createdAt)
}
