import { useState, type CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { themeTint } from '@/lib/theme-colors'
import { useThemeStore } from '@/store/theme-store'

interface NoteEditorProps {
  // The highlighted passage the note is about.
  excerpt: string
  // The note as saved ('' when there is none).
  note: string
  onSave: (note: string) => void
  onClose: () => void
}

// Writing, changing or clearing the note on a highlight. Mounted only while it's
// open, so the draft always starts from what is saved.
export default function NoteEditor({ excerpt, note, onSave, onClose }: NoteEditorProps) {
  const activeTheme = useThemeStore((s) => s.activeTheme)
  const [draft, setDraft] = useState(note)
  // Dialogs render through a portal, outside the reader's theme scope (same
  // reasoning as ReaderSettings and the selection popover).
  const themeVars = {
    background: themeTint(activeTheme, 5),
    color: activeTheme.textColor,
    '--foreground': activeTheme.textColor,
    '--muted-foreground': activeTheme.textColor,
    '--muted': `${activeTheme.textColor}1a`,
    '--background': activeTheme.background,
    '--primary': activeTheme.textColor,
    '--primary-foreground': activeTheme.background,
    '--border': themeTint(activeTheme, 20),
    '--input': themeTint(activeTheme, 20),
    '--ring': themeTint(activeTheme, 65),
  } as CSSProperties

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        style={themeVars}
        data-note-editor
        // A tap outside (on iOS, the way to put the keyboard away) must not
        // throw away what was typed.
        onInteractOutside={(event) => {
          if (draft.trim() !== note.trim()) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>Nota</DialogTitle>
          <DialogDescription className="line-clamp-3">{excerpt}</DialogDescription>
        </DialogHeader>
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={5}
          className="max-h-[40dvh]"
          autoFocus
          aria-label="Nota"
          placeholder="Escreva uma nota sobre o trecho"
        />
        <DialogFooter>
          {note && (
            <Button variant="ghost" className="max-sm:h-11" onClick={() => onSave('')}>
              Apagar nota
            </Button>
          )}
          <Button variant="outline" className="max-sm:h-11" onClick={onClose}>
            Cancelar
          </Button>
          <Button className="max-sm:h-11" onClick={() => onSave(draft)}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
