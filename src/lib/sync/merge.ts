import type { Deletion, Highlight, Progress } from '@/lib/db/schema'
import { emptyLibraryFile, type LibraryFile, type RemoteBook, type RemoteHighlight, type RemoteProgress } from './library-file'

// A book as the merge sees it: the stamps already defaulted (see readLocalLibrary).
export interface LocalBook {
  id: string
  title: string
  author: string
  addedAt: number
  updatedAt: number
  fileUpdatedAt: number
  fontScale?: number
  driveFileId: string | null
  driveCoverId: string | null
  pendingUpload: boolean
}

export interface LocalLibrary {
  books: LocalBook[]
  progress: Progress[]
  highlights: Highlight[]
  deletions: Deletion[]
}

// What this device takes from the other side. `expected` is the stamp of the
// local record the decision was made against (null: there was none); the write
// is skipped if the record changed in the meantime, and the next sync decides again.
export interface LocalChanges {
  books: Array<{ id: string; book: RemoteBook; expected: number | null }>
  removedBooks: Array<{ id: string; expected: number }>
  progress: Array<{ bookId: string; progress: RemoteProgress; expected: number | null }>
  highlights: Array<{ id: string; highlight: RemoteHighlight; expected: number | null }>
  removedHighlights: Array<{ id: string; expected: number }>
  deletions: Deletion[]
}

export interface MergeResult {
  // The library both sides should have, to write back to Drive.
  file: LibraryFile
  changes: LocalChanges
}

const highlightStamp = (highlight: Highlight) => highlight.updatedAt ?? highlight.createdAt

function toRemoteBook(book: LocalBook): RemoteBook {
  return {
    title: book.title,
    author: book.author,
    addedAt: book.addedAt,
    updatedAt: book.updatedAt,
    fileUpdatedAt: book.fileUpdatedAt,
    fileId: book.driveFileId!,
    coverId: book.driveCoverId,
    fontScale: book.fontScale,
  }
}

function toRemoteProgress(progress: Progress): RemoteProgress {
  return { cfi: progress.cfi, percentage: progress.percentage, lastReadAt: progress.lastReadAt }
}

function toRemoteHighlight(highlight: Highlight): RemoteHighlight {
  return {
    bookId: highlight.bookId,
    cfiRange: highlight.cfiRange,
    text: highlight.text,
    color: highlight.color,
    note: highlight.note,
    createdAt: highlight.createdAt,
    updatedAt: highlightStamp(highlight),
  }
}

const sameBook = (mine: LocalBook, theirs: RemoteBook) =>
  mine.title === theirs.title &&
  mine.author === theirs.author &&
  mine.addedAt === theirs.addedAt &&
  mine.updatedAt === theirs.updatedAt &&
  mine.fileUpdatedAt === theirs.fileUpdatedAt &&
  mine.driveFileId === theirs.fileId &&
  mine.driveCoverId === theirs.coverId &&
  mine.fontScale === theirs.fontScale

const sameProgress = (mine: Progress, theirs: RemoteProgress) =>
  mine.cfi === theirs.cfi && mine.percentage === theirs.percentage && mine.lastReadAt === theirs.lastReadAt

const sameHighlight = (mine: Highlight, theirs: RemoteHighlight) => {
  const local = toRemoteHighlight(mine)
  return (
    local.bookId === theirs.bookId &&
    local.cfiRange === theirs.cfiRange &&
    local.text === theirs.text &&
    local.color === theirs.color &&
    local.note === theirs.note &&
    local.createdAt === theirs.createdAt &&
    local.updatedAt === theirs.updatedAt
  )
}

