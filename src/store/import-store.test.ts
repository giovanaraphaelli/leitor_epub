import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImportStore, type ImportDeps } from './import-store'

// epub.js stays out of the tests: each test hands the store its own steps.
vi.mock('@/lib/epub/parse', () => ({ parseEpubMetadata: vi.fn() }))
vi.mock('@/lib/epub/prepare', () => ({ prepareEpub: vi.fn() }))

const file = (name: string) => new File([name], name)

// Saves into a map that exists() reads, like the database would.
function deps(overrides: Partial<ImportDeps> = {}): ImportDeps {
  const saved = new Map<string, { title: string }>()
  return {
    idFor: async (picked) => `id-${await picked.text()}`,
    exists: async (id) => saved.get(id),
    readMetadata: async (picked) => ({ title: `Título ${picked.name}`, author: 'Autor', coverBlob: null }),
    prepare: async (picked) => ({ fileBlob: picked, fontScale: 1 }),
    save: async (book) => {
      saved.set(book.id, { title: book.title })
    },
    finished: vi.fn(),
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fila de importação', () => {
  it('prepara um arquivo por vez, na ordem, e o card ganha título e autor no caminho', async () => {
    const prepared: string[] = []
    let release: (() => void) | undefined
    const steps = deps({
      prepare: async (picked) => {
        prepared.push(picked.name)
        if (picked.name === 'a.epub') await new Promise<void>((resolve) => (release = resolve))
        return { fileBlob: picked, fontScale: 1 }
      },
    })
    const store = createImportStore(steps)

    store.getState().add([file('a.epub'), file('b.epub')])
    await vi.waitFor(() => expect(release).toBeDefined())
    expect(store.getState().items).toEqual([
      expect.objectContaining({ fileName: 'a.epub', status: 'preparando', title: 'Título a.epub', author: 'Autor' }),
      expect.objectContaining({ fileName: 'b.epub', status: 'fila' }),
    ])

    release!()
    await vi.waitFor(() => expect(steps.finished).toHaveBeenCalledWith(2, []))
    expect(prepared).toEqual(['a.epub', 'b.epub'])
    expect(store.getState()).toMatchObject({ items: [], revision: 2 })
  })

  it('salva o livro com o arquivo preparado e os metadados lidos', async () => {
    const save = vi.fn<ImportDeps['save']>(async () => undefined)
    const fileBlob = new Blob(['preparado'])
    const store = createImportStore(deps({ save, prepare: async () => ({ fileBlob, fontScale: 1.2, locations: '[]' }) }))

    store.getState().add([file('a.epub')])
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'id-a.epub',
        title: 'Título a.epub',
        author: 'Autor',
        coverBlob: null,
        fileBlob,
        fontScale: 1.2,
        locations: '[]',
        addedAt: expect.any(Number),
      }),
    )
  })

  it('o mesmo livro escolhido duas vezes entra uma vez, e o repetido é avisado no fim', async () => {
    const steps = deps()
    const store = createImportStore(steps)

    store.getState().add([file('a.epub'), file('a.epub')])
    await vi.waitFor(() => expect(steps.finished).toHaveBeenCalledWith(1, ['Título a.epub']))
    expect(store.getState().items).toEqual([])
  })

  it('um arquivo que falha fica como card até ser dispensado, sem parar os outros', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const steps = deps({
      readMetadata: async (picked) => {
        if (picked.name === 'ruim.epub') throw new Error('não é um EPUB')
        return { title: picked.name, author: 'Autor', coverBlob: null }
      },
    })
    const store = createImportStore(steps)

    store.getState().add([file('ruim.epub'), file('bom.epub')])
    await vi.waitFor(() => expect(steps.finished).toHaveBeenCalledWith(1, []))
    expect(store.getState().items).toEqual([expect.objectContaining({ fileName: 'ruim.epub', status: 'falhou' })])

    store.getState().dismiss(store.getState().items[0].key)
    expect(store.getState().items).toEqual([])
  })

  it('arquivos escolhidos durante a importação entram na mesma fila, e o fim é avisado uma vez', async () => {
    let release: (() => void) | undefined
    const steps = deps({
      prepare: async (picked) => {
        if (picked.name === 'a.epub') await new Promise<void>((resolve) => (release = resolve))
        return { fileBlob: picked, fontScale: 1 }
      },
    })
    const store = createImportStore(steps)

    store.getState().add([file('a.epub')])
    await vi.waitFor(() => expect(release).toBeDefined())
    store.getState().add([file('b.epub')])
    release!()

    await vi.waitFor(() => expect(steps.finished).toHaveBeenCalledOnce())
    expect(steps.finished).toHaveBeenCalledWith(2, [])
  })
})
