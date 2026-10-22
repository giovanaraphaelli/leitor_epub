import { describe, expect, it } from 'vitest'
import {
  emptyLibraryFile,
  parseLibraryFile,
  serializeLibraryFile,
  UnsupportedLibraryFormat,
  type LibraryFile,
} from './library-file'

const library: LibraryFile = {
  formatVersion: 1,
  books: {
    b1: { title: 'Dom Casmurro', author: 'Machado', addedAt: 1, updatedAt: 2, fileUpdatedAt: 1, fileId: 'f1', coverId: null, fontScale: 1.1 },
  },
  progress: { b1: { cfi: 'epubcfi(/6/4)', percentage: 30, lastReadAt: 5 } },
  highlights: {
    h1: { bookId: 'b1', cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:5)', text: 'noite', color: '#fac73c', note: 'bonito', createdAt: 3, updatedAt: 4 },
  },
  deletions: { 'book:b2': 9 },
}

describe('biblioteca.json', () => {
  it('volta igual depois de gravado e lido', () => {
    expect(parseLibraryFile(serializeLibraryFile(library))).toEqual(library)
  })

  it('dá o mesmo texto seja qual for a ordem das chaves', () => {
    const reordered: LibraryFile = {
      deletions: library.deletions,
      highlights: library.highlights,
      progress: library.progress,
      books: { b1: { ...library.books.b1 } },
      formatVersion: 1,
    }
    expect(serializeLibraryFile(reordered)).toBe(serializeLibraryFile(library))
  })

  it('o que não é uma biblioteca dá null, para ser regravado', () => {
    expect(parseLibraryFile('isto não é json')).toBeNull()
    expect(parseLibraryFile('[1, 2]')).toBeNull()
    expect(parseLibraryFile('{"books": {}}')).toBeNull()
  })

  it('um formato mais novo não é lido nem pode ser sobrescrito', () => {
    expect(() => parseLibraryFile(JSON.stringify({ ...emptyLibraryFile(), formatVersion: 2 }))).toThrow(
      UnsupportedLibraryFormat,
    )
  })

  it('descarta só os registros estragados', () => {
    const text = JSON.stringify({
      ...library,
      books: { ...library.books, quebrado: { title: 'sem o resto' } },
      deletions: { 'book:b2': 9, 'book:b3': 'ontem' },
    })
    const parsed = parseLibraryFile(text)!
    expect(Object.keys(parsed.books)).toEqual(['b1'])
    expect(parsed.deletions).toEqual({ 'book:b2': 9 })
    expect(parsed.highlights).toEqual(library.highlights)
  })
})
