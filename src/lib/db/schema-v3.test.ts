import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { expect, it } from 'vitest'

// The database as it was before the sync work (schema version 2): whoever
// already has books must keep them, and gets the table of removals.
it('abre um banco da versão 2 sem perder nada e cria a tabela de exclusões', async () => {
  const legacy = new Dexie('leitor-epub')
  legacy.version(1).stores({
    books: 'id, title, author, addedAt',
    progress: 'bookId, lastReadAt',
    themes: 'id, name, isPreset',
    settings: 'key',
  })
  legacy.version(2).stores({
    highlights: 'id, bookId, createdAt',
  })
  await legacy.table('books').add({
    id: 'livro',
    title: 'Dom Casmurro',
    author: 'Machado',
    coverBlob: null,
    fileBlob: new Blob(['x']),
    addedAt: 1,
  })
  await legacy.table('highlights').add({
    id: 'g1',
    bookId: 'livro',
    cfiRange: 'epubcfi(/6/2)',
    text: 'noite',
    color: '#fac73c',
    createdAt: 2,
    note: 'bonito',
  })
  legacy.close()

  const { db } = await import('./schema')
  expect((await db.books.get('livro'))?.title).toBe('Dom Casmurro')
  expect((await db.highlights.get('g1'))?.note).toBe('bonito')
  await db.deletions.put({ key: 'book:livro', deletedAt: 5 })
  expect(await db.deletions.get('book:livro')).toEqual({ key: 'book:livro', deletedAt: 5 })
  db.close()
})
