import { sha256, toHex } from './sha256'

// A book's id has to be the same on every device that holds the same book:
// that's what lets reading progress and highlights follow it. The stored
// file's own bytes can't give that: prepareEpub rewrites stylesheets on import
// and repack stamps the current time on the mimetype entry, so the stored copy
// differs from the original and from the copy another device made. So the id
// covers what this app never changes: every entry's path, CRC-32 and size,
// except stylesheets (all prepareEpub touches) and mimetype (constant by spec,
// and added by repack when a book lacks it).
//
// Those three numbers are read off the zip's central directory, so nothing is
// unzipped and only the last few KB of the file are read. (Unzipping every
// entry with JSZip to hash its content cost ~60 ms per entry in WebKit, minutes
// for a library.) A CRC-32 isn't a cryptographic hash, but two different books
// would have to match path, size and CRC-32 on every entry that differs.
export async function bookIdFor(source: Blob | ArrayBuffer): Promise<string> {
  const entries = (await readEntries(source)).filter(
    (entry) => !entry.name.endsWith('/') && entry.name !== 'mimetype' && !/\.css$/i.test(entry.name),
  )
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const manifest = entries
    .map((entry) => `${entry.name}\0${entry.crc32.toString(16).padStart(8, '0')}\0${entry.size}`)
    .join('\n')
  return digestHex(new TextEncoder().encode(manifest))
}

const BOOK_ID = /^[0-9a-f]{64}$/

// Books imported before ids came from the content have a random uuid instead.
export function isBookId(id: string): boolean {
  return BOOK_ID.test(id)
}

interface ZipEntry {
  name: string
  crc32: number
  size: number
}

const END_OF_DIRECTORY = 0x06054b50
const DIRECTORY_ENTRY = 0x02014b50
// The end record is 22 bytes plus a comment of up to 65535.
const END_SEARCH = 22 + 0xffff

async function slice(source: Blob | ArrayBuffer, start: number, end?: number): Promise<Uint8Array> {
  if (source instanceof Blob) return new Uint8Array(await source.slice(start, end).arrayBuffer())
  return new Uint8Array(source, start, end === undefined ? undefined : end - start)
}

async function readEntries(source: Blob | ArrayBuffer): Promise<ZipEntry[]> {
  const total = source instanceof Blob ? source.size : source.byteLength
  const tail = await slice(source, Math.max(0, total - END_SEARCH))
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
  let end = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tailView.getUint32(i, true) === END_OF_DIRECTORY) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('Não é um arquivo zip')
  const count = tailView.getUint16(end + 10, true)
  const size = tailView.getUint32(end + 12, true)
  const offset = tailView.getUint32(end + 16, true)
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) throw new Error('Zip64 não suportado')

  const directory = await slice(source, offset, offset + size)
  const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength)
  const decoder = new TextDecoder()
  const entries: ZipEntry[] = []
  let position = 0
  for (let n = 0; n < count; n++) {
    if (position + 46 > directory.length || view.getUint32(position, true) !== DIRECTORY_ENTRY) {
      throw new Error('Diretório do zip corrompido')
    }
    const nameLength = view.getUint16(position + 28, true)
    const extraLength = view.getUint16(position + 30, true)
    const commentLength = view.getUint16(position + 32, true)
    entries.push({
      name: decoder.decode(directory.subarray(position + 46, position + 46 + nameLength)),
      crc32: view.getUint32(position + 16, true),
      size: view.getUint32(position + 24, true),
    })
    position += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

async function digestHex(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    // A copy, typed as ArrayBuffer-backed, which is what the DOM typings ask for.
    return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))))
  }
  return toHex(sha256(bytes))
}
