import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, type Book, type Highlight } from './schema'
import { addBook, removeBook } from './books'
import { addHighlight, listHighlights, removeHighlight } from './highlights'

function makeHighlight(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: 'h1',
    bookId: 'book-a',
    cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:5)',
    text: 'noite',
    color: '#fac73c',
    createdAt: 1,
    ...overrides,
  }
}

function makeBook(id: string): Book {
  return { id, title: id, author: '', coverBlob: null, fileBlob: new Blob(['x']), addedAt: 1 }
}

describe('highlights repository', () => {
  beforeEach(async () => {
    await Promise.all([db.highlights.clear(), db.books.clear(), db.progress.clear()])
  })

  it('lista só os grifos do livro pedido, do mais antigo ao mais novo', async () => {
    await addHighlight(makeHighlight({ id: 'b', createdAt: 2 }))
    await addHighlight(makeHighlight({ id: 'a', createdAt: 1 }))
    await addHighlight(makeHighlight({ id: 'x', bookId: 'book-b' }))
    const ids = (await listHighlights('book-a')).map((h) => h.id)
    expect(ids).toEqual(['a', 'b'])
  })

  it('devolve lista vazia para um livro sem grifos', async () => {
    expect(await listHighlights('sem-grifos')).toEqual([])
  })

  it('remove pelo id e mantém os outros', async () => {
    await addHighlight(makeHighlight({ id: 'h1' }))
    await addHighlight(makeHighlight({ id: 'h2', createdAt: 2 }))
    await removeHighlight('h1')
    expect((await listHighlights('book-a')).map((h) => h.id)).toEqual(['h2'])
  })

  it('apaga os grifos junto com o livro, sem tocar nos de outro livro', async () => {
    await addBook(makeBook('book-a'))
    await addBook(makeBook('book-b'))
    await addHighlight(makeHighlight({ id: 'a1', bookId: 'book-a' }))
    await addHighlight(makeHighlight({ id: 'b1', bookId: 'book-b' }))
    await removeBook('book-a')
    expect(await listHighlights('book-a')).toEqual([])
    expect((await listHighlights('book-b')).map((h) => h.id)).toEqual(['b1'])
  })
})
