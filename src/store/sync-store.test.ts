import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { syncNow, toast } = vi.hoisted(() => ({ syncNow: vi.fn(), toast: vi.fn() }))
vi.mock('@/lib/sync/run', async (original) => ({
  ...(await original<typeof import('@/lib/sync/run')>()),
  syncNow: (...args: unknown[]) => syncNow(...args),
}))
vi.mock('sonner', () => ({ toast }))

// Fresh modules per test: both stores keep their state at module level.
let sync: typeof import('./sync-store')
let drive: typeof import('./drive-store')
let run: typeof import('@/lib/sync/run')

beforeEach(async () => {
  vi.resetModules()
  syncNow.mockReset()
  toast.mockReset()
  drive = await import('./drive-store')
  sync = await import('./sync-store')
  run = await import('@/lib/sync/run')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useSyncStore', () => {
  it('não sincroniza sem o Drive conectado', async () => {
    drive.useDriveStore.setState({ status: 'desconectado' })
    await sync.useSyncStore.getState().run()
    expect(syncNow).not.toHaveBeenCalled()
  })

  it('anota a hora e avisa a biblioteca quando algo mudou aqui, inclusive um envio', async () => {
    drive.useDriveStore.setState({ status: 'conectado' })
    syncNow.mockResolvedValueOnce({ applied: 0, uploaded: 0, skipped: 0, covers: 0 })
    await sync.useSyncStore.getState().run()
    expect(sync.useSyncStore.getState()).toMatchObject({ status: 'parado', revision: 0, error: null })
    expect(sync.useSyncStore.getState().lastSyncAt).toEqual(expect.any(Number))

    syncNow.mockResolvedValueOnce({ applied: 3, uploaded: 0, skipped: 0, covers: 1 })
    await sync.useSyncStore.getState().run()
    expect(sync.useSyncStore.getState().revision).toBe(1)

    // What went up now has its Drive ids, which the remove dialog reads.
    syncNow.mockResolvedValueOnce({ applied: 0, uploaded: 2, skipped: 0, covers: 0 })
    await sync.useSyncStore.getState().run()
    expect(sync.useSyncStore.getState().revision).toBe(2)
  })

  it('uma chamada no meio de uma sincronização roda outra logo depois', async () => {
    drive.useDriveStore.setState({ status: 'conectado' })
    let finish!: (summary: unknown) => void
    syncNow.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    syncNow.mockResolvedValueOnce({ applied: 0, uploaded: 1, skipped: 0, covers: 0 })

    const first = sync.useSyncStore.getState().run()
    await sync.useSyncStore.getState().run()
    expect(syncNow).toHaveBeenCalledTimes(1)
    finish({ applied: 0, uploaded: 0, skipped: 0, covers: 0 })
    await first

    await vi.waitFor(() => expect(syncNow).toHaveBeenCalledTimes(2))
  })

  it('livros que o Drive recusou aparecem como erro, com a contagem', async () => {
    drive.useDriveStore.setState({ status: 'conectado' })
    syncNow.mockResolvedValueOnce({ applied: 0, uploaded: 1, skipped: 2, covers: 0 })
    await sync.useSyncStore.getState().run()
    expect(sync.useSyncStore.getState()).toMatchObject({
      status: 'erro',
      problem: 'recusados',
      error: '2 livros não subiram para o Google Drive.',
    })
  })

  it('um erro fica no estado com a mensagem, e um problema de conta confere o login de novo', async () => {
    drive.useDriveStore.setState({ status: 'conectado' })
    const check = vi.spyOn(drive.useDriveStore.getState(), 'check').mockResolvedValue()
    syncNow.mockRejectedValueOnce(new run.SyncError('cheio', 'O seu Google Drive está cheio.'))
    await sync.useSyncStore.getState().run()
    expect(sync.useSyncStore.getState()).toMatchObject({ status: 'erro', problem: 'cheio', error: 'O seu Google Drive está cheio.' })
    expect(check).not.toHaveBeenCalled()

    syncNow.mockRejectedValueOnce(new run.SyncError('conta', 'Conecte o Google Drive de novo para sincronizar.'))
    await sync.useSyncStore.getState().run()
    expect(check).toHaveBeenCalledOnce()
  })

  it('guarda o andamento dos envios enquanto sincroniza e o zera ao terminar', async () => {
    drive.useDriveStore.setState({ status: 'conectado' })
    let finish!: (summary: unknown) => void
    syncNow.mockImplementationOnce((_api: unknown, _onApplied: unknown, onProgress: (progress: unknown) => void) => {
      onProgress({ done: 1, total: 3 })
      return new Promise((resolve) => (finish = resolve))
    })

    const running = sync.useSyncStore.getState().run()
    expect(sync.useSyncStore.getState().progress).toEqual({ done: 1, total: 3 })
    finish({ applied: 0, booksAdded: 0, booksRemoved: 0, uploaded: 3, skipped: 0, covers: 0 })
    await running
    expect(sync.useSyncStore.getState().progress).toBeNull()
  })

  it('avisa só os livros que chegaram ou saíram, e diz se avisou', async () => {
    drive.useDriveStore.setState({ status: 'conectado' })
    syncNow.mockResolvedValueOnce({ applied: 5, booksAdded: 2, booksRemoved: 1, uploaded: 0, skipped: 0, covers: 0 })
    expect(await sync.useSyncStore.getState().run()).toEqual({ error: null, announced: true })
    expect(toast).toHaveBeenCalledWith('2 livros chegaram de outro aparelho', { id: 'sync-books-added' })
    expect(toast).toHaveBeenCalledWith('1 livro foi removido em outro aparelho', { id: 'sync-books-removed' })

    toast.mockClear()
    syncNow.mockResolvedValueOnce({ applied: 4, booksAdded: 0, booksRemoved: 0, uploaded: 0, skipped: 0, covers: 0 })
    expect(await sync.useSyncStore.getState().run()).toEqual({ error: null, announced: false })
    expect(toast).not.toHaveBeenCalled()
  })

  it('devolve o erro de um sync que falhou, e null quando não sincronizou', async () => {
    drive.useDriveStore.setState({ status: 'conectado' })
    syncNow.mockRejectedValueOnce(new run.SyncError('offline', 'Sem conexão com a internet.'))
    expect(await sync.useSyncStore.getState().run()).toEqual({ error: 'Sem conexão com a internet.', announced: false })

    drive.useDriveStore.setState({ status: 'desconectado' })
    expect(await sync.useSyncStore.getState().run()).toBeNull()
  })

  it('avisa os livros que chegaram antes de o sync falhar', async () => {
    drive.useDriveStore.setState({ status: 'conectado' })
    syncNow.mockRejectedValueOnce(Object.assign(new run.SyncError('cheio', 'O seu Google Drive está cheio.'), { booksAdded: 1 }))
    expect(await sync.useSyncStore.getState().run()).toEqual({ error: 'O seu Google Drive está cheio.', announced: true })
    expect(toast).toHaveBeenCalledWith('1 livro chegou de outro aparelho', { id: 'sync-books-added' })
  })

  it('a mensagem dispensada fica escondida até um sync dar certo', async () => {
    drive.useDriveStore.setState({ status: 'conectado' })
    syncNow.mockRejectedValueOnce(new run.SyncError('cheio', 'O seu Google Drive está cheio.'))
    await sync.useSyncStore.getState().run()
    sync.useSyncStore.getState().dismissError()
    expect(sync.useSyncStore.getState().dismissedError).toBe('O seu Google Drive está cheio.')

    syncNow.mockResolvedValueOnce({ applied: 0, booksAdded: 0, booksRemoved: 0, uploaded: 0, skipped: 0, covers: 0 })
    await sync.useSyncStore.getState().run()
    expect(sync.useSyncStore.getState().dismissedError).toBeNull()
  })
})