// The rules (spec, section 4): the later stamp wins (updatedAt for books and
// highlights, lastReadAt for progress), a tie goes to the remote side so every
// device lands on the same result, and a deletion wins over a record it isn't
// older than, taking a book's progress and highlights with it. Deletions are
// merged by key and kept forever.
export function mergeLibrary(local: LocalLibrary, remote: LibraryFile | null): MergeResult {
  const theirs = remote ?? emptyLibraryFile()
  const file = emptyLibraryFile()
  const changes: LocalChanges = { books: [], removedBooks: [], progress: [], highlights: [], removedHighlights: [], deletions: [] }

  const myDeletions = new Map(local.deletions.map((deletion) => [deletion.key, deletion.deletedAt]))
  const deletions: Record<string, number> = { ...theirs.deletions }
  for (const [key, deletedAt] of myDeletions) deletions[key] = Math.max(deletions[key] ?? 0, deletedAt)
  for (const [key, deletedAt] of Object.entries(theirs.deletions)) {
    if ((myDeletions.get(key) ?? -Infinity) < deletedAt) changes.deletions.push({ key, deletedAt })
  }
  file.deletions = deletions

  // Books that exist after the merge, and those of them that are in the file.
  const kept = new Set<string>()
  const shared = new Set<string>()
  const myBooks = new Map(local.books.map((book) => [book.id, book]))
  for (const id of new Set([...myBooks.keys(), ...Object.keys(theirs.books)])) {
    const mine = myBooks.get(id)
    const their = theirs.books[id] as RemoteBook | undefined
    const remoteWins = their !== undefined && (mine === undefined || their.updatedAt >= mine.updatedAt)
    const stamp = remoteWins ? their.updatedAt : mine!.updatedAt
    const deletedAt = deletions[`book:${id}`]
    if (deletedAt !== undefined && deletedAt >= stamp) {
      if (mine) changes.removedBooks.push({ id, expected: mine.updatedAt })
      continue
    }
    kept.add(id)
    if (remoteWins) {
      // A measurement only this device has (the winning record comes from a
      // device that imported the book before fontScale existed) is kept, and
      // goes up with it.
      const book = their.fontScale === undefined && mine?.fontScale !== undefined ? { ...their, fontScale: mine.fontScale } : their
      file.books[id] = book
      shared.add(id)
      // Taking the remote record also drops an upload this device had pending.
      if (!mine || !sameBook(mine, book)) changes.books.push({ id, book, expected: mine?.updatedAt ?? null })
    } else if (mine!.driveFileId && !mine!.pendingUpload) {
      file.books[id] = toRemoteBook(mine!)
      shared.add(id)
    } else if (their) {
      // Edited here and not uploaded yet: the file keeps the previous version
      // until the new one is on Drive, or another device would fetch the old
      // content believing it's the new one.
      file.books[id] = their
      shared.add(id)
    }
  }

  const myProgress = new Map(local.progress.map((progress) => [progress.bookId, progress]))
  for (const bookId of new Set([...myProgress.keys(), ...Object.keys(theirs.progress)])) {
    if (!kept.has(bookId)) continue
    const mine = myProgress.get(bookId)
    const their = theirs.progress[bookId] as RemoteProgress | undefined
    const remoteWins = their !== undefined && (mine === undefined || their.lastReadAt >= mine.lastReadAt)
    if (remoteWins) {
      if (shared.has(bookId)) file.progress[bookId] = their
      if (!mine || !sameProgress(mine, their)) {
        changes.progress.push({ bookId, progress: their, expected: mine?.lastReadAt ?? null })
      }
    } else if (shared.has(bookId)) {
      file.progress[bookId] = toRemoteProgress(mine!)
    }
  }

  const myHighlights = new Map(local.highlights.map((highlight) => [highlight.id, highlight]))
  for (const id of new Set([...myHighlights.keys(), ...Object.keys(theirs.highlights)])) {
    const mine = myHighlights.get(id)
    const their = theirs.highlights[id] as RemoteHighlight | undefined
    const remoteWins = their !== undefined && (mine === undefined || their.updatedAt >= highlightStamp(mine))
    const winner = remoteWins ? their : toRemoteHighlight(mine!)
    const deletedAt = deletions[`highlight:${id}`]
    if (!kept.has(winner.bookId) || (deletedAt !== undefined && deletedAt >= winner.updatedAt)) {
      if (mine) changes.removedHighlights.push({ id, expected: highlightStamp(mine) })
      continue
    }
    if (shared.has(winner.bookId)) file.highlights[id] = winner
    if (remoteWins && (!mine || !sameHighlight(mine, their))) {
      changes.highlights.push({ id, highlight: their, expected: mine ? highlightStamp(mine) : null })
    }
  }

  return { file, changes }
}
