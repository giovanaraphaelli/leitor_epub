import { describe, expect, it } from 'vitest'
import { parseCookies, seal, serializeCookie, unseal } from './cookies.ts'

const KEY = Buffer.alloc(32, 1)
const OTHER_KEY = Buffer.alloc(32, 2)

describe('seal / unseal', () => {
  it('devolve o valor guardado', () => {
    expect(unseal(seal('refresh-token', KEY), KEY)).toBe('refresh-token')
  })

  it('não repete o resultado para o mesmo valor', () => {
    expect(seal('igual', KEY)).not.toBe(seal('igual', KEY))
  })

  it('recusa conteúdo adulterado, chave errada e lixo', () => {
    const sealed = seal('refresh-token', KEY)
    const [iv, data, tag] = sealed.split('.')
    const flipped = Buffer.from(data, 'base64url')
    flipped[0] ^= 1
    expect(unseal([iv, flipped.toString('base64url'), tag].join('.'), KEY)).toBeNull()
    expect(unseal(sealed, OTHER_KEY)).toBeNull()
    expect(unseal('lixo', KEY)).toBeNull()
    expect(unseal('a.b.c', KEY)).toBeNull()
  })

  it('recusa tag adulterada ou truncada, IV de tamanho errado e partes a mais', () => {
    const [iv, data, tag] = seal('refresh-token', KEY).split('.')
    const flippedTag = Buffer.from(tag, 'base64url')
    flippedTag[0] ^= 1
    expect(unseal([iv, data, flippedTag.toString('base64url')].join('.'), KEY)).toBeNull()
    expect(unseal([iv, data, tag.slice(0, 6)].join('.'), KEY)).toBeNull()
    expect(unseal([Buffer.alloc(8).toString('base64url'), data, tag].join('.'), KEY)).toBeNull()
    expect(unseal([iv, data, tag, tag].join('.'), KEY)).toBeNull()
  })
})

describe('parseCookies', () => {
  it('separa os pares e ignora o que não é par', () => {
    const cookies = parseCookies('a=1; leitor_drive=x.y.z; lixo; b=')
    expect(cookies.get('a')).toBe('1')
    expect(cookies.get('leitor_drive')).toBe('x.y.z')
    expect(cookies.get('b')).toBe('')
    expect(cookies.has('lixo')).toBe(false)
  })

  it('aceita a falta do cabeçalho', () => {
    expect(parseCookies(null).size).toBe(0)
  })
})

describe('serializeCookie', () => {
  it('marca o cookie como só do servidor, restrito ao login', () => {
    expect(serializeCookie('leitor_drive', 'v', { maxAge: 60, secure: true })).toBe(
      'leitor_drive=v; Path=/api/auth; Max-Age=60; HttpOnly; SameSite=Lax; Secure',
    )
  })

  it('deixa o Secure de fora em http, para o localhost', () => {
    expect(serializeCookie('leitor_drive', '', { maxAge: 0, secure: false })).toBe(
      'leitor_drive=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Lax',
    )
  })
})
