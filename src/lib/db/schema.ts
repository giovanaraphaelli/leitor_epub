import Dexie, { type EntityTable } from 'dexie'

export interface Book {
  id: string
  title: string
  author: string
  coverBlob: Blob | null
  fileBlob: Blob
  addedAt: number
}

export interface Progress {
  bookId: string
  cfi: string | null
  percentage: number
  lastReadAt: number
}

export interface Highlight {
  id: string
  bookId: string
  cfiRange: string
  text: string
  color: string
  createdAt: number
  // The reader's own note on the passage; absent when there is none. Not
  // indexed, so adding it needed no new database version.
  note?: string
  // When the note was last written.
  updatedAt?: number
}

export type ColumnLayout = 'auto' | 'single' | 'double'

export interface Theme {
  id: string
  name: string
  background: string
  textColor: string
  fontFamily: string
  fontSize: number
  lineHeight: number
  columns: ColumnLayout
  isPreset: boolean
}

export interface Setting {
  key: string
  value: unknown
}

export class LeitorEpubDB extends Dexie {
  books!: EntityTable<Book, 'id'>
  progress!: EntityTable<Progress, 'bookId'>
  themes!: EntityTable<Theme, 'id'>
  settings!: EntityTable<Setting, 'key'>
  highlights!: EntityTable<Highlight, 'id'>

  constructor() {
    super('leitor-epub')

    this.version(1).stores({
      books: 'id, title, author, addedAt',
      progress: 'bookId, lastReadAt',
      themes: 'id, name, isPreset',
      settings: 'key',
    })

    this.version(2).stores({
      highlights: 'id, bookId, createdAt',
    })
  }
}

export const db = new LeitorEpubDB()
