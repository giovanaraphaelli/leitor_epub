import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  buildAuthUrl,
  DRIVE_FILE_SCOPE,
  exchangeCode,
  GoogleAuthError,
  hasDriveScope,
  refreshAccessToken,
} from './google.ts'

const credentials = { clientId: 'cliente', clientSecret: 'segredo' }
const CALLBACK = 'https://leitor.exemplo.com/api/auth/callback'

function mockFetch(status: number, body: unknown): Mock<typeof fetch> {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// The form the code sent to Google, from the mocked fetch's first call.
function sentForm(fetchMock: Mock<typeof fetch>): URLSearchParams {
  return fetchMock.mock.calls[0][1]?.body as URLSearchParams
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildAuthUrl', () => {
  it('pede só o drive.file, com acesso offline e consentimento', () => {
    const url = new URL(buildAuthUrl('cliente', CALLBACK, 'estado'))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'cliente',
      redirect_uri: CALLBACK,
      response_type: 'code',
      scope: DRIVE_FILE_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state: 'estado',
    })
  })
})

describe('hasDriveScope', () => {
  it('confere o escopo entre os concedidos', () => {
    expect(hasDriveScope(`openid ${DRIVE_FILE_SCOPE}`)).toBe(true)
    expect(hasDriveScope('openid email')).toBe(false)
  })
})

describe('exchangeCode', () => {
  it('troca o código pelos tokens com o client secret', async () => {
    const fetchMock = mockFetch(200, {
      access_token: 'acesso',
      expires_in: 3599,
      refresh_token: 'renovacao',
      scope: DRIVE_FILE_SCOPE,
    })
    const tokens = await exchangeCode(credentials, 'codigo', CALLBACK)
    expect(tokens).toEqual({ accessToken: 'acesso', expiresIn: 3599, refreshToken: 'renovacao', scope: DRIVE_FILE_SCOPE })
    expect(fetchMock.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token')
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
    expect(Object.fromEntries(sentForm(fetchMock))).toEqual({
      code: 'codigo',
      client_id: 'cliente',
      client_secret: 'segredo',
      redirect_uri: CALLBACK,
      grant_type: 'authorization_code',
    })
  })
})

describe('refreshAccessToken', () => {
  it('pede um access token novo com o refresh token', async () => {
    const fetchMock = mockFetch(200, { access_token: 'novo', expires_in: 3599, scope: DRIVE_FILE_SCOPE })
    const tokens = await refreshAccessToken(credentials, 'renovacao')
    expect(tokens.accessToken).toBe('novo')
    expect(tokens.refreshToken).toBeUndefined()
    expect(sentForm(fetchMock).get('grant_type')).toBe('refresh_token')
    expect(sentForm(fetchMock).get('refresh_token')).toBe('renovacao')
  })

  it('repassa o código de erro do Google', async () => {
    mockFetch(400, { error: 'invalid_grant' })
    await expect(refreshAccessToken(credentials, 'revogado')).rejects.toMatchObject({ code: 'invalid_grant' })
  })

  it('usa o status quando a resposta não é JSON', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('<html>', { status: 503 })))
    const error = await refreshAccessToken(credentials, 'x').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(GoogleAuthError)
    expect((error as GoogleAuthError).code).toBe('http_503')
  })
})
