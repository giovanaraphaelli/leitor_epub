import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { v4 as uuid } from 'uuid'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { listBooks, addBook, removeBook } from '@/lib/db/books'
import { listProgress } from '@/lib/db/progress'
import { parseEpubMetadata } from '@/lib/epub/parse'
import type { Book } from '@/lib/db/schema'
import { useThemeStore } from '@/store/theme-store'

export default function Library() {
  const [books, setBooks] = useState<Book[]>([])
  const [progressByBook, setProgressByBook] = useState<Record<string, number>>({})
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const activeTheme = useThemeStore((s) => s.activeTheme)

  // Same reasoning as Reader.tsx: text-foreground/text-muted-foreground/
  // hover:bg-muted read CSS variables, so overriding them here makes the
  // library follow the same theme as the reader instead of always showing
  // the app's default light look. --primary/--primary-foreground cover the
  // "Adicionar EPUB" button — there's no separate accent color in Theme yet,
  // so it uses the theme's colors inverted (text color as fill, background
  // as its label) instead of the app's default black/white button.
  const themeVars = {
    background: activeTheme.background,
    color: activeTheme.textColor,
    '--foreground': activeTheme.textColor,
    '--muted-foreground': activeTheme.textColor,
    '--muted': `${activeTheme.textColor}1a`,
    '--primary': activeTheme.textColor,
    '--primary-foreground': activeTheme.background,
  } as CSSProperties

  useEffect(() => {
    listBooks().then(setBooks)
    listProgress().then((progress) => {
      setProgressByBook(
        Object.fromEntries(progress.map((p) => [p.bookId, p.percentage]))
      )
    })
  }, [])

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setImporting(true)

    for (const file of Array.from(files)) {
      const metadata = await parseEpubMetadata(file)
      const book: Book = {
        id: uuid(),
        title: metadata.title,
        author: metadata.author,
        coverBlob: metadata.coverBlob,
        fileBlob: file,
        addedAt: Date.now(),
      }
      await addBook(book)
    }

    setBooks(await listBooks())
    setImporting(false)
  }

  async function handleRemove(id: string) {
    await removeBook(id)
    setBooks(await listBooks())
  }

  return (
    <div className="min-h-screen" style={themeVars}>
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Minha biblioteca</h1>
          <Button onClick={() => fileInputRef.current?.click()} disabled={importing}>
            {importing ? 'Importando...' : 'Adicionar EPUB'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".epub"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        {books.length === 0 ? (
          <p className="text-muted-foreground text-center py-24">
            Nenhum livro ainda — adicione seu primeiro EPUB para começar a ler.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {books.map((book) => {
              const percentage = progressByBook[book.id]
              return (
                <div
                  key={book.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/read/${book.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/read/${book.id}`)
                  }}
                  className="group flex cursor-pointer flex-col gap-2 text-left"
                >
                  <div className="relative aspect-2/3 w-full overflow-hidden rounded-lg border bg-muted">
                    {book.coverBlob ? (
                      <img
                        src={URL.createObjectURL(book.coverBlob)}
                        alt={book.title}
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center p-2 text-center text-sm text-muted-foreground">
                        {book.title}
                      </div>
                    )}
                    {!!percentage && (
                      <span className="absolute top-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
                        {percentage}%
                      </span>
                    )}

                    <div onClick={(e) => e.stopPropagation()}>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button
                            aria-label={`Remover ${book.title}`}
                            className="absolute top-2 left-2 flex size-7 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity hover:bg-black/90 group-hover:opacity-100"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remover "{book.title}"?</AlertDialogTitle>
                            <AlertDialogDescription>
                              O arquivo e o progresso de leitura salvo serão removidos
                              permanentemente. Essa ação não pode ser desfeita.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleRemove(book.id)}>
                              Remover
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                  <div>
                    <p className="truncate text-sm font-medium">{book.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{book.author}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
