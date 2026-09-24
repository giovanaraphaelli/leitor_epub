import ePub from 'epubjs'

export interface ParsedEpub {
  title: string
  author: string
  coverBlob: Blob | null
}

export async function parseEpubMetadata(file: File): Promise<ParsedEpub> {
  const arrayBuffer = await file.arrayBuffer()
  const book = ePub(arrayBuffer)
  // A file that isn't an EPUB never settles book.ready: epub.js reports the
  // failure only as this event, which would leave the import waiting forever.
  await new Promise<void>((resolve, reject) => {
    book.on('openFailed', reject)
    book.ready.then(() => resolve(), reject)
  })

  const metadata = await book.loaded.metadata
  const coverUrl = await book.coverUrl()
  const coverBlob = coverUrl ? await (await fetch(coverUrl)).blob() : null

  book.destroy()

  return {
    title: metadata.title || file.name.replace(/\.epub$/i, ''),
    author: metadata.creator || 'Autor desconhecido',
    coverBlob,
  }
}
