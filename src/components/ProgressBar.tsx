import type { ComponentProps } from 'react'
import type { Theme } from '@/lib/db/schema'
import { themeTint } from '@/lib/theme-colors'
import { cn } from '@/lib/utils'

type ProgressBarProps = ComponentProps<'div'> & {
  theme: Pick<Theme, 'textColor' | 'background'>
  percentage: number
}

// Size and shape come from className (a thin line under the reader's header,
// a rounded pill elsewhere).
export default function ProgressBar({ theme, percentage, className, style, ...props }: ProgressBarProps) {
  return (
    <div
      className={cn('overflow-hidden', className)}
      style={{ ...style, background: themeTint(theme, 15) }}
      {...props}
    >
      <div className="h-full" style={{ width: `${percentage}%`, background: themeTint(theme, 60) }} />
    </div>
  )
}
