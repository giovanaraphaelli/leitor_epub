import type { Book } from '@/lib/db/schema'

// Characters Windows, macOS or Android refuse in a file name.
const UNSAFE_IN_FILE_NAME = /[\\/:*?"<>|\p{Cc}]/gu

export function exportFileName(book: Pick<Book, 'title' | 'author'>): string {
  const clean = (text: string) => text.replace(UNSAFE_IN_FILE_NAME, '').replace(/\s+/g, ' ').trim()
  const name = [clean(book.title), clean(book.author)].filter(Boolean).join(' - ') || 'livro'
  return `${name.slice(0, 120)}.epub`
}

// On a phone, the system share sheet: that's where "Salvar em Arquivos" and
// the Kindle app (Send to Kindle) are, and a plain download from an app
// installed to the home screen has nowhere visible to go on iOS. Elsewhere,
// a regular download. Called straight from the click — share() requires it.
export async function exportBook(book: Book): Promise<void> {
  const file = new File([book.fileBlob], exportFileName(book), { type: 'application/epub+zip' })
  const touch = window.matchMedia('(pointer: coarse)').matches
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
    }
  }
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  document.body.append(link)
  link.click()
  link.remove()
  // Revoked later, not right away: some browsers start reading the URL only
  // after the click has returned.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
