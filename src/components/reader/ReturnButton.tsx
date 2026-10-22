import { Undo2, X } from 'lucide-react'
import type { Origin } from '@/lib/reader/checkpoint'
import { cn } from '@/lib/utils'

interface ReturnButtonProps {
  origin: Origin
  color: string
  background: string
  // From lg, the header has room for the chapter's name.
  withChapter?: boolean
  onBack: () => void
  onDismiss: () => void
  className?: string
}

export default function ReturnButton({ origin, color, background, withChapter, onBack, onDismiss, className }: ReturnButtonProps) {
  const percentage = origin.percentage === undefined ? '' : ` · ${origin.percentage}%`
  const where = [origin.chapterLabel, origin.percentage !== undefined && `${origin.percentage}%`].filter(Boolean).join(', ')
  return (
    <div
      className={cn('inline-flex items-stretch overflow-hidden rounded-lg text-xs font-semibold', className)}
      style={{ color, background }}
    >
      <button
        type="button"
        onClick={onBack}
        aria-label={`Voltar para onde você lia${where ? ` (${where})` : ''}`}
        title="Voltar para onde você lia (Alt+←)"
        className="flex min-w-0 cursor-pointer items-center gap-1 px-3 whitespace-nowrap"
      >
        <Undo2 className="size-4 shrink-0" />
        {withChapter && origin.chapterLabel ? (
          <>
            <span className="hidden max-w-56 truncate lg:inline">Voltar para {origin.chapterLabel}</span>
            <span className="lg:hidden">Voltar</span>
          </>
        ) : (
          'Voltar'
        )}
        {percentage}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Ficar aqui"
        title="Ficar aqui"
        className="flex cursor-pointer items-center border-l px-2.5"
        style={{ borderColor: `${color}33` }}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
