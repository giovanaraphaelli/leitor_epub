import { db } from './schema'

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const record = await db.settings.get(key)
  return record?.value as T | undefined
}

export function setSetting(key: string, value: unknown): Promise<string> {
  return db.settings.put({ key, value })
}
