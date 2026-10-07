import { db, type Highlight } from './schema'

export async function listHighlights(bookId: string): Promise<Highlight[]> {
  const rows = await db.highlights.where('bookId').equals(bookId).toArray()
  return rows.sort((a, b) => a.createdAt - b.createdAt)
}

export function addHighlight(highlight: Highlight): Promise<string> {
  return db.highlights.put(highlight)
}

export function removeHighlight(id: string): Promise<void> {
  return db.highlights.delete(id)
}

// An empty note (once trimmed) removes it. An id with no highlight is a no-op.
export async function setHighlightNote(id: string, note: string): Promise<void> {
  const trimmed = note.trim()
  await db.highlights.update(id, { note: trimmed || undefined, updatedAt: Date.now() })
}
