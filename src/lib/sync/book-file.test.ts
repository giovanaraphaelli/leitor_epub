import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type Book } from '@/lib/db/schema'
import type { DriveApi } from '@/lib/drive/api'
import { BookNotHereError, downloadBookBlob, ensureBookFile, needsDownload } from './book-file'

// The real one, wrapped, so a test can make keeping the file fail.
const { saveDownloadedFile } = vi.hoisted(() => ({ saveDownloadedFile: vi.fn() }))
vi.mock('@/lib/db/sync', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db/sync')>()
  saveDownloadedFile.mockImplementation(original.saveDownloadedFile)
  return { ...original, saveDownloadedFile }
})

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'livro',
    title: 'Livro',
    author: 'Autor',
    coverBlob: null,
    fileBlob: null,
    addedAt: 100,
    updatedAt: 100,
    fileUpdatedAt: 100,
    driveFileId: 'f1',
    ...overrides,
  }
}

function driveWith(download: DriveApi['downloadBlob']): DriveApi {
  return { downloadBlob: vi.fn(download) } as unknown as DriveApi
}

beforeEach(async () => {
  await db.books.clear()
})

describe('ensureBookFile', () => {
  it('usa o arquivo daqui quando ele é a versão do registro', async () => {
    const file = new Blob(['daqui'])
    const drive = driveWith(async () => new Blob(['de lá']))
    const book = makeBook({ fileBlob: file, blobUpdatedAt: 100 })
    expect(needsDownload(book)).toBe(false)
    expect(await ensureBookFile(book, drive)).toBe(file)
    expect(drive.downloadBlob).not.toHaveBeenCalled()
  })

  it('baixa o livro que está só na nuvem e guarda o arquivo como a versão do registro', async () => {
    const book = makeBook({ fileUpdatedAt: 300 })
    await db.books.add(book)
    const file = await ensureBookFile(book, driveWith(async () => new Blob(['conteúdo'])))
    expect(await file.text()).toBe('conteúdo')
    expect(file.type).toBe('application/epub+zip')
    const stored = await db.books.get('livro')
    expect(await stored?.fileBlob?.text()).toBe('conteúdo')
    expect(stored?.blobUpdatedAt).toBe(300)
  })

  it('baixa de novo o livro editado em outro aparelho, e abre o antigo se não conseguir', async () => {
    const old = new Blob(['versão antiga'])
    const book = makeBook({ fileBlob: old, blobUpdatedAt: 100, fileUpdatedAt: 300 })
    expect(needsDownload(book)).toBe(true)
    expect(await ensureBookFile(book, driveWith(async () => Promise.reject(new TypeError('Failed to fetch'))))).toBe(old)
  })

  it('abre o livro baixado mesmo quando não dá para guardá-lo aqui', async () => {
    saveDownloadedFile.mockRejectedValueOnce(new DOMException('sem espaço', 'QuotaExceededError'))
    const file = await ensureBookFile(makeBook(), driveWith(async () => new Blob(['conteúdo'])))
    expect(await file.text()).toBe('conteúdo')
  })

  it('sem o arquivo e sem conexão, avisa que o livro não está aqui', async () => {
    await expect(ensureBookFile(makeBook(), driveWith(async () => Promise.reject(new TypeError('offline'))))).rejects.toThrow(
      BookNotHereError,
    )
  })
})

describe('downloadBookBlob', () => {
  it('devolve o arquivo do Drive e lança erro quando não consegue baixar', async () => {
    const drive = driveWith(async () => new Blob(['do drive']))
    expect(await (await downloadBookBlob(makeBook(), drive)).text()).toBe('do drive')

    const offline = driveWith(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(downloadBookBlob(makeBook(), offline)).rejects.toThrow('Failed to fetch')
    await expect(downloadBookBlob(makeBook({ driveFileId: undefined }), drive)).rejects.toBeInstanceOf(BookNotHereError)
  })
})
