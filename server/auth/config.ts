export interface AuthConfig {
  clientId: string
  clientSecret: string
  cookieKey: Buffer
  allowedOrigins: ReadonlySet<string>
}

const REQUIRED = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'COOKIE_SECRET', 'OAUTH_ALLOWED_ORIGINS']

// A trailing slash or capital letters in the setting would match no real
// origin, and every /api request would then answer 403.
function normalizeOrigin(value: string): string {
  const invalid = () => new Error(`OAUTH_ALLOWED_ORIGINS tem uma origem inválida: ${value}`)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw invalid()
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalid()
  return url.origin
}

export function readAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  const missing = REQUIRED.filter((name) => !env[name])
  if (missing.length > 0) throw new Error(`Faltam variáveis de ambiente: ${missing.join(', ')}`)
  const cookieKey = Buffer.from(env.COOKIE_SECRET!, 'base64')
  if (cookieKey.length !== 32) throw new Error('COOKIE_SECRET precisa ter 32 bytes, em base64')
  const allowedOrigins = new Set(
    env.OAUTH_ALLOWED_ORIGINS!.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map(normalizeOrigin),
  )
  if (allowedOrigins.size === 0) throw new Error('OAUTH_ALLOWED_ORIGINS precisa ter ao menos uma origem')
  return {
    clientId: env.GOOGLE_CLIENT_ID!,
    clientSecret: env.GOOGLE_CLIENT_SECRET!,
    cookieKey,
    allowedOrigins,
  }
}
