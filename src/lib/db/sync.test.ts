import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { LocalChanges } from '@/lib/sync/merge'
import type { RemoteBook } from '@/lib/sync/library-file'
import { db, type Book } from './schema'
import {
  applyRemoteChanges,
  listBooksMissingCover,
  listBooksToUpload,
  markBookUploaded,
  readLocalLibrary,
} from './sync'

function makeBook(id: string, overrides: Partial<Book> = {}): Book {
  return { id, title: id, author: 'Autor', coverBlob: null, fileBlob: new Blob(['x']), addedAt: 100, ...overrides }
}

function remoteBook(overrides: Partial<RemoteBook> = {}): RemoteBook {
  return { title: 'De lá', author: 'Autora', addedAt: 50, updatedAt: 300, fileUpdatedAt: 300, fileId: 'f1', coverId: 'c1', ...overrides }
}

function changes(overrides: Partial<LocalChanges>): LocalChanges {
  return { books: [], removedBooks: [], progress: [], highlights: [], removedHighlights: [], deletions: [], ...overrides }
}

beforeEach(async () => {
  await Promise.all([db.books.clear(), db.progress.clear(), db.highlights.clear(), db.deletions.clear()])
})

describe('readLocalLibrary', () => {
  it('lê os livros com os carimbos e as referências do Drive preenchidos', async () => {
    await db.books.add(makeBook('a'))
    await db.books.add(makeBook('b', { updatedAt: 200, fileUpdatedAt: 150, pendingUpload: false, driveFileId: 'fb', driveCoverId: 'cb' }))
    const library = await readLocalLibrary()
    expect(library.books).toEqual([
      expect.objectContaining({ id: 'a', updatedAt: 100, fileUpdatedAt: 100, driveFileId: null, driveCoverId: null, pendingUpload: true }),
      expect.objectContaining({ id: 'b', updatedAt: 200, fileUpdatedAt: 150, driveFileId: 'fb', driveCoverId: 'cb', pendingUpload: false }),
    ])
  })
})

