import { saveDownloadedFile } from '@/lib/db/sync'
import type { Book } from '@/lib/db/schema'
import { driveApi, type DriveApi } from '@/lib/drive/api'
import { debugLog } from '@/lib/debug-log'

export class BookNotHereError extends Error {
  constructor() {
    super('O arquivo do livro não está neste aparelho')
  }
}

// The file here is missing ("na nuvem") or behind the record, when another
// device edited the book since (blobUpdatedAt < fileUpdatedAt).
export function needsDownload(book: Book): boolean {
  return book.fileBlob === null || (book.blobUpdatedAt ?? 0) < (book.fileUpdatedAt ?? 0)
}

// The book's file as it is on Drive now. Throws when it can't be fetched (no
// connection, the Drive disconnected, the file gone); keeping it is up to the caller.
export async function downloadBookBlob(book: Book, api: DriveApi = driveApi): Promise<Blob> {
  if (!book.driveFileId) throw new BookNotHereError()
  const file = new Blob([await api.downloadBlob(book.driveFileId)], { type: 'application/epub+zip' })
  debugLog('livro: baixado', `${book.id.slice(0, 8)} ${file.size} bytes`)
  return file
}

// The book's file, fetched from Drive when this device doesn't have it or has
// an older version. Without a connection, an older version still opens: an
// edit only changes the title, the author and the cover.
export async function ensureBookFile(book: Book, api: DriveApi = driveApi): Promise<Blob> {
  if (book.fileBlob && !needsDownload(book)) return book.fileBlob
  if (book.driveFileId) {
    let file: Blob | null = null
    try {
      file = await downloadBookBlob(book, api)
    } catch (error) {
      debugLog('livro: não baixado', `${book.id.slice(0, 8)} ${String(error)}`)
    }
    if (file) {
      // Opened even if it can't be kept (a device out of space): the next
      // opening just downloads it again.
      await saveDownloadedFile(book.id, file, book.fileUpdatedAt ?? book.addedAt).catch((error: unknown) =>
        debugLog('livro: baixado e não guardado', `${book.id.slice(0, 8)} ${String(error)}`),
      )
      return file
    }
  }
  if (book.fileBlob) return book.fileBlob
  throw new BookNotHereError()
}
