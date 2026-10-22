import { db, type Highlight } from './schema'
import { highlightDeletionKey, isDriveEnabled } from './deletions'

export async function listHighlights(bookId: string): Promise<Highlight[]> {
  const rows = await db.highlights.where('bookId').equals(bookId).toArray()
  return rows.sort((a, b) => a.createdAt - b.createdAt)
}

// updatedAt starts at the creation date, so every highlight has an answer to
// "which side changed it last".
export function addHighlight(highlight: Highlight): Promise<string> {
  return db.highlights.put({ ...highlight, updatedAt: highlight.updatedAt ?? highlight.createdAt })
}

export async function removeHighlight(id: string): Promise<void> {
  // Read before the transaction, which only covers the tables below.
  const track = await isDriveEnabled()
  await db.transaction('rw', db.highlights, db.deletions, async () => {
    await db.highlights.delete(id)
    if (track) await db.deletions.put({ key: highlightDeletionKey(id), deletedAt: Date.now() })
  })
}

// An empty note (once trimmed) removes it. An id with no highlight is a no-op.
export async function setHighlightNote(id: string, note: string): Promise<void> {
  const trimmed = note.trim()
  await db.highlights.update(id, { note: trimmed || undefined, updatedAt: Date.now() })
}
