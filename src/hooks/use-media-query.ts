import { useSyncExternalStore } from 'react'

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches
  )
}

// Tailwind's `sm` breakpoint — the same line the reader's classes switch on.
export const DESKTOP_QUERY = '(min-width: 40rem)'
