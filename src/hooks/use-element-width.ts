import { useLayoutEffect, useState, type RefObject } from 'react'

// Measured before the first paint (layout effect), so whatever depends on it
// is already sized right when it first renders — the reader relies on that to
// hand epub.js its final width from the start.
export function useElementWidth(ref: RefObject<HTMLElement | null>): number | undefined {
  const [width, setWidth] = useState<number>()
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    setWidth(element.clientWidth)
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}
