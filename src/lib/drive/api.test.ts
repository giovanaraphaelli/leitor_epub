import { afterEach, describe, expect, it, vi } from 'vitest'
import { invalidateAccessToken } from './auth'
import { driveApi, SIMPLE_UPLOAD_LIMIT } from './api'

vi.mock('./auth', () => ({
  getAccessToken: vi.fn(async () => 'tok'),
  invalidateAccessToken: vi.fn(),
}))

const json = (status: number, body: unknown, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers })

function driveAnswers(...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>()
  for (const response of responses) fetchMock.mockResolvedValueOnce(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const call = (fetchMock: ReturnType<typeof driveAnswers>, index: number) => {
  const [url, init] = fetchMock.mock.calls[index]
  return { url: String(url), init: init!, headers: new Headers(init!.headers) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('driveApi', () => {
  it('busca a pasta pelo nome, com o token e as aspas escapadas', async () => {
    const fetchMock = driveAnswers(json(200, { files: [{ id: 'f1' }, { id: 'f2' }] }))
    expect(await driveApi.findFolder("Livros d'Ana", 'root')).toBe('f1')
    const { url, headers } = call(fetchMock, 0)
    const q = new URL(url).searchParams.get('q')
    expect(q).toContain("name = 'Livros d\\'Ana'")
    expect(q).toContain("'root' in parents and trashed = false")
    expect(headers.get('Authorization')).toBe('Bearer tok')
  })

  it('um 401 renova o token uma vez e repete; o segundo 401 vira erro', async () => {
    driveAnswers(json(401, {}), json(200, { version: '7' }))
    expect(await driveApi.getVersion('j1')).toBe('7')
    expect(invalidateAccessToken).toHaveBeenCalledOnce()

    driveAnswers(json(401, {}), json(401, {}))
    await expect(driveApi.getVersion('j1')).rejects.toMatchObject({ status: 401 })
  })

  it('o erro do Drive traz o motivo', async () => {
    driveAnswers(json(403, { error: { message: 'cheio', errors: [{ reason: 'storageQuotaExceeded' }] } }))
    await expect(driveApi.getVersion('j1')).rejects.toMatchObject({ status: 403, reason: 'storageQuotaExceeded' })
  })

  it('um arquivo pequeno sobe numa requisição só, com os metadados e o conteúdo', async () => {
    const fetchMock = driveAnswers(json(200, { id: 'novo', version: 1 }))
    const ref = await driveApi.createFile(
      { name: 'Livro.epub', parentId: 'pasta', mimeType: 'application/epub+zip', appProperties: { bookId: 'b1' } },
      new Blob(['conteudo do livro'], { type: 'application/epub+zip' }),
    )
    expect(ref).toEqual({ id: 'novo', version: '1' })
    const { url, init, headers } = call(fetchMock, 0)
    expect(url).toContain('/upload/drive/v3/files?uploadType=multipart')
    expect(init.method).toBe('POST')
    expect(headers.get('Content-Type')).toMatch(/^multipart\/related; boundary=/)
    const body = await (init.body as Blob).text()
    expect(body).toContain('"parents":["pasta"]')
    expect(body).toContain('"appProperties":{"bookId":"b1"}')
    expect(body).toContain('Content-Type: application/epub+zip')
    expect(body).toContain('conteudo do livro')
  })

  it('um arquivo grande abre uma sessão e manda o conteúdo inteiro nela', async () => {
    const big = new Blob([new Uint8Array(SIMPLE_UPLOAD_LIMIT + 1)], { type: 'application/epub+zip' })
    const fetchMock = driveAnswers(
      json(200, {}, { Location: 'https://upload.example/sessao' }),
      json(200, { id: 'grande', version: '3' }),
    )
    expect(await driveApi.updateFile('grande', big)).toEqual({ id: 'grande', version: '3' })
    const start = call(fetchMock, 0)
    expect(start.url).toContain('/upload/drive/v3/files/grande?uploadType=resumable')
    expect(start.init.method).toBe('PATCH')
    expect(start.headers.get('X-Upload-Content-Length')).toBe(String(big.size))
    const send = call(fetchMock, 1)
    expect(send.url).toBe('https://upload.example/sessao')
    expect(send.init.method).toBe('PUT')
    expect(send.init.body).toBe(big)
  })

  it('sem o endereço da sessão, o envio grande falha com um erro claro', async () => {
    const big = new Blob([new Uint8Array(SIMPLE_UPLOAD_LIMIT + 1)])
    driveAnswers(json(200, {}))
    await expect(driveApi.updateFile('grande', big)).rejects.toMatchObject({ reason: 'noUploadSession' })
  })

  it('uma pasta apagada ou na lixeira não está viva', async () => {
    driveAnswers(json(404, { error: { message: 'not found', errors: [{ reason: 'notFound' }] } }))
    expect(await driveApi.isFolderAlive('x')).toBe(false)
    driveAnswers(json(200, { id: 'x', trashed: true }))
    expect(await driveApi.isFolderAlive('x')).toBe(false)
    driveAnswers(json(200, { id: 'x', trashed: false }))
    expect(await driveApi.isFolderAlive('x')).toBe(true)
  })
})
