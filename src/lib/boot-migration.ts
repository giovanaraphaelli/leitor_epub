import { hasLegacyBooks, migrateBookIds } from '@/lib/db/migrate-ids'
import { debugLog } from '@/lib/debug-log'

// The first launch after the ids came from the content rewrites every book
// once, which takes a while on a big library: say so, in plain DOM because
// React isn't up yet (its first render replaces whatever #root holds). It
// draws nothing when there's nothing to do. A failure must not keep the app
// from starting: the books left with their old ids are tried again next launch.
// The outcome also goes to the debug trail, which doesn't capture console.error.
export async function migrateLibraryAtBoot(root: HTMLElement): Promise<void> {
  try {
    if (!(await hasLegacyBooks())) return
    const message = document.createElement('p')
    message.style.cssText = 'margin:0;padding:2rem 1rem;text-align:center;font:16px system-ui,sans-serif'
    message.textContent = 'Atualizando sua biblioteca…'
    root.replaceChildren(message)
    const result = await migrateBookIds(({ done, total }) => {
      message.textContent = `Atualizando sua biblioteca… ${done} de ${total}`
    })
    debugLog('migração', `${result.migrated} atualizado(s), ${result.merged} junto(s), ${result.failed} com falha`)
    if (result.failed > 0) {
      console.error(`${result.failed} livro(s) não puderam ser atualizados e seguem com o id antigo`)
    }
  } catch (error) {
    console.error('Não foi possível atualizar a biblioteca', error)
    debugLog('migração: falhou', String(error))
  }
}
