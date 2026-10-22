import { describe, expect, it } from 'vitest'
import { readAuthConfig } from './config.ts'

const env = {
  GOOGLE_CLIENT_ID: 'cliente',
  GOOGLE_CLIENT_SECRET: 'segredo',
  COOKIE_SECRET: Buffer.alloc(32, 7).toString('base64'),
  OAUTH_ALLOWED_ORIGINS: 'https://leitor.exemplo.com, http://localhost:3000',
}

describe('readAuthConfig', () => {
  it('lê as credenciais, a chave e as origens', () => {
    const config = readAuthConfig(env)
    expect(config.clientId).toBe('cliente')
    expect(config.clientSecret).toBe('segredo')
    expect(config.cookieKey.length).toBe(32)
    expect([...config.allowedOrigins]).toEqual(['https://leitor.exemplo.com', 'http://localhost:3000'])
  })

  it('aponta as variáveis que faltam', () => {
    expect(() => readAuthConfig({ ...env, GOOGLE_CLIENT_SECRET: '', COOKIE_SECRET: undefined })).toThrow(
      'Faltam variáveis de ambiente: GOOGLE_CLIENT_SECRET, COOKIE_SECRET',
    )
  })

  it('recusa uma chave de cookie que não tem 32 bytes', () => {
    expect(() => readAuthConfig({ ...env, COOKIE_SECRET: Buffer.alloc(16).toString('base64') })).toThrow(
      'COOKIE_SECRET precisa ter 32 bytes',
    )
  })

  it('normaliza as origens: barra no fim e maiúsculas', () => {
    const config = readAuthConfig({ ...env, OAUTH_ALLOWED_ORIGINS: 'https://Leitor.Exemplo.com/, http://localhost:3000/' })
    expect([...config.allowedOrigins]).toEqual(['https://leitor.exemplo.com', 'http://localhost:3000'])
  })

  it('recusa uma origem sem http(s) e uma lista sem nenhuma origem', () => {
    expect(() => readAuthConfig({ ...env, OAUTH_ALLOWED_ORIGINS: 'localhost:3000' })).toThrow(
      'OAUTH_ALLOWED_ORIGINS tem uma origem inválida: localhost:3000',
    )
    expect(() => readAuthConfig({ ...env, OAUTH_ALLOWED_ORIGINS: ' , ' })).toThrow(
      'OAUTH_ALLOWED_ORIGINS precisa ter ao menos uma origem',
    )
  })
})
