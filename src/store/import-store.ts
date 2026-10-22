import { create } from 'zustand'
import { toast } from 'sonner'
import { addBook, getBook } from '@/lib/db/books'
import type { Book } from '@/lib/db/schema'
import { bookIdFor } from '@/lib/epub/book-id'
import { parseEpubMetadata, type ParsedEpub } from '@/lib/epub/parse'
import { prepareEpub, type PreparedEpub } from '@/lib/epub/prepare'
import { requestPersistentStorage } from '@/lib/storage'
import { useSyncStore } from './sync-store'

export type ImportStatus = 'fila' | 'preparando' | 'falhou'

// A picked file on its way to becoming a book. Title, author and cover come
// in once the file's metadata is read, while it's still being prepared.
export interface ImportItem {
  key: string
  fileName: string
  status: ImportStatus
  title?: string
  author?: string
  coverBlob?: Blob | null
}

// The import's steps, and what happens once the queue empties; passed in so
// the tests can run the queue without epub.js or a database.
export interface ImportDeps {
  idFor: (file: File) => Promise<string>
  exists: (id: string) => Promise<{ title: string } | undefined>
  readMetadata: (file: File) => Promise<ParsedEpub>
  prepare: (file: File) => Promise<PreparedEpub>
  save: (book: Book) => Promise<unknown>
  finished: (imported: number, repeated: string[]) => void
}

interface ImportState {
  items: ImportItem[]
  // Goes up each time a book is saved, so the library reloads.
  revision: number
  add: (files: File[]) => void
  dismiss: (key: string) => void
}

const defaultDeps: ImportDeps = {
  idFor: bookIdFor,
  exists: getBook,
  readMetadata: parseEpubMetadata,
  prepare: prepareEpub,
  save: addBook,
  finished: (imported, repeated) => {
    if (repeated.length > 0) {
      toast(
        repeated.length === 1
          ? `"${repeated[0]}" já está na biblioteca`
          : `${repeated.length} livros já estavam na biblioteca`,
      )
    }
    if (imported > 0) {
      void requestPersistentStorage()
      void useSyncStore.getState().run()
    }
  },
}

// One file at a time, in the order picked; files picked meanwhile join the
// same queue. It lives outside the library page, which unmounts when a book
// opens: the import goes on, and its cards are there on the way back.
export function createImportStore(deps: ImportDeps = defaultDeps) {
  // The files themselves stay out of the state the page renders.
  const files = new Map<string, File>()
  let nextKey = 0
  let draining = false
  let imported = 0
  let repeated: string[] = []

  return create<ImportState>((set, get) => {
    const update = (key: string, changes: Partial<ImportItem>) =>
      set((state) => ({ items: state.items.map((item) => (item.key === key ? { ...item, ...changes } : item)) }))
    const drop = (key: string) => set((state) => ({ items: state.items.filter((item) => item.key !== key) }))
    const nextQueued = () => get().items.find((item) => item.status === 'fila')

    async function importFile(key: string, file: File) {
      update(key, { status: 'preparando' })
      // The id comes from the file as picked, before prepare rewrites its
      // stylesheets, and is checked before the slow work. The queue being
      // sequential, a file picked twice is caught here too: by its turn, the
      // first copy is already saved.
      const id = await deps.idFor(file)
      const existing = await deps.exists(id)
      if (existing) {
        repeated.push(existing.title)
        drop(key)
        return
      }
      const metadata = await deps.readMetadata(file)
      update(key, { title: metadata.title, author: metadata.author, coverBlob: metadata.coverBlob })
      const prepared = await deps.prepare(file)
      await deps.save({
        id,
        title: metadata.title,
        author: metadata.author,
        coverBlob: metadata.coverBlob,
        fileBlob: prepared.fileBlob,
        fontScale: prepared.fontScale,
        locations: prepared.locations,
        addedAt: Date.now(),
      })
      imported++
      set((state) => ({ revision: state.revision + 1 }))
      drop(key)
    }

    async function drain() {
      if (draining) return
      draining = true
      for (let next = nextQueued(); next; next = nextQueued()) {
        const file = files.get(next.key)!
        files.delete(next.key)
        try {
          await importFile(next.key, file)
        } catch (error) {
          // One file that isn't a valid EPUB doesn't stop the others; its card
          // stays until dismissed.
          console.error(`Não foi possível importar ${file.name}`, error)
          update(next.key, { status: 'falhou' })
        }
      }
      draining = false
      const done = { imported, repeated }
      imported = 0
      repeated = []
      deps.finished(done.imported, done.repeated)
    }

    return {
      items: [],
      revision: 0,
      add: (picked) => {
        const items = picked.map((file): ImportItem => {
          const key = String(++nextKey)
          files.set(key, file)
          return { key, fileName: file.name, status: 'fila' }
        })
        set((state) => ({ items: [...state.items, ...items] }))
        void drain()
      },
      dismiss: (key) =>
        set((state) => ({ items: state.items.filter((item) => item.key !== key || item.status !== 'falhou') })),
    }
  })
}

export const useImportStore = createImportStore()
