// biblioteca.json: what every device shares through Drive. Only books whose
// file is already on Drive are in it (with their progress and highlights), so
// no device lists a book it can't download.

export const LIBRARY_FORMAT = 1

export interface RemoteBook {
  title: string
  author: string
  addedAt: number
  updatedAt: number
  fileUpdatedAt: number
  fileId: string
  coverId: string | null
  // Measured on import by the device that added the book (see prepareEpub),
  // so the book opens at the theme's text size on the others too.
  fontScale?: number
}

export interface RemoteProgress {
  cfi: string | null
  percentage: number
  lastReadAt: number
}

export interface RemoteHighlight {
  bookId: string
  cfiRange: string
  text: string
  color: string
  note?: string
  createdAt: number
  updatedAt: number
}

export interface LibraryFile {
  formatVersion: number
  books: Record<string, RemoteBook>
  progress: Record<string, RemoteProgress>
  highlights: Record<string, RemoteHighlight>
  // `book:<id>` or `highlight:<id>` → deletedAt
  deletions: Record<string, number>
}

// Written by a newer version of the app: this one must not overwrite it.
export class UnsupportedLibraryFormat extends Error {
  readonly formatVersion: number

  constructor(formatVersion: number) {
    super(`biblioteca.json no formato ${formatVersion}`)
    this.formatVersion = formatVersion
  }
}

export function emptyLibraryFile(): LibraryFile {
  return { formatVersion: LIBRARY_FORMAT, books: {}, progress: {}, highlights: {}, deletions: {} }
}

type Fields = Record<string, unknown>

const isRecord = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string'
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function isRemoteBook(value: unknown): value is RemoteBook {
  return (
    isRecord(value) &&
    isText(value.title) &&
    isText(value.author) &&
    isNumber(value.addedAt) &&
    isNumber(value.updatedAt) &&
    isNumber(value.fileUpdatedAt) &&
    isText(value.fileId) &&
    (value.coverId === null || isText(value.coverId)) &&
    (value.fontScale === undefined || isNumber(value.fontScale))
  )
}

function isRemoteProgress(value: unknown): value is RemoteProgress {
  return isRecord(value) && (value.cfi === null || isText(value.cfi)) && isNumber(value.percentage) && isNumber(value.lastReadAt)
}

function isRemoteHighlight(value: unknown): value is RemoteHighlight {
  return (
    isRecord(value) &&
    isText(value.bookId) &&
    isText(value.cfiRange) &&
    isText(value.text) &&
    isText(value.color) &&
    (value.note === undefined || isText(value.note)) &&
    isNumber(value.createdAt) &&
    isNumber(value.updatedAt)
  )
}

// Entries that don't have the expected shape are dropped one by one, so a
// single damaged record doesn't cost the rest.
function entries<T>(value: unknown, isValid: (entry: unknown) => entry is T): Record<string, T> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, T] => isValid(entry[1])))
}

// null when the text isn't a library at all: the sync then rewrites it from
// what this device has, and the others fill in the rest on their next sync.
export function parseLibraryFile(text: string): LibraryFile | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(data)) return null
  if (isNumber(data.formatVersion) && data.formatVersion > LIBRARY_FORMAT) {
    throw new UnsupportedLibraryFormat(data.formatVersion)
  }
  if (data.formatVersion !== LIBRARY_FORMAT) return null
  return {
    formatVersion: LIBRARY_FORMAT,
    books: entries(data.books, isRemoteBook),
    progress: entries(data.progress, isRemoteProgress),
    highlights: entries(data.highlights, isRemoteHighlight),
    deletions: entries(data.deletions, isNumber),
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, sortKeys(value[key])]),
  )
}

// Keys in a fixed order, so the same library always gives the same text and
// "did anything change" is a string comparison.
export function serializeLibraryFile(file: LibraryFile): string {
  return JSON.stringify(sortKeys(file), null, 2)
}
