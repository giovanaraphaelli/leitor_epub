import { randomBytes } from 'node:crypto'
import type { AuthConfig } from './config.ts'
import { parseCookies, seal, serializeCookie, unseal } from './cookies.ts'
import { buildAuthUrl, exchangeCode, GoogleAuthError, hasDriveScope, refreshAccessToken } from './google.ts'

const FLOW_COOKIE = 'leitor_oauth'
const TOKEN_COOKIE = 'leitor_drive'
const FLOW_MAX_AGE = 10 * 60
// Chrome caps cookie lifetimes at 400 days; every token request renews it.
const TOKEN_MAX_AGE = 400 * 24 * 60 * 60

function respond(status: number, headers: Record<string, string>, cookies: string[], body: string | null): Response {
  const all = new Headers({ ...headers, 'Cache-Control': 'no-store' })
  for (const cookie of cookies) all.append('Set-Cookie', cookie)
  return new Response(body, { status, headers: all })
}

const json = (status: number, body: unknown, cookies: string[] = []) =>
  respond(status, { 'Content-Type': 'application/json' }, cookies, JSON.stringify(body))

const redirect = (location: string, cookies: string[] = []) => respond(302, { Location: location }, cookies, null)

const callbackUrl = (origin: string) => `${origin}/api/auth/callback`
const isSecure = (origin: string) => origin.startsWith('https:')

// Google only sends the reader back to registered addresses, so a request
// from any other origin couldn't finish the login anyway.
function allowedOrigin(request: Request, config: AuthConfig): string | null {
  const { origin } = new URL(request.url)
  return config.allowedOrigins.has(origin) ? origin : null
}

function readCookie(request: Request, name: string, config: AuthConfig): string | null {
  const sealed = parseCookies(request.headers.get('cookie')).get(name)
  return sealed ? unseal(sealed, config.cookieKey) : null
}

function start(origin: string, config: AuthConfig): Response {
  const state = randomBytes(16).toString('base64url')
  return redirect(buildAuthUrl(config.clientId, callbackUrl(origin), state), [
    serializeCookie(FLOW_COOKIE, seal(state, config.cookieKey), { maxAge: FLOW_MAX_AGE, secure: isSecure(origin) }),
  ])
}

async function callback(request: Request, origin: string, config: AuthConfig): Promise<Response> {
  const secure = isSecure(origin)
  const back = (result: string, cookies: string[] = []) =>
    redirect(`${origin}/?drive=${result}`, [serializeCookie(FLOW_COOKIE, '', { maxAge: 0, secure }), ...cookies])

  const params = new URL(request.url).searchParams
  const state = readCookie(request, FLOW_COOKIE, config)
  if (!state || params.get('state') !== state) return back('erro')
  if (params.get('error') === 'access_denied') return back('cancelado')
  const code = params.get('code')
  if (!code) return back('erro')

  try {
    const tokens = await exchangeCode(config, code, callbackUrl(origin))
    if (!hasDriveScope(tokens.scope)) return back('sem-permissao')
    if (!tokens.refreshToken) return back('erro')
    return back('conectado', [
      serializeCookie(TOKEN_COOKIE, seal(tokens.refreshToken, config.cookieKey), { maxAge: TOKEN_MAX_AGE, secure }),
    ])
  } catch (error) {
    console.error('Login do Google: a troca do código falhou', error)
    return back('erro')
  }
}

async function token(request: Request, origin: string, config: AuthConfig): Promise<Response> {
  const secure = isSecure(origin)
  const refreshToken = readCookie(request, TOKEN_COOKIE, config)
  if (!refreshToken) return json(401, { error: 'desconectado' })
  try {
    const tokens = await refreshAccessToken(config, refreshToken)
    return json(200, { accessToken: tokens.accessToken, expiresAt: Date.now() + tokens.expiresIn * 1000 }, [
      serializeCookie(TOKEN_COOKIE, seal(tokens.refreshToken ?? refreshToken, config.cookieKey), {
        maxAge: TOKEN_MAX_AGE,
        secure,
      }),
    ])
  } catch (error) {
    if (error instanceof GoogleAuthError && error.code === 'invalid_grant') {
      return json(401, { error: 'reconectar' }, [serializeCookie(TOKEN_COOKIE, '', { maxAge: 0, secure })])
    }
    console.error('Login do Google: a renovação do token falhou', error)
    return json(502, { error: 'google' })
  }
}

// Only this device's cookie goes. Revoking the token at Google would remove the
// app's whole grant and sign out every other device along with this one.
function logout(origin: string): Response {
  return json(200, { ok: true }, [serializeCookie(TOKEN_COOKIE, '', { maxAge: 0, secure: isSecure(origin) })])
}

// Answers everything under /api/; null for any other path, which the static
// files take.
export async function routeApi(request: Request, config: AuthConfig | null): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (!pathname.startsWith('/api/')) return null
  if (!config) return json(503, { error: 'indisponivel' })
  const origin = allowedOrigin(request, config)
  if (!origin) return json(403, { error: 'origem' })
  switch (`${request.method} ${pathname}`) {
    case 'GET /api/auth/start':
      return start(origin, config)
    case 'GET /api/auth/callback':
      return callback(request, origin, config)
    case 'POST /api/auth/token':
      return token(request, origin, config)
    case 'POST /api/auth/logout':
      return logout(origin)
    default:
      return json(404, { error: 'rota' })
  }
}
