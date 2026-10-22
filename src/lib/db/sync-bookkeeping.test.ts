import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type Book, type Highlight } from './schema'
import { addBook, removeBook, updateBook } from './books'
import { setDriveEnabled } from './deletions'
import { addHighlight, removeHighlight } from './highlights'

function makeBook(id: string, overrides: Partial<Book> = {}): Book {
  return { id, title: id, author: 'Autor', coverBlob: null, fileBlob: new Blob(['x']), addedAt: 100, ...overrides }
}

function makeHighlight(id: string, overrides: Partial<Highlight> = {}): Highlight {
  return { id, bookId: 'livro', cfiRange: `epubcfi(/6/${id})`, text: 'trecho', color: '#fac73c', createdAt: 10, ...overrides }
}

beforeEach(async () => {
  await Promise.all([db.books.clear(), db.progress.clear(), db.highlights.clear(), db.deletions.clear(), db.settings.clear()])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('livros: carimbos de sincronização', () => {
  it('uma importação começa com todos os carimbos na data de adição e o envio pendente', async () => {
    await addBook(makeBook('a'))
    expect(await db.books.get('a')).toMatchObject({
      updatedAt: 100,
      fileUpdatedAt: 100,
      blobUpdatedAt: 100,
      pendingUpload: true,
    })
  })

  it('editar o título, o autor ou a capa move só o carimbo de atualização', async () => {
    await addBook(makeBook('a', { pendingUpload: false }))
    vi.spyOn(Date, 'now').mockReturnValue(500)
    await updateBook('a', { title: 'Novo título' })
    expect(await db.books.get('a')).toMatchObject({
      title: 'Novo título',
      updatedAt: 500,
      fileUpdatedAt: 100,
      blobUpdatedAt: 100,
      pendingUpload: false,
    })
  })

  it('trocar o arquivo move os três carimbos e marca o envio como pendente de novo', async () => {
    await addBook(makeBook('a', { pendingUpload: false }))
    vi.spyOn(Date, 'now').mockReturnValue(700)
    await updateBook('a', { title: 'Editado', fileBlob: new Blob(['y']) })
    expect(await db.books.get('a')).toMatchObject({
      updatedAt: 700,
      fileUpdatedAt: 700,
      blobUpdatedAt: 700,
      pendingUpload: true,
    })
  })

  it('guardar o que se deriva do arquivo (posições, escala da fonte) não mexe nos carimbos', async () => {
    await addBook(makeBook('a', { pendingUpload: false }))
    vi.spyOn(Date, 'now').mockReturnValue(900)
    await updateBook('a', { locations: '["x"]', fontScale: 1.2 })
    expect(await db.books.get('a')).toMatchObject({
      locations: '["x"]',
      fontScale: 1.2,
      updatedAt: 100,
      fileUpdatedAt: 100,
      blobUpdatedAt: 100,
      pendingUpload: false,
    })
  })
})

describe('grifos: carimbo de atualização', () => {
  it('um grifo novo começa com a data de criação como atualização', async () => {
    await addHighlight(makeHighlight('g1', { createdAt: 33 }))
    expect((await db.highlights.get('g1'))?.updatedAt).toBe(33)
  })

  it('mantém a atualização que já veio preenchida', async () => {
    await addHighlight(makeHighlight('g1', { createdAt: 33, updatedAt: 80 }))
    expect((await db.highlights.get('g1'))?.updatedAt).toBe(80)
  })
})

describe('exclusões', () => {
  beforeEach(async () => {
    await addBook(makeBook('livro'))
    await db.progress.add({ bookId: 'livro', cfi: 'epubcfi(/6/2)', percentage: 10, lastReadAt: 1 })
    await addHighlight(makeHighlight('g1'))
  })

  it('remover um livro leva o progresso e os grifos, sem marca quando o Drive não está ligado', async () => {
    await removeBook('livro')
    expect(await db.books.count()).toBe(0)
    expect(await db.progress.count()).toBe(0)
    expect(await db.highlights.count()).toBe(0)
    expect(await db.deletions.count()).toBe(0)
  })

  it('com o Drive ligado, remover um livro registra a exclusão do livro', async () => {
    await setDriveEnabled(true)
    vi.spyOn(Date, 'now').mockReturnValue(1234)
    await removeBook('livro')
    expect(await db.deletions.toArray()).toEqual([{ key: 'book:livro', deletedAt: 1234 }])
    expect(await db.highlights.count()).toBe(0)
  })

  it('com o Drive ligado, remover um grifo registra a exclusão do grifo', async () => {
    await setDriveEnabled(true)
    vi.spyOn(Date, 'now').mockReturnValue(4321)
    await removeHighlight('g1')
    expect(await db.highlights.count()).toBe(0)
    expect(await db.deletions.toArray()).toEqual([{ key: 'highlight:g1', deletedAt: 4321 }])
  })

  it('sem o Drive ligado, remover um grifo não registra nada', async () => {
    await removeHighlight('g1')
    expect(await db.highlights.count()).toBe(0)
    expect(await db.deletions.count()).toBe(0)
  })

  it('desligar o Drive volta a não registrar', async () => {
    await setDriveEnabled(true)
    await setDriveEnabled(false)
    await removeHighlight('g1')
    expect(await db.deletions.count()).toBe(0)
  })
})
