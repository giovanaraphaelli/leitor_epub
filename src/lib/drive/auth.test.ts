import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A fresh module per test: the access token is cached at module level.
let auth: typeof import('./auth')

function serverAnswers(...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>()
  for (const response of responses) fetchMock.mockResolvedValueOnce(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

beforeEach(async () => {
  vi.resetModules()
  auth = await import('./auth')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getAccessToken', () => {
  it('pede ao servidor e guarda até um minuto antes de expirar', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0)
    const fetchMock = serverAnswers(
      json(200, { accessToken: 'a1', expiresAt: 3_600_000 }),
      json(200, { accessToken: 'a2', expiresAt: 7_200_000 }),
    )
    expect(await auth.getAccessToken()).toBe('a1')
    now.mockReturnValue(3_500_000)
    expect(await auth.getAccessToken()).toBe('a1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    now.mockReturnValue(3_550_000)
    expect(await auth.getAccessToken()).toBe('a2')
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/token', { method: 'POST' })
  })

  it('diz se falta conectar ou reconectar', async () => {
    serverAnswers(json(401, { error: 'desconectado' }), json(401, { error: 'reconectar' }))
    await expect(auth.getAccessToken()).rejects.toMatchObject({ problem: 'desconectado' })
    await expect(auth.getAccessToken()).rejects.toMatchObject({ problem: 'reconectar' })
  })

  it('trata servidor ausente, resposta que não é JSON e rede fora como indisponível', async () => {
    const fetchMock = serverAnswers(new Response('<!doctype html>', { status: 200 }), json(503, { error: 'indisponivel' }))
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(auth.getAccessToken()).rejects.toMatchObject({ problem: 'indisponivel' })
    await expect(auth.getAccessToken()).rejects.toMatchObject({ problem: 'indisponivel' })
    await expect(auth.getAccessToken()).rejects.toMatchObject({ problem: 'indisponivel' })
  })
})

describe('disconnectDrive', () => {
  it('chama o logout e esquece o token guardado', async () => {
    const fetchMock = serverAnswers(
      json(200, { accessToken: 'a1', expiresAt: Date.now() + 3_600_000 }),
      json(200, { ok: true }),
      json(200, { accessToken: 'a2', expiresAt: Date.now() + 3_600_000 }),
    )
    await auth.getAccessToken()
    await auth.disconnectDrive()
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/auth/logout', { method: 'POST' })
    expect(await auth.getAccessToken()).toBe('a2')
  })

  it('falha, mantendo o token guardado, quando o servidor não consegue sair', async () => {
    const fetchMock = serverAnswers(
      json(200, { accessToken: 'a1', expiresAt: Date.now() + 3_600_000 }),
      json(500, { error: 'x' }),
    )
    await auth.getAccessToken()
    await expect(auth.disconnectDrive()).rejects.toMatchObject({ problem: 'indisponivel' })
    expect(await auth.getAccessToken()).toBe('a1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
