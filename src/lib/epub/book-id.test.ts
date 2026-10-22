import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bookIdFor, isBookId } from './book-id'
import { repack } from './edit'

const FIXTURE = readFileSync(new URL('../../../fixtures/livro-de-teste.epub', import.meta.url))

const BASE: Record<string, string> = {
  'META-INF/container.xml': '<container/>',
  'OEBPS/content.opf': '<package/>',
  'OEBPS/cap1.xhtml': '<p>Primeiro</p>',
  'OEBPS/cap2.xhtml': '<p>Segundo</p>',
}

async function makeEpub(
  entries: Record<string, string>,
  options: { date?: Date; folders?: boolean; stream?: boolean; comment?: string } = {},
): Promise<Blob> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE', date: options.date })
  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content, { date: options.date, createFolders: options.folders ?? false })
  }
  return zip.generateAsync({ type: 'blob', streamFiles: options.stream, comment: options.comment })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('bookIdFor', () => {
  it('devolve 64 dígitos hexadecimais', async () => {
    expect(isBookId(await bookIdFor(await makeEpub(BASE)))).toBe(true)
  })

  it('é o mesmo para o mesmo conteúdo, seja qual for a ordem, a data ou as pastas do zip', async () => {
    const reversed = Object.fromEntries(Object.entries(BASE).reverse())
    const plain = await bookIdFor(await makeEpub(BASE))
    const other = await bookIdFor(await makeEpub(reversed, { date: new Date(2001, 0, 1), folders: true }))
    expect(other).toBe(plain)
  })

  it('não depende de como o zip foi montado: com descritores de dados ou com comentário', async () => {
    const plain = await bookIdFor(await makeEpub(BASE))
    expect(await bookIdFor(await makeEpub(BASE, { stream: true }))).toBe(plain)
    expect(await bookIdFor(await makeEpub(BASE, { comment: 'um comentário no fim do zip' }))).toBe(plain)
  })

  it('não muda quando só as folhas de estilo mudam, que é o que o prepareEpub faz', async () => {
    const original = await bookIdFor(await makeEpub({ ...BASE, 'OEBPS/estilo.css': 'p { color: red; }' }))
    const sanitized = await bookIdFor(await makeEpub({ ...BASE, 'OEBPS/estilo.css': 'p { }' }))
    const withoutSheet = await bookIdFor(await makeEpub(BASE))
    expect(sanitized).toBe(original)
    expect(withoutSheet).toBe(original)
  })

  it('muda quando o texto muda, ainda que o tamanho fique igual, ou quando um arquivo troca de lugar', async () => {
    const id = await bookIdFor(await makeEpub(BASE))
    const edited = await bookIdFor(await makeEpub({ ...BASE, 'OEBPS/cap2.xhtml': '<p>Segunda</p>' }))
    const { 'OEBPS/cap2.xhtml': moved, ...rest } = BASE
    const renamed = await bookIdFor(await makeEpub({ ...rest, 'OEBPS/capitulo2.xhtml': moved }))
    expect(edited).not.toBe(id)
    expect(renamed).not.toBe(id)
  })

  it('lê nomes com acento', async () => {
    const withAccent = { ...BASE, 'OEBPS/capítulo-três.xhtml': '<p>Três</p>' }
    const first = await bookIdFor(await makeEpub(withAccent))
    const zip = await JSZip.loadAsync(await (await makeEpub(withAccent)).arrayBuffer())
    expect(await bookIdFor(await repack(zip, new Map()))).toBe(first)
  })

  it('sobrevive ao repack do projeto, que grava o mimetype com a hora de agora', async () => {
    const repacked = await repack(await JSZip.loadAsync(FIXTURE), new Map())
    expect(await bookIdFor(repacked)).toBe(await bookIdFor(new Blob([new Uint8Array(FIXTURE)])))
  })

  it('sobrevive ao repack com a folha de estilo reescrita', async () => {
    const zip = await JSZip.loadAsync(FIXTURE)
    zip.file('OEBPS/estilo.css', 'p { color: red; }')
    const before = await bookIdFor(await zip.generateAsync({ type: 'blob' }))
    const after = await bookIdFor(await repack(zip, new Map([['OEBPS/estilo.css', 'p { }']])))
    expect(after).toBe(before)
  })

  it('dá o mesmo id sem crypto.subtle, como numa origem sem HTTPS', async () => {
    const blob = await makeEpub(BASE)
    const withSubtle = await bookIdFor(blob)
    vi.stubGlobal('crypto', undefined)
    expect(await bookIdFor(blob)).toBe(withSubtle)
  })

  it('aceita Blob e ArrayBuffer', async () => {
    const blob = await makeEpub(BASE)
    expect(await bookIdFor(await blob.arrayBuffer())).toBe(await bookIdFor(blob))
  })

  it('recusa o que não é um zip e o zip cortado', async () => {
    await expect(bookIdFor(new Blob(['isto não é um epub']))).rejects.toThrow('Não é um arquivo zip')
    const bytes = await (await makeEpub(BASE)).arrayBuffer()
    await expect(bookIdFor(bytes.slice(0, bytes.byteLength - 30))).rejects.toThrow()
  })
})

describe('isBookId', () => {
  it('reconhece o hash e recusa os ids antigos (uuid)', () => {
    expect(isBookId('a'.repeat(64))).toBe(true)
    expect(isBookId('3f2b8c1e-5d4a-4b7e-9c10-2a6f8e1d7b30')).toBe(false)
    expect(isBookId('A'.repeat(64))).toBe(false)
    expect(isBookId('a'.repeat(63))).toBe(false)
  })
})
