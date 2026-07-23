import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { v4 as uuid } from 'uuid'
import { Button } from '@/components/ui/button'
import { listBooks, addBook } from '@/lib/db/books'
import { parseEpubMetadata } from '@/lib/epub/parse'
import type { Book } from '@/lib/db/schema'

export default function Library() {
  const [books, setBooks] = useState<Book[]>([])
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    listBooks().then(setBooks)
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

  return (
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
          {books.map((book) => (
            <button
              key={book.id}
              onClick={() => navigate(`/read/${book.id}`)}
              className="group flex flex-col gap-2 text-left"
            >
              <div className="aspect-2/3 w-full overflow-hidden rounded-lg border bg-muted">
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
              </div>
              <div>
                <p className="truncate text-sm font-medium">{book.title}</p>
                <p className="truncate text-xs text-muted-foreground">{book.author}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
