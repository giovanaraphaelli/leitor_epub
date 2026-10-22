import 'fake-indexeddb/auto'
import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb'
import Dexie from 'dexie'
import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
import { SIMPLE_UPLOAD_LIMIT } from '@/lib/drive/api'
import { bookIdFor } from '@/lib/epub/book-id'
import { FakeDrive } from './fake-drive'

const EPUB = 'application/epub+zip'

// Each "device" has its own database and its own copy of the modules (the
// sync keeps state at module level); all of them sync through one fake Drive.
async function device() {
  vi.resetModules()
  const factory = new FakeIDBFactory() as unknown as IDBFactory
  Dexie.dependencies.indexedDB = factory
  globalThis.indexedDB = factory
  const deletions = await import('@/lib/db/deletions')
  await deletions.setDriveEnabled(true)
  return {
    books: await import('@/lib/db/books'),
    progress: await import('@/lib/db/progress'),
    highlights: await import('@/lib/db/highlights'),
    sync: await import('./run'),
    bookFile: await import('./book-file'),
    local: await import('@/lib/db/sync'),
  }
}

async function epub(text: string): Promise<Blob> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('OEBPS/cap1.xhtml', `<p>${text}</p>`)
  return zip.generateAsync({ type: 'blob', mimeType: EPUB })
}

const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())
const epubFiles = (drive: FakeDrive) => [...drive.files.values()].filter((file) => file.mimeType === EPUB)

