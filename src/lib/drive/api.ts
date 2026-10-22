import { debugLog } from '@/lib/debug-log'
import { getAccessToken, invalidateAccessToken } from './auth'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
export const FOLDER_TYPE = 'application/vnd.google-apps.folder'
// Drive's limit for a one-request upload. Bigger files go through a resumable
// session, which needs the Location header of its first response.
export const SIMPLE_UPLOAD_LIMIT = 5 * 1024 * 1024

export interface DriveFileRef {
  id: string
  version: string
}

export interface NewDriveFile {
  name: string
  parentId: string
  mimeType: string
  appProperties?: Record<string, string>
}

// What the sync needs from Drive. An interface so the tests can run the whole
// sync against an in-memory Drive (fake-drive.ts).
export interface DriveApi {
  findFolder(name: string, parentId: string): Promise<string | null>
  createFolder(name: string, parentId: string): Promise<string>
  isFolderAlive(id: string): Promise<boolean>
  findFile(name: string, parentId: string): Promise<DriveFileRef | null>
  findBookFile(bookId: string, parentId: string): Promise<string | null>
  getVersion(id: string): Promise<string>
  createFile(file: NewDriveFile, content: Blob): Promise<DriveFileRef>
  updateFile(id: string, content: Blob): Promise<DriveFileRef>
  downloadText(id: string): Promise<string>
  downloadBlob(id: string): Promise<Blob>
}

export class DriveApiError extends Error {
  readonly status: number
  // Drive's own name for the problem, e.g. storageQuotaExceeded.
  readonly reason: string | null

  constructor(status: number, reason: string | null, message: string) {
    super(message)
    this.name = 'DriveApiError'
    this.status = status
    this.reason = reason
  }
}

// By name rather than instanceof: the error can come from another copy of this
// module (the tests simulate several devices, each with its own copy, sharing
// one fake Drive).
export function isDriveApiError(error: unknown): error is DriveApiError {
  return error instanceof Error && error.name === 'DriveApiError'
}

async function errorFrom(method: string, url: string, response: Response): Promise<DriveApiError> {
  const data = (await response.json().catch(() => null)) as {
    error?: { message?: string; errors?: Array<{ reason?: string }> }
  } | null
  const reason = data?.error?.errors?.[0]?.reason ?? null
  const message = data?.error?.message ?? response.statusText
  debugLog('drive api: erro', `${method} ${new URL(url).pathname} ${response.status} ${reason ?? '-'} ${message}`)
  return new DriveApiError(response.status, reason, `Google Drive ${response.status}: ${message}`)
}

async function driveFetch(url: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${await getAccessToken()}`)
  let response: Response
  try {
    response = await fetch(url, { ...init, headers })
  } catch (error) {
    // No response at all: no network, a refused CORS request, or the phone
    // suspending the page mid-upload. Logged with the request it killed.
    debugLog('drive api: sem resposta', `${init.method ?? 'GET'} ${new URL(url).pathname} ${String(error)}`)
    throw error
  }
  if (response.status === 401 && !retried) {
    invalidateAccessToken()
    return driveFetch(url, init, true)
  }
  if (!response.ok) throw await errorFrom(init.method ?? 'GET', url, response)
  return response
}

// Drive's query language quotes strings with ' and escapes with \.
function quote(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

async function listFiles(q: string, fields: string): Promise<Array<{ id: string; version?: string }>> {
  const params = new URLSearchParams({ q, fields: `files(${fields})`, orderBy: 'createdTime', pageSize: '10' })
  const response = await driveFetch(`${API}/files?${params}`)
  const data = (await response.json()) as { files?: Array<{ id: string; version?: string }> }
  return data.files ?? []
}

async function fileRef(response: Response): Promise<DriveFileRef> {
  const data = (await response.json()) as { id: string; version: string }
  return { id: data.id, version: String(data.version) }
}

// One request for small files; above the limit, a session that the content is
// then sent to whole (nothing resumes yet if it breaks: the next sync starts over).
async function upload(method: 'POST' | 'PATCH', path: string, metadata: object, content: Blob): Promise<DriveFileRef> {
  const type = content.type || 'application/octet-stream'
  if (content.size <= SIMPLE_UPLOAD_LIMIT) {
    const boundary = `mybooks-${Math.random().toString(36).slice(2)}`
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: ${type}\r\n\r\n`,
      content,
      `\r\n--${boundary}--`,
    ])
    const response = await driveFetch(`${UPLOAD}${path}?uploadType=multipart&fields=id,version`, {
      method,
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    })
    return fileRef(response)
  }
  const start = await driveFetch(`${UPLOAD}${path}?uploadType=resumable&fields=id,version`, {
    method,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': type,
      'X-Upload-Content-Length': String(content.size),
    },
    body: JSON.stringify(metadata),
  })
  const session = start.headers.get('Location')
  if (!session) {
    debugLog('drive api: envio grande sem Location', `${method} ${path} ${content.size} bytes`)
    throw new DriveApiError(0, 'noUploadSession', 'O Google Drive não devolveu o endereço do envio')
  }
  return fileRef(await driveFetch(session, { method: 'PUT', headers: { 'Content-Type': type }, body: content }))
}

export const driveApi: DriveApi = {
  async findFolder(name, parentId) {
    const q = `name = ${quote(name)} and mimeType = '${FOLDER_TYPE}' and ${quote(parentId)} in parents and trashed = false`
    return (await listFiles(q, 'id'))[0]?.id ?? null
  },

  async createFolder(name, parentId) {
    const response = await driveFetch(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name, mimeType: FOLDER_TYPE, parents: [parentId] }),
    })
    return ((await response.json()) as { id: string }).id
  },

  async isFolderAlive(id) {
    try {
      const response = await driveFetch(`${API}/files/${encodeURIComponent(id)}?fields=id,trashed`)
      return !((await response.json()) as { trashed?: boolean }).trashed
    } catch (error) {
      if (error instanceof DriveApiError && error.status === 404) return false
      throw error
    }
  },

  async findFile(name, parentId) {
    const q = `name = ${quote(name)} and ${quote(parentId)} in parents and trashed = false`
    const file = (await listFiles(q, 'id,version'))[0]
    return file ? { id: file.id, version: String(file.version) } : null
  },

  async findBookFile(bookId, parentId) {
    const q = `appProperties has { key='bookId' and value=${quote(bookId)} } and ${quote(parentId)} in parents and trashed = false`
    return (await listFiles(q, 'id'))[0]?.id ?? null
  },

  async getVersion(id) {
    const response = await driveFetch(`${API}/files/${encodeURIComponent(id)}?fields=version`)
    return String(((await response.json()) as { version: string }).version)
  },

  createFile(file, content) {
    const metadata = { name: file.name, mimeType: file.mimeType, parents: [file.parentId], appProperties: file.appProperties }
    return upload('POST', '/files', metadata, content)
  },

  updateFile(id, content) {
    return upload('PATCH', `/files/${encodeURIComponent(id)}`, {}, content)
  },

  async downloadText(id) {
    return (await driveFetch(`${API}/files/${encodeURIComponent(id)}?alt=media`)).text()
  },

  async downloadBlob(id) {
    return (await driveFetch(`${API}/files/${encodeURIComponent(id)}?alt=media`)).blob()
  },
}
