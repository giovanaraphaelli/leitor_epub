import Dexie, { type EntityTable } from 'dexie'

export interface Book {
  // The SHA-256 of the book's content (see bookIdFor): the same on every
  // device that holds the book. Books from before that carry a random uuid
  // until migrateBookIds gives them one.
  id: string
  title: string
  author: string
  coverBlob: Blob | null
  // null: the book is only on Drive ("na nuvem"); it's downloaded when opened.
  fileBlob: Blob | null
  addedAt: number
  // Multiplies the theme's font size so the book's main text lands on it;
  // measured on import (see prepareEpub). Absent on books imported before.
  fontScale?: number
  // book.locations.save() for the stored file. Not indexed, so adding these
  // needed no new database version.
  locations?: string
  // Sync bookkeeping, also not indexed. Set by an import or by migrateBookIds;
  // absent on a book only until then.
  // Last change to the title, author, cover or file.
  updatedAt?: number
  // When the EPUB's bytes last changed: the import, or an edit (which rewrites them).
  fileUpdatedAt?: number
  // Which version of the file this device holds; behind fileUpdatedAt when
  // another device edited the book since.
  blobUpdatedAt?: number
  // The file and the cover haven't gone up to Drive yet.
  pendingUpload?: boolean
  // Where the EPUB and the cover are on Drive, once uploaded (by any device).
  driveFileId?: string
  driveCoverId?: string
}

export type BookWithFile = Book & { fileBlob: Blob }

export function hasFile(book: Book): book is BookWithFile {
  return book.fileBlob !== null
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
  // When the highlight or its note last changed; starts at createdAt.
  updatedAt?: number
}

// A book or highlight removed while this device was connected to Drive, so the
// other devices can tell "removed" from "never had it". key is
// `book:<id>` or `highlight:<id>`.
export interface Deletion {
  key: string
  deletedAt: number
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
  deletions!: EntityTable<Deletion, 'key'>

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

    this.version(3).stores({
      deletions: 'key',
    })
  }
}

export const db = new LeitorEpubDB()
