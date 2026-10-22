import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Book } from '@/lib/db/schema'

const { downloadBookBlob, saveDownloadedFile, toast } = vi.hoisted(() => ({
  downloadBookBlob: vi.fn(),
  saveDownloadedFile: vi.fn(),
  toast: { error: vi.fn() },
}))
vi.mock('@/lib/sync/book-file', () => ({ downloadBookBlob }))
vi.mock('@/lib/db/sync', () => ({ saveDownloadedFile }))
vi.mock('sonner', () => ({ toast }))

// A fresh module per test: the store keeps its state at module level.
let store: typeof import('./download-store')

const book: Book = {
  id: 'livro-1',
  title: 'Duna',
  author: 'Frank Herbert',
  coverBlob: null,
  fileBlob: null,
  addedAt: 100,
  fileUpdatedAt: 300,
  driveFileId: 'f1',
}

beforeEach(async () => {
  vi.resetModules()
  downloadBookBlob.mockReset()
  saveDownloadedFile.mockReset()
  toast.error.mockReset()
  store = await import('./download-store')
})

describe('useDownloadStore', () => {
  it('baixa, guarda com a versão do registro e avisa a biblioteca', async () => {
    const file = new Blob(['epub'])
    let finish!: (blob: Blob) => void
    downloadBookBlob.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    saveDownloadedFile.mockResolvedValueOnce(undefined)

    const done = store.useDownloadStore.getState().download(book)
    expect(store.useDownloadStore.getState().downloading).toEqual(['livro-1'])
    finish(file)
    await done

    expect(saveDownloadedFile).toHaveBeenCalledWith('livro-1', file, 300)
    expect(store.useDownloadStore.getState()).toMatchObject({ downloading: [], revision: 1 })
  })

  it('uma falha no download ou ao guardar deixa o livro na nuvem e diz o motivo', async () => {
    downloadBookBlob.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await store.useDownloadStore.getState().download(book)
    expect(toast.error).toHaveBeenLastCalledWith('Não foi possível baixar "Duna"', {
      description: 'Sem conexão com a internet.',
    })

    downloadBookBlob.mockResolvedValueOnce(new Blob(['epub']))
    saveDownloadedFile.mockRejectedValueOnce(Object.assign(new Error('sem espaço'), { name: 'QuotaExceededError' }))
    await store.useDownloadStore.getState().download(book)
    expect(toast.error).toHaveBeenLastCalledWith('Não foi possível baixar "Duna"', {
      description: 'Sem espaço no aparelho.',
    })
    expect(store.useDownloadStore.getState()).toMatchObject({ downloading: [], revision: 0 })
  })

  it('um segundo toque no mesmo livro enquanto ele baixa não baixa de novo', async () => {
    downloadBookBlob.mockImplementationOnce(() => new Promise(() => {}))
    void store.useDownloadStore.getState().download(book)
    await store.useDownloadStore.getState().download(book)
    expect(downloadBookBlob).toHaveBeenCalledOnce()
  })
})
