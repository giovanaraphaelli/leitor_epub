import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestPersistentStorage } from './storage'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requestPersistentStorage', () => {
  it('pede ao navegador e devolve a resposta dele', async () => {
    const persist = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('navigator', { storage: { persist } })
    expect(await requestPersistentStorage()).toBe(true)
    expect(persist).toHaveBeenCalledOnce()
  })

  it('devolve false quando o navegador recusa', async () => {
    vi.stubGlobal('navigator', { storage: { persist: vi.fn().mockResolvedValue(false) } })
    expect(await requestPersistentStorage()).toBe(false)
  })

  it('aceita um navegador sem a API', async () => {
    vi.stubGlobal('navigator', {})
    expect(await requestPersistentStorage()).toBe(false)
  })

  it('não propaga o erro do navegador', async () => {
    vi.stubGlobal('navigator', { storage: { persist: vi.fn().mockRejectedValue(new Error('negado')) } })
    expect(await requestPersistentStorage()).toBe(false)
  })
})
