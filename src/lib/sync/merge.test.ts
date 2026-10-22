import { describe, expect, it } from 'vitest'
import type { Highlight, Progress } from '@/lib/db/schema'
import { emptyLibraryFile, serializeLibraryFile, type LibraryFile, type RemoteBook } from './library-file'
import { mergeLibrary, type LocalBook, type LocalLibrary } from './merge'

function localBook(id: string, overrides: Partial<LocalBook> = {}): LocalBook {
  return {
    id,
    title: `Livro ${id}`,
    author: 'Autor',
    addedAt: 1,
    updatedAt: 1,
    fileUpdatedAt: 1,
    driveFileId: `file-${id}`,
    driveCoverId: null,
    pendingUpload: false,
    ...overrides,
  }
}

function remoteBook(id: string, overrides: Partial<RemoteBook> = {}): RemoteBook {
  return { title: `Livro ${id}`, author: 'Autor', addedAt: 1, updatedAt: 1, fileUpdatedAt: 1, fileId: `file-${id}`, coverId: null, ...overrides }
}

function highlight(id: string, bookId: string, overrides: Partial<Highlight> = {}): Highlight {
  return { id, bookId, cfiRange: `passagem-${id}`, text: 'trecho', color: '#fac73c', createdAt: 2, updatedAt: 2, ...overrides }
}

function progress(bookId: string, lastReadAt: number, percentage = 10): Progress {
  return { bookId, cfi: `cfi-${lastReadAt}`, percentage, lastReadAt }
}

function local(overrides: Partial<LocalLibrary> = {}): LocalLibrary {
  return { books: [], progress: [], highlights: [], deletions: [], ...overrides }
}

function remote(overrides: Partial<LibraryFile> = {}): LibraryFile {
  return { ...emptyLibraryFile(), ...overrides }
}

