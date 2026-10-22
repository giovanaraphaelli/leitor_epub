import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { AuthConfig } from './config.ts'
import { seal, unseal } from './cookies.ts'
import { DRIVE_FILE_SCOPE } from './google.ts'
import { routeApi } from './routes.ts'

const ORIGIN = 'https://leitor.exemplo.com'
const config: AuthConfig = {
  clientId: 'cliente',
  clientSecret: 'segredo',
  cookieKey: Buffer.alloc(32, 3),
  allowedOrigins: new Set([ORIGIN]),
}

function request(method: string, path: string, cookies: Record<string, string> = {}): Request {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
  return new Request(ORIGIN + path, { method, headers: cookie ? { cookie } : {} })
}

async function route(req: Request): Promise<Response> {
  const response = await routeApi(req, config)
  if (!response) throw new Error('a rota não respondeu')
  return response
}

// Name → value of each Set-Cookie in the response.
function setCookies(response: Response): Map<string, string> {
  return new Map(
    response.headers.getSetCookie().map((line) => {
      const [pair] = line.split(';')
      const index = pair.indexOf('=')
      return [pair.slice(0, index), pair.slice(index + 1)]
    }),
  )
}

function mockGoogle(status: number, body: unknown): Mock<typeof fetch> {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function sentForm(fetchMock: Mock<typeof fetch>): URLSearchParams {
  return fetchMock.mock.calls[0][1]?.body as URLSearchParams
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('routeApi', () => {
  it('deixa passar o que não é /api', async () => {
    expect(await routeApi(request('GET', '/read/livro'), config)).toBeNull()
  })

  it('responde 503 sem configuração e 403 de outra origem', async () => {
    expect((await routeApi(request('POST', '/api/auth/token'), null))?.status).toBe(503)
    expect((await route(new Request('https://outro.exemplo.com/api/auth/start'))).status).toBe(403)
  })

  it('responde 404 para rota desconhecida e para o método errado', async () => {
    expect((await route(request('GET', '/api/nada'))).status).toBe(404)
    expect((await route(request('GET', '/api/auth/token'))).status).toBe(404)
  })
})

describe('GET /api/auth/start', () => {
  it('manda para o Google com o state guardado no cookie do fluxo', async () => {
    const response = await route(request('GET', '/api/auth/start'))
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback`)
    const flow = setCookies(response).get('leitor_oauth')!
    expect(unseal(flow, config.cookieKey)).toBe(location.searchParams.get('state'))
    expect(response.headers.getSetCookie()[0]).toContain('HttpOnly; SameSite=Lax; Secure')
  })
})

describe('GET /api/auth/callback', () => {
  const flow = { leitor_oauth: seal('estado', config.cookieKey) }

  it('guarda o refresh token e volta com ?drive=conectado', async () => {
    const fetchMock = mockGoogle(200, {
      access_token: 'acesso',
      expires_in: 3599,
      refresh_token: 'renovacao',
      scope: DRIVE_FILE_SCOPE,
    })
    const response = await route(request('GET', '/api/auth/callback?state=estado&code=codigo', flow))
    expect(response.headers.get('location')).toBe(`${ORIGIN}/?drive=conectado`)
    const cookies = setCookies(response)
    expect(unseal(cookies.get('leitor_drive')!, config.cookieKey)).toBe('renovacao')
    expect(cookies.get('leitor_oauth')).toBe('')
    const tokenCookie = response.headers.getSetCookie().find((line) => line.startsWith('leitor_drive='))!
    expect(tokenCookie).toContain('Max-Age=34560000')
    expect(tokenCookie).toContain('HttpOnly; SameSite=Lax; Secure')
    expect(sentForm(fetchMock).get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback`)
  })

  it('recusa um state diferente do guardado', async () => {
    const fetchMock = mockGoogle(200, {})
    const response = await route(request('GET', '/api/auth/callback?state=outro&code=codigo', flow))
    expect(response.headers.get('location')).toBe(`${ORIGIN}/?drive=erro`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('recusa um retorno sem o cookie do fluxo, sem chamar o Google', async () => {
    const fetchMock = mockGoogle(200, {})
    const response = await route(request('GET', '/api/auth/callback?code=codigo'))
    expect(response.headers.get('location')).toBe(`${ORIGIN}/?drive=erro`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('volta com ?drive=cancelado quando a pessoa recusa', async () => {
    const response = await route(request('GET', '/api/auth/callback?state=estado&error=access_denied', flow))
    expect(response.headers.get('location')).toBe(`${ORIGIN}/?drive=cancelado`)
  })

  it('volta com ?drive=sem-permissao sem o escopo do Drive', async () => {
    mockGoogle(200, { access_token: 'acesso', expires_in: 3599, refresh_token: 'renovacao', scope: 'openid' })
    const response = await route(request('GET', '/api/auth/callback?state=estado&code=codigo', flow))
    expect(response.headers.get('location')).toBe(`${ORIGIN}/?drive=sem-permissao`)
    expect(setCookies(response).has('leitor_drive')).toBe(false)
  })

  it('volta com ?drive=erro quando o Google não manda o refresh token', async () => {
    mockGoogle(200, { access_token: 'acesso', expires_in: 3599, scope: DRIVE_FILE_SCOPE })
    const response = await route(request('GET', '/api/auth/callback?state=estado&code=codigo', flow))
    expect(response.headers.get('location')).toBe(`${ORIGIN}/?drive=erro`)
    expect(setCookies(response).has('leitor_drive')).toBe(false)
  })

  it('volta com ?drive=erro quando a troca falha', async () => {
    mockGoogle(400, { error: 'invalid_grant' })
    const response = await route(request('GET', '/api/auth/callback?state=estado&code=codigo', flow))
    expect(response.headers.get('location')).toBe(`${ORIGIN}/?drive=erro`)
  })
})

describe('POST /api/auth/token', () => {
  const connected = { leitor_drive: seal('renovacao', config.cookieKey) }

  it('responde desconectado sem o cookie', async () => {
    const response = await route(request('POST', '/api/auth/token'))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'desconectado' })
  })

  it('devolve um access token novo e renova o cookie', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    mockGoogle(200, { access_token: 'novo', expires_in: 3600, scope: DRIVE_FILE_SCOPE })
    const response = await route(request('POST', '/api/auth/token', connected))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ accessToken: 'novo', expiresAt: 4_600_000 })
    expect(unseal(setCookies(response).get('leitor_drive')!, config.cookieKey)).toBe('renovacao')
  })

  it('guarda no cookie o refresh token novo, quando o Google troca', async () => {
    mockGoogle(200, { access_token: 'novo', expires_in: 3600, refresh_token: 'rotacionado', scope: DRIVE_FILE_SCOPE })
    const response = await route(request('POST', '/api/auth/token', connected))
    expect(unseal(setCookies(response).get('leitor_drive')!, config.cookieKey)).toBe('rotacionado')
  })

  it('pede para reconectar e apaga o cookie quando o Google recusa o refresh token', async () => {
    mockGoogle(400, { error: 'invalid_grant' })
    const response = await route(request('POST', '/api/auth/token', connected))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'reconectar' })
    expect(setCookies(response).get('leitor_drive')).toBe('')
  })

  it('responde 502, sem apagar o cookie, quando o Google falha de outro jeito', async () => {
    mockGoogle(500, { error: 'backend_error' })
    const response = await route(request('POST', '/api/auth/token', connected))
    expect(response.status).toBe(502)
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it('responde 502, sem apagar o cookie, quando a rede falha', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    const response = await route(request('POST', '/api/auth/token', connected))
    expect(response.status).toBe(502)
    expect(response.headers.getSetCookie()).toEqual([])
  })
})

describe('POST /api/auth/logout', () => {
  it('apaga o cookie sem revogar o acesso no Google', async () => {
    const fetchMock = mockGoogle(200, {})
    const response = await route(request('POST', '/api/auth/logout', { leitor_drive: seal('renovacao', config.cookieKey) }))
    expect(response.status).toBe(200)
    expect(setCookies(response).get('leitor_drive')).toBe('')
    // Revoking would remove the app's whole grant and sign out every other device.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('responde 200 também sem estar conectado', async () => {
    expect((await route(request('POST', '/api/auth/logout'))).status).toBe(200)
  })
})
