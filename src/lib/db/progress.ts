import { db, type Progress } from './schema'

export function getProgress(bookId: string): Promise<Progress | undefined> {
  return db.progress.get(bookId)
}

export function listProgress(): Promise<Progress[]> {
  return db.progress.toArray()
}

export function saveProgress(progress: Progress): Promise<string> {
  return db.progress.put(progress)
}
