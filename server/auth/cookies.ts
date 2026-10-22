import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16

// Encrypted and authenticated: without the key a cookie can be neither read
// nor changed. The parts are base64url joined by dots, safe as a cookie value.
export function seal(value: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES })
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv, encrypted, cipher.getAuthTag()].map((part) => part.toString('base64url')).join('.')
}

export function unseal(sealed: string, key: Buffer): string | null {
  const parts = sealed.split('.')
  if (parts.length !== 3) return null
  const [iv, encrypted, tag] = parts.map((part) => Buffer.from(part, 'base64url'))
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES })
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

export function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>()
  for (const pair of (header ?? '').split(';')) {
    const index = pair.indexOf('=')
    if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
  }
  return cookies
}

export interface CookieOptions {
  maxAge: number
  secure: boolean
}

// Only the login routes ever need these cookies, and the page's scripts
// never see them.
export function serializeCookie(name: string, value: string, { maxAge, secure }: CookieOptions): string {
  const parts = [`${name}=${value}`, 'Path=/api/auth', `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Lax']
  if (secure) parts.push('Secure')
  return parts.join('; ')
}