describe('applyRemoteChanges', () => {
  it('um livro novo de outro aparelho entra sem arquivo, com as referências do Drive', async () => {
    const applied = await applyRemoteChanges(changes({ books: [{ id: 'a', book: remoteBook({ fontScale: 1.2 }), expected: null }] }))
    expect(applied).toEqual({ booksAdded: 1, booksRemoved: 0, other: 0 })
    expect(await db.books.get('a')).toMatchObject({
      title: 'De lá',
      fileBlob: null,
      coverBlob: null,
      pendingUpload: false,
      driveFileId: 'f1',
      driveCoverId: 'c1',
      fontScale: 1.2,
      updatedAt: 300,
    })
  })

  it('não mexe num livro que mudou depois de a junção o ler', async () => {
    await db.books.add(makeBook('a', { title: 'Editado agora', updatedAt: 250 }))
    const applied = await applyRemoteChanges(changes({ books: [{ id: 'a', book: remoteBook(), expected: 200 }] }))
    expect(applied).toEqual({ booksAdded: 0, booksRemoved: 0, other: 0 })
    expect((await db.books.get('a'))?.title).toBe('Editado agora')
  })

  it('o registro de lá que vence um envio pendente cancela o envio, e o arquivo e a capa são baixados de novo', async () => {
    await db.books.add(makeBook('a', { updatedAt: 200, pendingUpload: true, blobUpdatedAt: 200, coverBlob: new Blob(['capa']) }))
    await applyRemoteChanges(changes({ books: [{ id: 'a', book: remoteBook(), expected: 200 }] }))
    expect(await db.books.get('a')).toMatchObject({ title: 'De lá', pendingUpload: false, blobUpdatedAt: 0, coverBlob: null })
    expect((await db.books.get('a'))?.fileBlob).not.toBeNull()
  })

  it('o mesmo livro sem edição nos dois lados conta como a versão do registro e não é baixado de novo', async () => {
    await db.books.add(makeBook('a', { addedAt: 100, updatedAt: 100, fileUpdatedAt: 100, blobUpdatedAt: 100, pendingUpload: true }))
    await applyRemoteChanges(
      changes({ books: [{ id: 'a', book: remoteBook({ addedAt: 300, updatedAt: 300, fileUpdatedAt: 300 }), expected: 100 }] }),
    )
    expect(await db.books.get('a')).toMatchObject({ pendingUpload: false, fileUpdatedAt: 300, blobUpdatedAt: 300 })
  })

  it('remove o livro excluído em outro aparelho, com o progresso e os grifos', async () => {
    await db.books.add(makeBook('a', { updatedAt: 200 }))
    await db.progress.add({ bookId: 'a', cfi: null, percentage: 10, lastReadAt: 1 })
    await db.highlights.add({ id: 'h1', bookId: 'a', cfiRange: 'c', text: 't', color: '#fac73c', createdAt: 1 })
    const applied = await applyRemoteChanges(
      changes({ removedBooks: [{ id: 'a', expected: 200 }], deletions: [{ key: 'book:a', deletedAt: 300 }] }),
    )
    expect(applied).toEqual({ booksAdded: 0, booksRemoved: 1, other: 0 })
    expect(await db.books.count()).toBe(0)
    expect(await db.progress.count()).toBe(0)
    expect(await db.highlights.count()).toBe(0)
    expect(await db.deletions.get('book:a')).toEqual({ key: 'book:a', deletedAt: 300 })
  })

  it('grava progresso e grifos só se ainda forem os que a junção viu, e só de livros que existem', async () => {
    await db.books.add(makeBook('a'))
    await db.progress.add({ bookId: 'a', cfi: 'antigo', percentage: 10, lastReadAt: 5 })
    const applied = await applyRemoteChanges(
      changes({
        progress: [
          { bookId: 'a', progress: { cfi: 'novo', percentage: 40, lastReadAt: 9 }, expected: 5 },
          { bookId: 'sumido', progress: { cfi: 'x', percentage: 1, lastReadAt: 9 }, expected: null },
        ],
        highlights: [
          { id: 'h1', highlight: { bookId: 'a', cfiRange: 'c', text: 't', color: '#fac73c', note: 'nota', createdAt: 1, updatedAt: 9 }, expected: null },
          { id: 'h2', highlight: { bookId: 'a', cfiRange: 'd', text: 't', color: '#fac73c', createdAt: 1, updatedAt: 9 }, expected: 4 },
        ],
      }),
    )
    expect(applied).toEqual({ booksAdded: 0, booksRemoved: 0, other: 2 })
    expect(await db.progress.get('a')).toMatchObject({ cfi: 'novo', lastReadAt: 9 })
    expect(await db.progress.get('sumido')).toBeUndefined()
    expect(await db.highlights.get('h1')).toMatchObject({ note: 'nota', updatedAt: 9 })
    expect(await db.highlights.get('h2')).toBeUndefined()
  })

  it('guarda a exclusão mais recente de cada chave', async () => {
    await db.deletions.put({ key: 'book:x', deletedAt: 10 })
    await applyRemoteChanges(changes({ deletions: [{ key: 'book:x', deletedAt: 5 }, { key: 'highlight:y', deletedAt: 7 }] }))
    expect(await db.deletions.toArray()).toEqual([
      { key: 'book:x', deletedAt: 10 },
      { key: 'highlight:y', deletedAt: 7 },
    ])
  })
})

describe('envios', () => {
  it('lista para envio só os livros pendentes que têm o arquivo aqui', async () => {
    await db.books.add(makeBook('a', { pendingUpload: true }))
    await db.books.add(makeBook('b', { pendingUpload: false }))
    await db.books.add(makeBook('c', { pendingUpload: true, fileBlob: null }))
    expect((await listBooksToUpload()).map((book) => book.id)).toEqual(['a'])
  })

  it('o livro deixa de estar pendente só se não mudou durante o envio; as referências ficam de todo jeito', async () => {
    await db.books.add(makeBook('a', { updatedAt: 100, fileUpdatedAt: 100, pendingUpload: true }))
    expect(await markBookUploaded('a', { driveFileId: 'f', driveCoverId: 'c' }, { updatedAt: 100, fileUpdatedAt: 100 })).toBe(true)
    expect(await db.books.get('a')).toMatchObject({ pendingUpload: false, driveFileId: 'f', driveCoverId: 'c' })

    await db.books.update('a', { pendingUpload: true, updatedAt: 120 })
    expect(await markBookUploaded('a', { driveFileId: 'f', driveCoverId: null }, { updatedAt: 100, fileUpdatedAt: 100 })).toBe(false)
    expect(await db.books.get('a')).toMatchObject({ pendingUpload: true, driveFileId: 'f' })
    expect((await db.books.get('a'))?.driveCoverId).toBeUndefined()
  })

  it('lista as capas que estão no Drive e faltam aqui', async () => {
    await db.books.add(makeBook('a', { driveCoverId: 'c1' }))
    await db.books.add(makeBook('b', { driveCoverId: 'c2', coverBlob: new Blob(['capa']) }))
    await db.books.add(makeBook('c'))
    expect(await listBooksMissingCover()).toEqual([{ id: 'a', driveCoverId: 'c1' }])
  })
})
