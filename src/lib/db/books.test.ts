import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, type Book } from './schema'
import { removeLocalFile } from './books'

function synced(overrides: Partial<Book> = {}): Book {
  return {
    id: 'a',
    title: 'Dom Casmurro',
    author: 'Machado de Assis',
    coverBlob: new Blob(['capa']),
    fileBlob: new Blob(['livro']),
    addedAt: 100,
    updatedAt: 100,
    fileUpdatedAt: 100,
    blobUpdatedAt: 100,
    pendingUpload: false,
    driveFileId: 'f1',
    locations: '[]',
    ...overrides,
  }
}

beforeEach(async () => {
  await db.books.clear()
})

describe('removeLocalFile', () => {
  it('tira só o arquivo daqui: registro, capa e posições ficam, sem marcar edição nem envio', async () => {
    await db.books.add(synced())
    await removeLocalFile('a')
    const stored = await db.books.get('a')
    expect(stored).toMatchObject({
      fileBlob: null,
      coverBlob: expect.any(Blob),
      locations: '[]',
      updatedAt: 100,
      fileUpdatedAt: 100,
      pendingUpload: false,
      driveFileId: 'f1',
    })
    expect(stored).not.toHaveProperty('blobUpdatedAt')
  })

  it('recusa o livro que não está no Drive ou que ainda tem envio pendente', async () => {
    await db.books.add(synced({ id: 'sem-drive', driveFileId: undefined }))
    await db.books.add(synced({ id: 'pendente', pendingUpload: true }))
    await expect(removeLocalFile('sem-drive')).rejects.toThrow()
    await expect(removeLocalFile('pendente')).rejects.toThrow()
    expect((await db.books.get('pendente'))?.fileBlob).toEqual(expect.any(Blob))
  })
})