describe('sincronização entre dois aparelhos', () => {
  it('o livro importado no celular aparece no PC, abre lá, e o progresso de lá volta ao celular', async () => {
    const drive = new FakeDrive()
    const phone = await device()
    const file = await epub('Capítulo um')
    const id = await bookIdFor(file)
    await phone.books.addBook({
      id,
      title: 'Dom Casmurro',
      author: 'Machado de Assis',
      coverBlob: new Blob(['capa'], { type: 'image/png' }),
      fileBlob: file,
      addedAt: 100,
      fontScale: 1.1,
    })
    await phone.progress.saveProgress({ bookId: id, cfi: 'epubcfi(/6/4)', percentage: 12, lastReadAt: 150 })

    expect(await phone.sync.syncNow(drive)).toMatchObject({ uploaded: 1 })
    expect(await phone.books.getBook(id)).toMatchObject({ pendingUpload: false })
    expect(epubFiles(drive)).toEqual([
      expect.objectContaining({ name: 'Dom Casmurro - Machado de Assis.epub', appProperties: { bookId: id } }),
    ])
    expect(await drive.library()).toMatchObject({
      books: { [id]: { title: 'Dom Casmurro', fontScale: 1.1 } },
      progress: { [id]: { percentage: 12 } },
    })

    const pc = await device()
    const uploadsBefore = drive.uploads
    const onApplied = vi.fn()
    expect(await pc.sync.syncNow(drive, onApplied)).toMatchObject({ uploaded: 0, covers: 1 })
    expect(onApplied).toHaveBeenCalledOnce()
    expect(drive.uploads).toBe(uploadsBefore)
    const cloud = (await pc.books.getBook(id))!
    expect(cloud).toMatchObject({ title: 'Dom Casmurro', fileBlob: null, pendingUpload: false, fontScale: 1.1 })
    expect(await cloud.coverBlob?.text()).toBe('capa')
    expect(await pc.progress.getProgress(id)).toMatchObject({ cfi: 'epubcfi(/6/4)', percentage: 12 })

    const opened = await pc.bookFile.ensureBookFile(cloud, drive)
    expect(await bytes(opened)).toEqual(await bytes(file))
    await pc.progress.saveProgress({ bookId: id, cfi: 'epubcfi(/6/8)', percentage: 40, lastReadAt: 500 })
    await pc.sync.syncNow(drive)

    await phone.sync.syncNow(drive)
    expect(await phone.progress.getProgress(id)).toMatchObject({ cfi: 'epubcfi(/6/8)', percentage: 40 })
    expect(epubFiles(drive)).toHaveLength(1)
  })

  it('grifos e notas vão e voltam, e o que foi removido num aparelho sai do outro', async () => {
    const drive = new FakeDrive()
    const phone = await device()
    const file = await epub('Capítulo dois')
    const id = await bookIdFor(file)
    await phone.books.addBook({ id, title: 'Memórias', author: 'Machado', coverBlob: null, fileBlob: file, addedAt: 100 })
    await phone.highlights.addHighlight({
      id: 'h1',
      bookId: id,
      cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:5)',
      text: 'Ao verme',
      color: '#fac73c',
      createdAt: 200,
    })
    await phone.sync.syncNow(drive)

    const pc = await device()
    await pc.sync.syncNow(drive)
    expect(await pc.highlights.listHighlights(id)).toEqual([expect.objectContaining({ id: 'h1', text: 'Ao verme' })])
    await pc.highlights.setHighlightNote('h1', 'a dedicatória')
    await pc.sync.syncNow(drive)
    await phone.sync.syncNow(drive)
    expect((await phone.highlights.listHighlights(id))[0].note).toBe('a dedicatória')

    await phone.highlights.removeHighlight('h1')
    await phone.sync.syncNow(drive)
    await pc.sync.syncNow(drive)
    expect(await pc.highlights.listHighlights(id)).toEqual([])

    await pc.books.removeBook(id)
    await pc.sync.syncNow(drive)
    await phone.sync.syncNow(drive)
    expect(await phone.books.getBook(id)).toBeUndefined()
  })

  it('uma edição vence, sobe, e o outro aparelho baixa o arquivo novo', async () => {
    const drive = new FakeDrive()
    const phone = await device()
    const file = await epub('Capítulo três')
    const id = await bookIdFor(file)
    await phone.books.addBook({ id, title: 'Quincas', author: 'Machado', coverBlob: null, fileBlob: file, addedAt: 100 })
    await phone.sync.syncNow(drive)
    const pc = await device()
    await pc.sync.syncNow(drive)
    await pc.bookFile.ensureBookFile((await pc.books.getBook(id))!, drive)

    const edited = await epub('Capítulo três, revisto')
    await phone.books.updateBook(id, { title: 'Quincas Borba', fileBlob: edited })
    await phone.sync.syncNow(drive)
    await pc.sync.syncNow(drive)

    const there = (await pc.books.getBook(id))!
    expect(there.title).toBe('Quincas Borba')
    expect(pc.bookFile.needsDownload(there)).toBe(true)
    expect(await bytes(await pc.bookFile.ensureBookFile(there, drive))).toEqual(await bytes(edited))
    expect(epubFiles(drive)).toHaveLength(1)
  })

  it('o mesmo livro importado nos dois aparelhos fica um só no Drive, sem subir duas vezes', async () => {
    const drive = new FakeDrive()
    const file = await epub('Capítulo quatro')
    const id = await bookIdFor(file)
    const phone = await device()
    await phone.books.addBook({ id, title: 'Helena', author: 'Machado', coverBlob: null, fileBlob: file, addedAt: 100 })
    const pc = await device()
    await pc.books.addBook({ id, title: 'Helena', author: 'Machado', coverBlob: null, fileBlob: file, addedAt: 300 })

    await phone.sync.syncNow(drive)
    const uploadsBefore = drive.uploads
    await pc.sync.syncNow(drive)

    expect(epubFiles(drive)).toHaveLength(1)
    // Only the library file was written: the PC's copy of the book wasn't sent again.
    expect(drive.uploads - uploadsBefore).toBe(1)
    expect(await pc.books.getBook(id)).toMatchObject({ pendingUpload: false, fileBlob: expect.any(Blob) })
  })

  it('o que um aparelho removeu antes da primeira sincronização dele não apaga nada nos outros', async () => {
    const drive = new FakeDrive()
    const file = await epub('Capítulo cinco')
    const id = await bookIdFor(file)
    const pc = await device()
    await pc.books.addBook({ id, title: 'Iaiá Garcia', author: 'Machado', coverBlob: null, fileBlob: file, addedAt: 100 })
    await pc.sync.syncNow(drive)

    // Removed while the dialog still said the removal was only local.
    const phone = await device()
    await phone.books.addBook({ id, title: 'Iaiá Garcia', author: 'Machado', coverBlob: null, fileBlob: file, addedAt: 200 })
    await phone.books.removeBook(id)
    await phone.sync.syncNow(drive)
    await pc.sync.syncNow(drive)

    expect(await pc.books.getBook(id)).toMatchObject({ title: 'Iaiá Garcia', fileBlob: expect.any(Blob) })
    // The two sides added up: the phone gets the book back, from Drive.
    expect(await phone.books.getBook(id)).toMatchObject({ fileBlob: null })
  })

  it('dois aparelhos que sincronizam pela primeira vez ao mesmo tempo ficam com a mesma pasta', async () => {
    const drive = new FakeDrive()
    const file = await epub('Capítulo oito')
    const id = await bookIdFor(file)
    const phone = await device()
    await phone.books.addBook({ id, title: 'Ressurreição', author: 'Machado', coverBlob: null, fileBlob: file, addedAt: 100 })
    // Safari and the app installed on the same iPhone are two of these.
    const app = await device()

    await Promise.all([phone.sync.syncNow(drive), app.sync.syncNow(drive)])

    expect((await app.local.getDriveFolders())?.root).toBe((await phone.local.getDriveFolders())?.root)
    await app.sync.syncNow(drive)
    expect(await app.books.getBook(id)).toMatchObject({ title: 'Ressurreição', fileBlob: null })
  })

  it('um livro que o Drive recusa não trava os outros e aparece na contagem', async () => {
    const drive = new FakeDrive()
    const phone = await device()
    const first = await epub('Capítulo seis')
    const second = await epub('Capítulo sete')
    const firstId = await bookIdFor(first)
    const secondId = await bookIdFor(second)
    await phone.books.addBook({ id: firstId, title: 'Esaú e Jacó', author: 'Machado', coverBlob: null, fileBlob: first, addedAt: 100 })
    await phone.books.addBook({ id: secondId, title: 'Memorial de Aires', author: 'Machado', coverBlob: null, fileBlob: second, addedAt: 100 })
    await phone.sync.syncNow(drive)

    // The first book's EPUB deleted by hand on Drive, then both books edited here.
    drive.files.delete((await phone.books.getBook(firstId))!.driveFileId!)
    await phone.books.updateBook(firstId, { title: 'Esaú e Jacó, revisto', fileBlob: await epub('Capítulo seis, revisto') })
    await phone.books.updateBook(secondId, { title: 'Memorial de Aires, revisto', fileBlob: await epub('Capítulo sete, revisto') })

    expect(await phone.sync.syncNow(drive)).toMatchObject({ uploaded: 1, skipped: 1 })
    expect(await phone.books.getBook(firstId)).toMatchObject({ pendingUpload: true })
    expect(await phone.books.getBook(secondId)).toMatchObject({ pendingUpload: false })
  })

  it('um envio grande sem o endereço da sessão é pulado e não trava os outros livros', async () => {
    const drive = new FakeDrive()
    drive.refuseBigUploads = true
    const phone = await device()
    const big = await epub('x'.repeat(SIMPLE_UPLOAD_LIMIT + 1024))
    const small = await epub('Capítulo nove')
    const bigId = await bookIdFor(big)
    const smallId = await bookIdFor(small)
    await phone.books.addBook({ id: bigId, title: 'Grande', author: 'Autor', coverBlob: null, fileBlob: big, addedAt: 100 })
    await phone.books.addBook({ id: smallId, title: 'Pequeno', author: 'Autor', coverBlob: null, fileBlob: small, addedAt: 100 })

    expect(await phone.sync.syncNow(drive)).toMatchObject({ uploaded: 1, skipped: 1 })
    expect(await drive.library()).toMatchObject({ books: { [smallId]: { title: 'Pequeno' } } })
    expect(await phone.books.getBook(bigId)).toMatchObject({ pendingUpload: true })
  })

  it('com o Drive cheio, o que vem de lá continua chegando, e a sincronização avisa', async () => {
    const drive = new FakeDrive()
    const phone = await device()
    const file = await epub('Capítulo dez')
    const id = await bookIdFor(file)
    const cover = new Blob(['capa'], { type: 'image/png' })
    await phone.books.addBook({ id, title: 'Casa Velha', author: 'Machado', coverBlob: cover, fileBlob: file, addedAt: 100 })
    await phone.sync.syncNow(drive)

    const pc = await device()
    const mine = await epub('Capítulo onze')
    await pc.books.addBook({ id: await bookIdFor(mine), title: 'Do PC', author: 'Autor', coverBlob: null, fileBlob: mine, addedAt: 300 })
    drive.full = true

    await expect(pc.sync.syncNow(drive)).rejects.toMatchObject({ problem: 'cheio', booksAdded: 1 })
    expect(await (await pc.books.getBook(id))?.coverBlob?.text()).toBe('capa')
  })

  it('a pasta das capas apagada no Drive também vira um erro claro', async () => {
    const drive = new FakeDrive()
    const phone = await device()
    await phone.sync.syncNow(drive)
    ;[...drive.files.values()].find((file) => file.name === 'capas')!.trashed = true

    await expect(phone.sync.syncNow(drive)).rejects.toMatchObject({ problem: 'pasta', message: expect.stringContaining('capas') })
  })

  it('a pasta do app apagada no Drive vira um erro claro, sem criar outra', async () => {
    const drive = new FakeDrive()
    const phone = await device()
    await phone.sync.syncNow(drive)
    const root = [...drive.files.values()].find((file) => file.name === 'MyBooks')!
    root.trashed = true
    const folders = drive.files.size

    await expect(phone.sync.syncNow(drive)).rejects.toMatchObject({ problem: 'pasta' })
    expect(drive.files.size).toBe(folders)
  })

  it('avisa o andamento dos envios livro a livro, contando o recusado, e nada quando não há o que enviar', async () => {
    const drive = new FakeDrive()
    drive.refuseBigUploads = true
    const phone = await device()
    const big = await epub('x'.repeat(SIMPLE_UPLOAD_LIMIT + 1024))
    const small = await epub('Capítulo doze')
    await phone.books.addBook({ id: await bookIdFor(big), title: 'Grande', author: 'Autor', coverBlob: null, fileBlob: big, addedAt: 100 })
    await phone.books.addBook({ id: await bookIdFor(small), title: 'Pequeno', author: 'Autor', coverBlob: null, fileBlob: small, addedAt: 100 })
    const onProgress = vi.fn()

    await phone.sync.syncNow(drive, undefined, onProgress)
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { done: 0, total: 2 },
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ])

    // The PC gets the book without its file: nothing of its own to send.
    const pc = await device()
    const quiet = vi.fn()
    await pc.sync.syncNow(drive, undefined, quiet)
    expect(quiet).not.toHaveBeenCalled()
  })

  it('o resumo separa os livros que chegaram e os que foram removidos no outro aparelho', async () => {
    const drive = new FakeDrive()
    const phone = await device()
    const file = await epub('Capítulo treze')
    const id = await bookIdFor(file)
    await phone.books.addBook({ id, title: 'A Mão e a Luva', author: 'Machado', coverBlob: null, fileBlob: file, addedAt: 100 })
    await phone.progress.saveProgress({ bookId: id, cfi: 'epubcfi(/6/4)', percentage: 5, lastReadAt: 150 })
    await phone.sync.syncNow(drive)

    const pc = await device()
    expect(await pc.sync.syncNow(drive)).toMatchObject({ applied: 2, booksAdded: 1, booksRemoved: 0 })

    await phone.books.removeBook(id)
    await phone.sync.syncNow(drive)
    expect(await pc.sync.syncNow(drive)).toMatchObject({ booksAdded: 0, booksRemoved: 1 })
  })

  it('os livros que chegaram contam mesmo se gravar a biblioteca no Drive falhar', async () => {
    const drive = new FakeDrive()
    const phone = await device()
    const first = await epub('Capítulo catorze')
    const firstId = await bookIdFor(first)
    await phone.books.addBook({ id: firstId, title: 'Contos', author: 'Machado', coverBlob: null, fileBlob: first, addedAt: 100 })
    await phone.sync.syncNow(drive)
    const pc = await device()
    await pc.sync.syncNow(drive)

    const second = await epub('Capítulo quinze')
    await phone.books.addBook({ id: await bookIdFor(second), title: 'Crônicas', author: 'Machado', coverBlob: null, fileBlob: second, addedAt: 200 })
    await phone.sync.syncNow(drive)

    // The PC read on, so its merged file differs from Drive's, and writing it back fails.
    await pc.progress.saveProgress({ bookId: firstId, cfi: 'epubcfi(/6/4)', percentage: 30, lastReadAt: 900 })
    drive.full = true
    await expect(pc.sync.syncNow(drive)).rejects.toMatchObject({ problem: 'cheio', booksAdded: 1 })
  })
})
