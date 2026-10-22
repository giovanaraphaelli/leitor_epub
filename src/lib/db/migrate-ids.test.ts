import 'fake-indexeddb/auto'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bookIdFor } from '@/lib/epub/book-id'
import { db, type Book, type Highlight } from './schema'
import { hasLegacyBooks, migrateBookIds } from './migrate-ids'

async function epub(text: string): Promise<Blob> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('OEBPS/cap1.xhtml', `<p>${text}</p>`)
  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' })
}

const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())

function makeBook(id: string, fileBlob: Blob, overrides: Partial<Book> = {}): Book {
  return { id, title: `Livro ${id.slice(0, 4)}`, author: 'Autor', coverBlob: null, fileBlob, addedAt: 100, ...overrides }
}

function makeHighlight(id: string, bookId: string, overrides: Partial<Highlight> = {}): Highlight {
  return { id, bookId, cfiRange: `passagem-${id}`, text: 'trecho', color: '#fac73c', createdAt: 10, ...overrides }
}

const OLD_A = '3f2b8c1e-5d4a-4b7e-9c10-2a6f8e1d7b30'
const OLD_A2 = '8a1c4d2e-0b3f-4c6a-8d51-7e9f2b6c1a04'
const OLD_B = 'c7d9e0f1-2a3b-4c5d-8e6f-a1b2c3d4e5f6'

beforeEach(async () => {
  await Promise.all([db.books.clear(), db.progress.clear(), db.highlights.clear()])
})

describe('migrateBookIds', () => {
  it('troca o id aleatório pelo do conteúdo e leva o progresso e os grifos junto', async () => {
    const file = await epub('um')
    const cover = new Blob(['capa'], { type: 'image/png' })
    const id = await bookIdFor(file)
    await db.books.add(makeBook(OLD_A, file, { coverBlob: cover, fontScale: 1.1, locations: '["a"]' }))
    await db.progress.add({ bookId: OLD_A, cfi: 'epubcfi(/6/2)', percentage: 40, lastReadAt: 900 })
    await db.highlights.add(makeHighlight('g1', OLD_A))

    const result = await migrateBookIds()

    expect(result).toEqual({ migrated: 1, merged: 0, failed: 0 })
    expect(await db.books.toCollection().primaryKeys()).toEqual([id])
    const book = (await db.books.get(id))!
    expect(book).toMatchObject({
      title: 'Livro 3f2b',
      fontScale: 1.1,
      locations: '["a"]',
      addedAt: 100,
      updatedAt: 100,
      fileUpdatedAt: 100,
      blobUpdatedAt: 100,
      pendingUpload: true,
    })
    expect(await bytes(book.fileBlob!)).toEqual(await bytes(file))
    expect(book.fileBlob!.type).toBe('application/epub+zip')
    expect(await book.coverBlob?.text()).toBe('capa')
    expect(await db.progress.get(id)).toMatchObject({ cfi: 'epubcfi(/6/2)', percentage: 40, lastReadAt: 900 })
    expect(await db.progress.get(OLD_A)).toBeUndefined()
    expect((await db.highlights.get('g1'))?.bookId).toBe(id)
  })

  it('não mexe em quem já tem o id do conteúdo e, rodando de novo, não faz nada', async () => {
    const file = await epub('um')
    await db.books.add(makeBook(await bookIdFor(file), file))
    expect(await hasLegacyBooks()).toBe(false)
    expect(await migrateBookIds()).toEqual({ migrated: 0, merged: 0, failed: 0 })

    await db.books.add(makeBook(OLD_A, await epub('dois')))
    expect(await hasLegacyBooks()).toBe(true)
    await migrateBookIds()
    const keys = await db.books.toCollection().primaryKeys()

    expect(await hasLegacyBooks()).toBe(false)
    expect(await migrateBookIds()).toEqual({ migrated: 0, merged: 0, failed: 0 })
    expect(await db.books.toCollection().primaryKeys()).toEqual(keys)
  })

  it('junta dois livros de mesmo conteúdo: a adição mais antiga, o progresso mais recente e os grifos sem repetir passagem', async () => {
    const id = await bookIdFor(await epub('um'))
    await db.books.add(makeBook(OLD_A, await epub('um'), { addedAt: 300 }))
    await db.books.add(makeBook(OLD_A2, await epub('um'), { addedAt: 200, fontScale: 0.9 }))
    await db.progress.add({ bookId: OLD_A, cfi: 'cfi-a', percentage: 10, lastReadAt: 500 })
    await db.progress.add({ bookId: OLD_A2, cfi: 'cfi-a2', percentage: 30, lastReadAt: 800 })
    await db.highlights.bulkAdd([
      makeHighlight('h1', OLD_A, { cfiRange: 'passagem-1', createdAt: 10 }),
      makeHighlight('h2', OLD_A2, { cfiRange: 'passagem-1', createdAt: 20, note: 'nota nova', updatedAt: 25 }),
      makeHighlight('h3', OLD_A2, { cfiRange: 'passagem-2', createdAt: 30 }),
    ])

    const result = await migrateBookIds()

    expect(result).toEqual({ migrated: 1, merged: 1, failed: 0 })
    expect(await db.books.count()).toBe(1)
    expect(await db.books.get(id)).toMatchObject({ addedAt: 200, fontScale: 0.9 })
    expect(await db.progress.count()).toBe(1)
    expect(await db.progress.get(id)).toMatchObject({ cfi: 'cfi-a2', lastReadAt: 800 })
    const highlights = await db.highlights.where('bookId').equals(id).toArray()
    expect(highlights.map((highlight) => highlight.id).sort()).toEqual(['h2', 'h3'])
    expect(await db.highlights.count()).toBe(2)
  })

  it('segue com os outros quando o arquivo de um livro não dá para ler', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const good = await epub('bom')
    await db.books.add(makeBook(OLD_A, new Blob(['isto não é um zip'])))
    await db.books.add(makeBook(OLD_B, good))

    const result = await migrateBookIds()

    expect(result).toEqual({ migrated: 1, merged: 0, failed: 1 })
    expect(await db.books.get(OLD_A)).toBeDefined()
    expect(await db.books.get(await bookIdFor(good))).toBeDefined()
    expect(await hasLegacyBooks()).toBe(true)
  })

  it('avisa o andamento', async () => {
    await db.books.add(makeBook(OLD_A, await epub('um')))
    await db.books.add(makeBook(OLD_B, await epub('dois')))
    const seen: Array<[number, number]> = []

    await migrateBookIds(({ done, total }) => seen.push([done, total]))

    expect(seen).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ])
  })
})
