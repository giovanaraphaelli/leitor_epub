import { db, type Book } from './schema'

export function listBooks(): Promise<Book[]> {
  return db.books.orderBy('addedAt').reverse().toArray()
}

export function getBook(id: string): Promise<Book | undefined> {
  return db.books.get(id)
}

export function addBook(book: Book): Promise<string> {
  return db.books.add(book)
}

export async function removeBook(id: string): Promise<void> {
  await db.transaction('rw', db.books, db.progress, async () => {
    await db.books.delete(id)
    await db.progress.delete(id)
  })
}
