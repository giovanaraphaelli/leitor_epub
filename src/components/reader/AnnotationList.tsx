import { NotebookPen } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface AnnotationItem {
  id: string
  cfiRange: string
  text: string
  note?: string
  color: string
  // The chapter the passage is in, when the table of contents says.
  chapter?: string
}

interface AnnotationListProps {
  items: AnnotationItem[]
  onOpen: (cfiRange: string) => void
  onEditNote: (id: string) => void
}

// This book's highlights in reading order, each with its note: a tap goes to the
// passage, the pen writes or changes the note.
export default function AnnotationList({ items, onOpen, onEditNote }: AnnotationListProps) {
  if (items.length === 0) {
    return <p className="px-2 py-8 text-center text-sm opacity-70">Nenhum grifo neste livro ainda.</p>
  }
  return (
    <ul className="flex flex-col gap-1 pb-4">
      {items.map((item) => (
        <li key={item.id} data-annotation className="flex items-start gap-1 rounded-md hover:bg-muted">
          <button
            type="button"
            onClick={() => onOpen(item.cfiRange)}
            className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 px-2 py-2.5 text-left"
          >
            <span className="line-clamp-3 border-l-4 pl-2 text-sm" style={{ borderColor: item.color }}>
              {item.text}
            </span>
            {item.note && <span className="line-clamp-4 text-sm whitespace-pre-line italic">{item.note}</span>}
            {item.chapter && <span className="text-xs opacity-70">{item.chapter}</span>}
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0"
            aria-label={item.note ? 'Editar nota' : 'Escrever nota'}
            title={item.note ? 'Editar nota' : 'Escrever nota'}
            onClick={() => onEditNote(item.id)}
          >
            <NotebookPen className="size-5" />
          </Button>
        </li>
      ))}
    </ul>
  )
}
