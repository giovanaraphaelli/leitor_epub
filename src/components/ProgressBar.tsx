import type { ComponentProps } from 'react'
import type { Theme } from '@/lib/db/schema'
import { themeTint } from '@/lib/theme-colors'
import { cn } from '@/lib/utils'

type ProgressBarProps = ComponentProps<'div'> & {
  theme: Pick<Theme, 'textColor' | 'background'>
  percentage: number
  // Where the return point is (0–100), drawn above the bar; outside the
  // clipped track so the tick isn't cut off.
  marker?: number
  markerColor?: string
}

// Size and shape come from className (a thin line under the reader's header,
// a rounded pill elsewhere).
export default function ProgressBar({ theme, percentage, marker, markerColor, className, style, ...props }: ProgressBarProps) {
  return (
    <div className={cn('relative', className)} style={style} {...props}>
      <div className="h-full overflow-hidden rounded-[inherit]" style={{ background: themeTint(theme, 15) }}>
        <div className="h-full" style={{ width: `${percentage}%`, background: themeTint(theme, 60) }} />
      </div>
      {marker !== undefined && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-full mb-px size-0 -translate-x-1/2 border-x-4 border-t-[6px] border-x-transparent"
          style={{ left: `${marker}%`, borderTopColor: markerColor ?? theme.textColor }}
        />
      )}
    </div>
  )
}
