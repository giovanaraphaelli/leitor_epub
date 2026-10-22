// The login server holds the refresh token in a cookie the page can't read;
// the access token it hands out is kept here until a minute before it expires.

export type DriveAuthProblem = 'desconectado' | 'reconectar' | 'indisponivel'

export class DriveAuthError extends Error {
  readonly problem: DriveAuthProblem

  constructor(problem: DriveAuthProblem) {
    super(`Google Drive: ${problem}`)
    this.problem = problem
  }
}

const MARGIN_MS = 60_000

let cached: { accessToken: string; expiresAt: number } | null = null

export async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt - MARGIN_MS > Date.now()) return cached.accessToken
  cached = null
  let response: Response
  try {
    response = await fetch('/api/auth/token', { method: 'POST' })
  } catch {
    throw new DriveAuthError('indisponivel')
  }
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null
  const accessToken = data?.accessToken
  const expiresAt = data?.expiresAt
  if (response.ok && typeof accessToken === 'string' && typeof expiresAt === 'number') {
    cached = { accessToken, expiresAt }
    return accessToken
  }
  const problem = data?.error
  if (response.status === 401 && (problem === 'desconectado' || problem === 'reconectar')) {
    throw new DriveAuthError(problem)
  }
  // No login server behind /api (the static deploy, `npm run dev`) or one that failed.
  throw new DriveAuthError('indisponivel')
}

// A 401 from the Drive API means the cached token stopped working before its
// time (revoked, or a clock that's off): the next call asks the server again.
export function invalidateAccessToken(): void {
  cached = null
}

// A page navigation, not a popup: popups are what tends to break in the app
// installed on the iPhone.
export function connectDrive(): void {
  window.location.assign('/api/auth/start')
}

// Throws when the cookie couldn't be cleared (server down, 5xx, no network):
// the login is then still there, and the caller must not say it's gone.
export async function disconnectDrive(): Promise<void> {
  const response = await fetch('/api/auth/logout', { method: 'POST' })
  if (!response.ok) throw new DriveAuthError('indisponivel')
  cached = null
}
