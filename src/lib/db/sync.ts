import type { LocalChanges, LocalLibrary } from '@/lib/sync/merge'
import { db, type BookWithFile } from './schema'
import { getSetting, setSetting } from './settings'

// The sync's side of the database. Writes here never go through updateBook:
// what comes from another device must not stamp the book as changed here.

export interface DriveFolders {
  root: string
  data: string
  covers: string
}

const FOLDERS_KEY = 'driveFolders'

export function getDriveFolders(): Promise<DriveFolders | undefined> {
  return getSetting<DriveFolders>(FOLDERS_KEY)
}

export function setDriveFolders(folders: DriveFolders): Promise<string> {
  return setSetting(FOLDERS_KEY, folders)
}

// Returns how many there were.
export async function clearDeletions(): Promise<number> {
  const count = await db.deletions.count()
  await db.deletions.clear()
  return count
}

// One read, so the merge sees a single moment of the library.
export async function readLocalLibrary(): Promise<LocalLibrary> {
  return db.transaction('r', db.books, db.progress, db.highlights, db.deletions, async () => {
    const books = await db.books.toArray()
    return {
      books: books.map((book) => ({
        id: book.id,
        title: book.title,
        author: book.author,
        addedAt: book.addedAt,
        updatedAt: book.updatedAt ?? book.addedAt,
        fileUpdatedAt: book.fileUpdatedAt ?? book.addedAt,
        fontScale: book.fontScale,
        driveFileId: book.driveFileId ?? null,
        driveCoverId: book.driveCoverId ?? null,
        pendingUpload: book.pendingUpload ?? true,
      })),
      progress: await db.progress.toArray(),
      highlights: await db.highlights.toArray(),
      deletions: await db.deletions.toArray(),
    }
  })
}

// How many records a sync changed here, by kind: the books that arrived from
// another device or were removed there are announced to the reader; the rest
// (edits, progress, highlights) isn't.
export interface AppliedChanges {
  booksAdded: number
  booksRemoved: number
  other: number
}

// Writes what the merge took from the other side, in one transaction. Each
// record is written only if it's still the one the merge saw; one that changed
// meanwhile (the reader saved a position, a highlight was edited) is left for
// the next sync to decide.
export async function applyRemoteChanges(changes: LocalChanges): Promise<AppliedChanges> {
  const applied: AppliedChanges = { booksAdded: 0, booksRemoved: 0, other: 0 }
  await db.transaction('rw', db.books, db.progress, db.highlights, db.deletions, async () => {
    for (const { id, book, expected } of changes.books) {
      const current = await db.books.get(id)
      if (expected === null) {
        if (current) continue
        // A book from another device arrives without its file ("na nuvem").
        await db.books.add({
          id,
          title: book.title,
          author: book.author,
          coverBlob: null,
          fileBlob: null,
          addedAt: book.addedAt,
          updatedAt: book.updatedAt,
          fileUpdatedAt: book.fileUpdatedAt,
          pendingUpload: false,
          driveFileId: book.fileId,
          driveCoverId: book.coverId ?? undefined,
          fontScale: book.fontScale,
        })
        applied.booksAdded++
        continue
      }
      if (!current || (current.updatedAt ?? current.addedAt) !== expected) continue
      // Neither side ever edited the book (same id, files never rewritten): the
      // file here has the winning record's content, and counts as its version
      // instead of being downloaded again. Otherwise, an upload this device had
      // pending lost to the other side's edit, and the file is fetched again so
      // it matches the record.
      const sameContent = (current.fileUpdatedAt ?? current.addedAt) === current.addedAt && book.fileUpdatedAt === book.addedAt
      await db.books.update(id, {
        title: book.title,
        author: book.author,
        addedAt: book.addedAt,
        updatedAt: book.updatedAt,
        fileUpdatedAt: book.fileUpdatedAt,
        driveFileId: book.fileId,
        driveCoverId: book.coverId ?? undefined,
        fontScale: book.fontScale ?? current.fontScale,
        pendingUpload: false,
        ...(sameContent ? { blobUpdatedAt: book.fileUpdatedAt } : current.pendingUpload ? { blobUpdatedAt: 0 } : {}),
        // A newer record can come with a new cover; it's downloaded again.
        ...(book.coverId && book.updatedAt > expected ? { coverBlob: null } : {}),
      })
      applied.other++
    }

    for (const { id, expected } of changes.removedBooks) {
      const current = await db.books.get(id)
      if (!current || (current.updatedAt ?? current.addedAt) !== expected) continue
      await db.books.delete(id)
      await db.progress.delete(id)
      await db.highlights.where('bookId').equals(id).delete()
      applied.booksRemoved++
    }

    for (const { bookId, progress, expected } of changes.progress) {
      if (!(await db.books.get(bookId))) continue
      const current = await db.progress.get(bookId)
      if ((current?.lastReadAt ?? null) !== expected) continue
      await db.progress.put({ bookId, cfi: progress.cfi, percentage: progress.percentage, lastReadAt: progress.lastReadAt })
      applied.other++
    }

    for (const { id, highlight, expected } of changes.highlights) {
      if (!(await db.books.get(highlight.bookId))) continue
      const current = await db.highlights.get(id)
      if ((current ? (current.updatedAt ?? current.createdAt) : null) !== expected) continue
      await db.highlights.put({ id, ...highlight })
      applied.other++
    }

    for (const { id, expected } of changes.removedHighlights) {
      const current = await db.highlights.get(id)
      if (!current || (current.updatedAt ?? current.createdAt) !== expected) continue
      await db.highlights.delete(id)
      applied.other++
    }

    for (const deletion of changes.deletions) {
      const current = await db.deletions.get(deletion.key)
      if (!current || current.deletedAt < deletion.deletedAt) await db.deletions.put(deletion)
    }
  })
  return applied
}

export async function listBooksToUpload(): Promise<BookWithFile[]> {
  const books = await db.books.toArray()
  return books.filter((book): book is BookWithFile => book.pendingUpload === true && book.fileBlob !== null)
}

// The Drive ids are kept either way, so the next upload updates these same
// files instead of making copies; the book only stops being pending if it
// didn't change while its files were going up.
export async function markBookUploaded(
  id: string,
  refs: { driveFileId: string; driveCoverId: string | null },
  expected: { updatedAt: number; fileUpdatedAt: number },
): Promise<boolean> {
  return db.transaction('rw', db.books, async () => {
    const current = await db.books.get(id)
    if (!current) return false
    const unchanged =
      (current.updatedAt ?? current.addedAt) === expected.updatedAt &&
      (current.fileUpdatedAt ?? current.addedAt) === expected.fileUpdatedAt
    await db.books.update(id, {
      driveFileId: refs.driveFileId,
      driveCoverId: refs.driveCoverId ?? undefined,
      ...(unchanged ? { pendingUpload: false } : {}),
    })
    return unchanged
  })
}

export async function listBooksMissingCover(): Promise<Array<{ id: string; driveCoverId: string }>> {
  const books = await db.books.toArray()
  return books.flatMap((book) => (book.driveCoverId && !book.coverBlob ? [{ id: book.id, driveCoverId: book.driveCoverId }] : []))
}

export async function saveDownloadedCover(id: string, cover: Blob): Promise<void> {
  await db.books.update(id, { coverBlob: cover })
}

// The file is now the version the book's record describes.
export async function saveDownloadedFile(id: string, file: Blob, fileUpdatedAt: number): Promise<void> {
  await db.books.update(id, { fileBlob: file, blobUpdatedAt: fileUpdatedAt })
}
