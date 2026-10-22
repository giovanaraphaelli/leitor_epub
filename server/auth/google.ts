export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

export interface ClientCredentials {
  clientId: string
  clientSecret: string
}

export interface GoogleTokens {
  accessToken: string
  expiresIn: number
  refreshToken?: string
  scope: string
}

// Carries Google's `error` code, e.g. invalid_grant for a revoked refresh token.
export class GoogleAuthError extends Error {
  readonly code: string

  constructor(code: string) {
    super(`Google OAuth: ${code}`)
    this.code = code
  }
}

export function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: DRIVE_FILE_SCOPE,
    access_type: 'offline',
    // Google only hands out a refresh token on consent, so asking every time
    // makes reconnecting always bring a new one.
    prompt: 'consent',
    state,
  })
  return `${AUTH_ENDPOINT}?${params.toString()}`
}

// The reader can untick the permission on Google's screen.
export function hasDriveScope(scope: string): boolean {
  return scope.split(' ').includes(DRIVE_FILE_SCOPE)
}

function postForm(url: string, body: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    // Without a limit a slow Google holds the request open for undici's default five minutes.
    signal: AbortSignal.timeout(10_000),
  })
}

async function readTokens(response: Response): Promise<GoogleTokens> {
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  const accessToken = data.access_token
  if (!response.ok || typeof accessToken !== 'string') {
    throw new GoogleAuthError(typeof data.error === 'string' ? data.error : `http_${response.status}`)
  }
  return {
    accessToken,
    expiresIn: Number(data.expires_in),
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    scope: typeof data.scope === 'string' ? data.scope : '',
  }
}

export async function exchangeCode(
  credentials: ClientCredentials,
  code: string,
  redirectUri: string,
): Promise<GoogleTokens> {
  return readTokens(
    await postForm(TOKEN_ENDPOINT, {
      code,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  )
}

export async function refreshAccessToken(credentials: ClientCredentials, refreshToken: string): Promise<GoogleTokens> {
  return readTokens(
    await postForm(TOKEN_ENDPOINT, {
      refresh_token: refreshToken,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: 'refresh_token',
    }),
  )
}
