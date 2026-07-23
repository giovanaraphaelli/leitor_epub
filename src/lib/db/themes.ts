import { db, type Theme } from './schema'
import { PRESET_THEMES } from './presets'

export async function listThemes(): Promise<Theme[]> {
  const custom = await db.themes.toArray()
  return [...PRESET_THEMES, ...custom]
}

export function saveTheme(theme: Theme): Promise<string> {
  return db.themes.put(theme)
}

export function removeTheme(id: string): Promise<void> {
  return db.themes.delete(id)
}
