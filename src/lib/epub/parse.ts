import ePub from 'epubjs'
import { joinAuthors, readBookInfo } from './edit'

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

  // epub.js reports only the first dc:title (which can be a collection's) and
  // the first creator (which can be an illustrator); readBookInfo picks the
  // main title and every author — what the edit dialog shows and saves.
  // Books it declines to read (DRM) keep epub.js's reading.
  const info = await readBookInfo(file).catch(() => undefined)

  return {
    title: info?.title || metadata.title || file.name.replace(/\.epub$/i, ''),
    author: (info && joinAuthors(info.authors)) || metadata.creator || 'Autor desconhecido',
    coverBlob,
  }
}
