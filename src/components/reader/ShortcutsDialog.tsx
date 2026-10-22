import type { CSSProperties } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const SHORTCUTS: [string, string][] = [
  ['→  ↓  PageDown  Espaço', 'Próxima página'],
  ['←  ↑  PageUp  Shift+Espaço', 'Página anterior'],
  ['Roda do mouse ou trackpad', 'Vira uma página por gesto'],
  ['Home  /  End', 'Início ou fim do capítulo'],
  ['/', 'Buscar no livro'],
  ['F', 'Tela cheia'],
  ['Alt+←', 'Voltar para onde você lia, depois de um salto'],
  ['?', 'Esta lista'],
]

interface ShortcutsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Renders through a portal, outside the reader's themed subtree.
  style: CSSProperties
}

export default function ShortcutsDialog({ open, onOpenChange, style }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={style} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Atalhos do teclado</DialogTitle>
          <DialogDescription className="sr-only">Teclas que funcionam durante a leitura</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={keys} className="contents">
              <dt className="font-mono text-xs whitespace-nowrap">{keys}</dt>
              <dd className="text-muted-foreground">{action}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