describe('mergeLibrary', () => {
  it('um livro novo do outro lado entra aqui; um daqui ainda não enviado fica fora do arquivo', () => {
    const { file, changes } = mergeLibrary(
      local({ books: [localBook('a', { driveFileId: null, pendingUpload: true })], progress: [progress('a', 3)] }),
      remote({ books: { b: remoteBook('b') } }),
    )
    expect(Object.keys(file.books)).toEqual(['b'])
    expect(file.progress).toEqual({})
    expect(changes.books).toEqual([{ id: 'b', book: remoteBook('b'), expected: null }])
    expect(changes.removedBooks).toEqual([])
  })

  it('um livro daqui que já está no Drive entra no arquivo com o progresso e os grifos', () => {
    const { file, changes } = mergeLibrary(
      local({ books: [localBook('a')], progress: [progress('a', 3)], highlights: [highlight('h1', 'a', { note: 'nota' })] }),
      null,
    )
    expect(file.books.a).toEqual(remoteBook('a'))
    expect(file.progress.a).toEqual({ cfi: 'cfi-3', percentage: 10, lastReadAt: 3 })
    expect(file.highlights.h1).toMatchObject({ bookId: 'a', note: 'nota', updatedAt: 2 })
    expect(changes).toEqual({ books: [], removedBooks: [], progress: [], highlights: [], removedHighlights: [], deletions: [] })
  })

  it('vence o updatedAt maior, e no empate fica o remoto', () => {
    const newer = mergeLibrary(
      local({ books: [localBook('a', { title: 'Daqui', updatedAt: 5 })] }),
      remote({ books: { a: remoteBook('a', { title: 'De lá', updatedAt: 9 }) } }),
    )
    expect(newer.file.books.a.title).toBe('De lá')
    expect(newer.changes.books).toEqual([{ id: 'a', book: remoteBook('a', { title: 'De lá', updatedAt: 9 }), expected: 5 }])

    const older = mergeLibrary(
      local({ books: [localBook('a', { title: 'Daqui', updatedAt: 9 })] }),
      remote({ books: { a: remoteBook('a', { title: 'De lá', updatedAt: 5 }) } }),
    )
    expect(older.file.books.a.title).toBe('Daqui')
    expect(older.changes.books).toEqual([])

    const tie = mergeLibrary(
      local({ books: [localBook('a', { title: 'Daqui', updatedAt: 7 })] }),
      remote({ books: { a: remoteBook('a', { title: 'De lá', updatedAt: 7 }) } }),
    )
    expect(tie.file.books.a.title).toBe('De lá')
    expect(tie.changes.books).toHaveLength(1)
  })

  it('editado aqui e ainda não enviado: o arquivo fica com a versão anterior', () => {
    const { file, changes } = mergeLibrary(
      local({ books: [localBook('a', { title: 'Novo título', updatedAt: 10, pendingUpload: true })] }),
      remote({ books: { a: remoteBook('a', { title: 'Título antigo', updatedAt: 5 }) } }),
    )
    expect(file.books.a.title).toBe('Título antigo')
    expect(changes.books).toEqual([])
  })

  it('o registro remoto mais novo vence também um envio pendente daqui', () => {
    const { changes } = mergeLibrary(
      local({ books: [localBook('a', { updatedAt: 5, pendingUpload: true })] }),
      remote({ books: { a: remoteBook('a', { title: 'Editado lá', updatedAt: 9 }) } }),
    )
    expect(changes.books).toEqual([{ id: 'a', book: remoteBook('a', { title: 'Editado lá', updatedAt: 9 }), expected: 5 }])
  })

  it('a exclusão vence o livro que não é mais novo do que ela, e leva o progresso e os grifos', () => {
    const { file, changes } = mergeLibrary(
      local({ books: [localBook('a', { updatedAt: 8 })], progress: [progress('a', 9)], highlights: [highlight('h1', 'a')] }),
      remote({ books: { a: remoteBook('a', { updatedAt: 8 }) }, deletions: { 'book:a': 10 } }),
    )
    expect(file.books).toEqual({})
    expect(file.progress).toEqual({})
    expect(file.highlights).toEqual({})
    expect(file.deletions).toEqual({ 'book:a': 10 })
    expect(changes.removedBooks).toEqual([{ id: 'a', expected: 8 }])
    expect(changes.removedHighlights).toEqual([{ id: 'h1', expected: 2 }])
    expect(changes.deletions).toEqual([{ key: 'book:a', deletedAt: 10 }])
  })

  it('um livro importado de novo depois da exclusão volta', () => {
    const { file, changes } = mergeLibrary(
      local({ books: [localBook('a', { updatedAt: 12 })] }),
      remote({ deletions: { 'book:a': 10 } }),
    )
    expect(file.books.a).toBeDefined()
    expect(changes.removedBooks).toEqual([])
  })

  it('progresso: vence o lastReadAt maior', () => {
    const books = { a: remoteBook('a') }
    const theirsNewer = mergeLibrary(
      local({ books: [localBook('a')], progress: [progress('a', 5, 10)] }),
      remote({ books, progress: { a: { cfi: 'cfi-9', percentage: 40, lastReadAt: 9 } } }),
    )
    expect(theirsNewer.changes.progress).toEqual([
      { bookId: 'a', progress: { cfi: 'cfi-9', percentage: 40, lastReadAt: 9 }, expected: 5 },
    ])
    const mineNewer = mergeLibrary(
      local({ books: [localBook('a')], progress: [progress('a', 9, 40)] }),
      remote({ books, progress: { a: { cfi: 'cfi-5', percentage: 10, lastReadAt: 5 } } }),
    )
    expect(mineNewer.file.progress.a).toEqual({ cfi: 'cfi-9', percentage: 40, lastReadAt: 9 })
    expect(mineNewer.changes.progress).toEqual([])
  })

  it('grifo: vence o updatedAt maior, e a exclusão vence o grifo que não é mais novo', () => {
    const books = { a: remoteBook('a') }
    const edited = mergeLibrary(
      local({ books: [localBook('a')], highlights: [highlight('h1', 'a', { updatedAt: 4 })] }),
      remote({ books, highlights: { h1: { ...toRemote(highlight('h1', 'a')), note: 'nota de lá', updatedAt: 9 } } }),
    )
    expect(edited.changes.highlights).toEqual([
      { id: 'h1', highlight: { ...toRemote(highlight('h1', 'a')), note: 'nota de lá', updatedAt: 9 }, expected: 4 },
    ])

    const removedHere = mergeLibrary(
      local({ books: [localBook('a')], deletions: [{ key: 'highlight:h1', deletedAt: 10 }] }),
      remote({ books, highlights: { h1: { ...toRemote(highlight('h1', 'a')), updatedAt: 9 } } }),
    )
    expect(removedHere.file.highlights).toEqual({})
    expect(removedHere.file.deletions).toEqual({ 'highlight:h1': 10 })
    expect(removedHere.changes.highlights).toEqual([])
  })

  it('exclusões: une as duas listas com a data maior e só traz para cá as que faltam', () => {
    const { file, changes } = mergeLibrary(
      local({ deletions: [{ key: 'book:x', deletedAt: 5 }, { key: 'highlight:y', deletedAt: 7 }] }),
      remote({ deletions: { 'book:x': 9, 'book:z': 3 } }),
    )
    expect(file.deletions).toEqual({ 'book:x': 9, 'highlight:y': 7, 'book:z': 3 })
    expect(changes.deletions).toEqual([
      { key: 'book:x', deletedAt: 9 },
      { key: 'book:z', deletedAt: 3 },
    ])
  })

  it('o fontScale que só este aparelho mediu vai para o arquivo, e a junção não acusa mudança por isso', () => {
    const { file, changes } = mergeLibrary(
      local({ books: [localBook('a', { updatedAt: 9, fontScale: 1.2 })] }),
      remote({ books: { a: remoteBook('a', { updatedAt: 9 }) } }),
    )
    expect(file.books.a.fontScale).toBe(1.2)
    expect(changes.books).toEqual([])
  })

  it('nada muda quando os dois lados já são iguais', () => {
    const mine = local({
      books: [localBook('a', { fontScale: 1.2 })],
      progress: [progress('a', 3)],
      highlights: [highlight('h1', 'a')],
      deletions: [{ key: 'book:z', deletedAt: 1 }],
    })
    const { file } = mergeLibrary(mine, null)
    const again = mergeLibrary(mine, file)
    expect(serializeLibraryFile(again.file)).toBe(serializeLibraryFile(file))
    expect(again.changes).toEqual({ books: [], removedBooks: [], progress: [], highlights: [], removedHighlights: [], deletions: [] })
  })
})

function toRemote(source: Highlight) {
  return {
    bookId: source.bookId,
    cfiRange: source.cfiRange,
    text: source.text,
    color: source.color,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt ?? source.createdAt,
  }
}
