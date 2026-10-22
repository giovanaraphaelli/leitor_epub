import { create } from 'zustand'
import { toast } from 'sonner'
import { saveDownloadedFile } from '@/lib/db/sync'
import type { Book } from '@/lib/db/schema'
import { DriveAuthError } from '@/lib/drive/auth'
import { downloadBookBlob } from '@/lib/sync/book-file'
import { debugLog } from '@/lib/debug-log'

interface DownloadState {
  // The books downloading now, by id.
  downloading: string[]
  // Goes up when a download finished and the book's file is here, so the
  // library reloads.
  revision: number
  download: (book: Book) => Promise<void>
}

function reason(error: unknown): string {
  if (error instanceof DriveAuthError) {
    return error.problem === 'indisponivel' ? 'Sem conexão com a internet.' : 'Conecte o Google Drive para baixar.'
  }
  // IndexedDB out of space; Dexie keeps the name.
  if (error instanceof Error && error.name === 'QuotaExceededError') return 'Sem espaço no aparelho.'
  // fetch() fails with a TypeError when there's no network.
  if (error instanceof TypeError) return 'Sem conexão com a internet.'
  return error instanceof Error ? error.message : String(error)
}

// Fetches a book that's only on Drive and keeps it here, without opening it.
// Outside the library page, so a download goes on while a book is open.
export const useDownloadStore = create<DownloadState>((set, get) => ({
  downloading: [],
  revision: 0,
  download: async (book) => {
    if (get().downloading.includes(book.id)) return
    set((state) => ({ downloading: [...state.downloading, book.id] }))
    try {
      const file = await downloadBookBlob(book)
      await saveDownloadedFile(book.id, file, book.fileUpdatedAt ?? book.addedAt)
      set((state) => ({ revision: state.revision + 1 }))
    } catch (error) {
      debugLog('livro: download falhou', `${book.id.slice(0, 8)} ${String(error)}`)
      toast.error(`Não foi possível baixar "${book.title}"`, { description: reason(error) })
    } finally {
      set((state) => ({ downloading: state.downloading.filter((id) => id !== book.id) }))
    }
  },
}))
