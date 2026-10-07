import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { expect, it } from 'vitest'

// O banco como era antes dos grifos (esquema versão 1): quem já tem livros
// precisa mantê-los quando o app abre esse banco com o esquema novo.
it('abre um banco da versão 1 sem perder nada e cria a tabela de grifos', async () => {
  const legacy = new Dexie('leitor-epub')
  legacy.version(1).stores({
    books: 'id, title, author, addedAt',
    progress: 'bookId, lastReadAt',
    themes: 'id, name, isPreset',
    settings: 'key',
  })
  await legacy.table('books').add({
    id: 'livro',
    title: 'Dom Casmurro',
    author: 'Machado',
    coverBlob: null,
    fileBlob: new Blob(['x']),
    addedAt: 1,
  })
  await legacy.table('progress').add({ bookId: 'livro', cfi: 'epubcfi(/6/2)', percentage: 12, lastReadAt: 5 })
  await legacy.table('themes').add({
    id: 'tema',
    name: 'Meu tema',
    background: '#ffffff',
    textColor: '#000000',
    fontFamily: 'Nunito',
    fontSize: 18,
    lineHeight: 1.6,
    columns: 'auto',
    isPreset: false,
  })
  await legacy.table('settings').add({ key: 'activeThemeId', value: 'tema' })
  legacy.close()

  const { db } = await import('./schema')
  expect((await db.books.get('livro'))?.title).toBe('Dom Casmurro')
  expect((await db.progress.get('livro'))?.percentage).toBe(12)
  expect((await db.themes.get('tema'))?.name).toBe('Meu tema')
  expect((await db.settings.get('activeThemeId'))?.value).toBe('tema')
  expect(await db.highlights.count()).toBe(0)
  db.close()
})
