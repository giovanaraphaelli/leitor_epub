import { useLayoutEffect, useRef } from 'react'

// Its object URL lives exactly as long as this image shows the blob, revoked
// when either goes. Created in an effect and set on the element directly, not
// during render: StrictMode runs render work twice, and the URL made by the
// discarded pass was never revoked. A layout effect, so the cover is there on
// the first paint instead of a frame later.
export default function CoverImage({ blob, className }: { blob: Blob; className?: string }) {
  const ref = useRef<HTMLImageElement>(null)
  useLayoutEffect(() => {
    const url = URL.createObjectURL(blob)
    ref.current!.src = url
    return () => URL.revokeObjectURL(url)
  }, [blob])
  return <img ref={ref} alt="" className={className} />
}
