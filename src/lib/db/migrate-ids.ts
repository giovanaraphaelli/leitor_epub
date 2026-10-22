import { bookIdFor, isBookId } from '@/lib/epub/book-id'
import { debugLog } from '@/lib/debug-log'
import { db, type Highlight } from './schema'

export interface MigrationProgress {
  done: number
  total: number
}

export interface MigrationResult {
  migrated: number
  merged: number
  failed: number
}

async function legacyIds(): Promise<string[]> {
  return (await db.books.toCollection().primaryKeys()).filter((id) => !isBookId(id))
}

export async function hasLegacyBooks(): Promise<boolean> {
  return (await legacyIds()).length > 0
}

// Books used to get a random id; the id now comes from the book's content (see
// bookIdFor), so the same book is the same book everywhere. This gives each old
// book its new id and takes its progress and highlights along. A primary key
// can't change, so the book is written again under the new id.
//
// One book per transaction: closing the app halfway leaves the rest for the
// next launch, and no book is ever half moved. A book whose new id already
// exists (the same file imported twice, or after the update) is merged into it.
export async function migrateBookIds(onProgress?: (progress: MigrationProgress) => void): Promise<MigrationResult> {
  const ids = await legacyIds()
  const result: MigrationResult = { migrated: 0, merged: 0, failed: 0 }
  for (const [index, oldId] of ids.entries()) {
    onProgress?.({ done: index, total: ids.length })
    try {
      const outcome = await migrateOne(oldId)
      if (outcome === 'moved') result.migrated++
      if (outcome === 'merged') result.merged++
    } catch (error) {
      result.failed++
      console.error(`Não foi possível atualizar o livro ${oldId}`, error)
      debugLog('migração: livro com falha', `${oldId}: ${String(error)}`)
    }
  }
  onProgress?.({ done: ids.length, total: ids.length })
  return result
}

async function migrateOne(oldId: string): Promise<'moved' | 'merged' | 'gone'> {
  const book = await db.books.get(oldId)
  if (!book) return 'gone'
  // Books without their file came from another device, already with an id
  // from the content; an old one always has its file.
  if (!book.fileBlob) throw new Error('Livro sem o arquivo neste aparelho')

  // Everything slow happens before the transaction, which closes by itself if
  // it waits on anything but IndexedDB. The bytes go into new Blobs, so the new
  // row doesn't lean on the storage of the old one that this same transaction
  // deletes (WebKit has a history of getting that wrong).
  const buffer = await book.fileBlob.arrayBuffer()
  const id = await bookIdFor(buffer)
  const fileBlob = new Blob([buffer], { type: book.fileBlob.type })
  const coverBlob = book.coverBlob
    ? new Blob([await book.coverBlob.arrayBuffer()], { type: book.coverBlob.type })
    : null

  return db.transaction('rw', db.books, db.progress, db.highlights, async () => {
    const current = await db.books.get(oldId)
    if (!current) return 'gone' as const
    const target = await db.books.get(id)

    if (target) {
      await db.books.update(id, {
        addedAt: Math.min(target.addedAt, current.addedAt),
        fontScale: target.fontScale ?? current.fontScale,
        locations: target.locations ?? current.locations,
      })
    } else {
      await db.books.add({
        ...current,
        id,
        fileBlob,
        coverBlob,
        updatedAt: current.updatedAt ?? current.addedAt,
        fileUpdatedAt: current.fileUpdatedAt ?? current.addedAt,
        blobUpdatedAt: current.blobUpdatedAt ?? current.addedAt,
        pendingUpload: current.pendingUpload ?? true,
      })
    }

    const moved = await db.progress.get(oldId)
    const kept = await db.progress.get(id)
    if (moved && (!kept || moved.lastReadAt > kept.lastReadAt)) {
      await db.progress.put({ ...moved, bookId: id })
    }
    await db.progress.delete(oldId)

    await moveHighlights(oldId, id)
    await db.books.delete(oldId)
    return target ? ('merged' as const) : ('moved' as const)
  })
}

const lastChange = (highlight: Highlight) => highlight.updatedAt ?? highlight.createdAt

async function moveHighlights(oldId: string, id: string): Promise<void> {
  const incoming = await db.highlights.where('bookId').equals(oldId).toArray()
  if (incoming.length === 0) return
  const there = await db.highlights.where('bookId').equals(id).toArray()
  const byPassage = new Map(there.map((highlight) => [highlight.cfiRange, highlight]))
  for (const highlight of incoming) {
    const twin = byPassage.get(highlight.cfiRange)
    // The same passage marked on both sides: the one changed last stays.
    if (twin && lastChange(twin) >= lastChange(highlight)) {
      await db.highlights.delete(highlight.id)
      continue
    }
    if (twin) await db.highlights.delete(twin.id)
    await db.highlights.put({ ...highlight, bookId: id })
  }
}
