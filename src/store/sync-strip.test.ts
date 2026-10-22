import { describe, expect, it } from 'vitest'
import { syncStripState } from './sync-strip'

const idle = { status: 'parado' as const, progress: null, problem: null, error: null, dismissedError: null }
const full = { ...idle, status: 'erro' as const, problem: 'cheio' as const, error: 'O seu Google Drive está cheio.' }

describe('syncStripState', () => {
  it('mostra o andamento só quando há livros subindo', () => {
    expect(syncStripState({ ...idle, status: 'sincronizando', progress: { done: 1, total: 4 } }, 'conectado')).toEqual({
      kind: 'progresso',
      done: 1,
      total: 4,
    })
    expect(syncStripState({ ...idle, status: 'sincronizando' }, 'conectado')).toBeNull()
  })

  it('mostra o erro com "Tentar de novo", e "Reconectar" quando o problema é a conta', () => {
    expect(syncStripState(full, 'conectado')).toEqual({ kind: 'erro', message: 'O seu Google Drive está cheio.', action: 'tentar' })
    const account = { ...idle, status: 'erro' as const, problem: 'conta' as const, error: 'Conecte o Google Drive de novo para sincronizar.' }
    expect(syncStripState(account, 'reconectar')).toEqual({
      kind: 'erro',
      message: 'Conecte o Google Drive de novo para sincronizar.',
      action: 'reconectar',
    })
    expect(syncStripState(full, 'reconectar')).toEqual({ kind: 'erro', message: 'O seu Google Drive está cheio.', action: 'reconectar' })
  })

  it('não mostra nada sem internet, com a mensagem dispensada, parado ou sem o Drive conectado', () => {
    const offline = { ...idle, status: 'erro' as const, problem: 'offline' as const, error: 'Sem conexão com a internet.' }
    expect(syncStripState(offline, 'conectado')).toBeNull()
    expect(syncStripState({ ...full, dismissedError: 'O seu Google Drive está cheio.' }, 'conectado')).toBeNull()
    expect(syncStripState(idle, 'conectado')).toBeNull()
    expect(syncStripState(full, 'desconectado')).toBeNull()
  })
})
