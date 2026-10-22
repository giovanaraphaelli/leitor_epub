import { DriveApiError, FOLDER_TYPE, SIMPLE_UPLOAD_LIMIT, type DriveApi, type DriveFileRef, type NewDriveFile } from '@/lib/drive/api'

// An in-memory Drive for the tests: the same calls the sync makes, without the
// network. Several "devices" can share one to sync through it. Like the real
// one, it answers 404 for a file that isn't there and for a new file whose
// folder is gone.

export interface FakeDriveFile {
  id: string
  name: string
  parentId: string
  mimeType: string
  appProperties: Record<string, string>
  trashed: boolean
  version: number
  content: Blob | null
}

export class FakeDrive implements DriveApi {
  files = new Map<string, FakeDriveFile>()
  uploads = 0
  nextId = 1
  // What the real Drive answers when the page can't read a big upload's
  // session address, and when the Drive is full.
  refuseBigUploads = false
  full = false

  checkUpload(content: Blob): void {
    if (this.full) throw new DriveApiError(403, 'storageQuotaExceeded', 'Google Drive 403: o Drive está cheio')
    if (this.refuseBigUploads && content.size > SIMPLE_UPLOAD_LIMIT) {
      throw new DriveApiError(0, 'noUploadSession', 'O Google Drive não devolveu o endereço do envio')
    }
  }

  // Every call waits a turn of the event loop, like a request would, so two
  // devices syncing at once interleave as they would over a network.
  roundTrip(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }

  find(test: (file: FakeDriveFile) => boolean): FakeDriveFile | undefined {
    return [...this.files.values()].find((file) => !file.trashed && test(file))
  }

  get(id: string): FakeDriveFile {
    const file = this.files.get(id)
    if (!file) throw new DriveApiError(404, 'notFound', `Google Drive 404: arquivo ${id} não existe`)
    return file
  }

  add(file: NewDriveFile, content: Blob | null): FakeDriveFile {
    const parent = this.files.get(file.parentId)
    if (file.parentId !== 'root' && (!parent || parent.trashed)) {
      throw new DriveApiError(404, 'notFound', `Google Drive 404: pasta ${file.parentId} não existe`)
    }
    const stored: FakeDriveFile = {
      id: `id${this.nextId++}`,
      name: file.name,
      parentId: file.parentId,
      mimeType: file.mimeType,
      appProperties: file.appProperties ?? {},
      trashed: false,
      version: 1,
      content,
    }
    this.files.set(stored.id, stored)
    return stored
  }

  async findFolder(name: string, parentId: string): Promise<string | null> {
    await this.roundTrip()
    return this.find((file) => file.mimeType === FOLDER_TYPE && file.name === name && file.parentId === parentId)?.id ?? null
  }

  async createFolder(name: string, parentId: string): Promise<string> {
    await this.roundTrip()
    return this.add({ name, parentId, mimeType: FOLDER_TYPE }, null).id
  }

  async isFolderAlive(id: string): Promise<boolean> {
    await this.roundTrip()
    const file = this.files.get(id)
    return file !== undefined && !file.trashed
  }

  async findFile(name: string, parentId: string): Promise<DriveFileRef | null> {
    await this.roundTrip()
    const file = this.find((candidate) => candidate.name === name && candidate.parentId === parentId)
    return file ? { id: file.id, version: String(file.version) } : null
  }

  async findBookFile(bookId: string, parentId: string): Promise<string | null> {
    await this.roundTrip()
    return this.find((file) => file.appProperties.bookId === bookId && file.parentId === parentId)?.id ?? null
  }

  async getVersion(id: string): Promise<string> {
    await this.roundTrip()
    return String(this.get(id).version)
  }

  async createFile(file: NewDriveFile, content: Blob): Promise<DriveFileRef> {
    await this.roundTrip()
    this.checkUpload(content)
    this.uploads++
    const stored = this.add(file, content)
    return { id: stored.id, version: String(stored.version) }
  }

  async updateFile(id: string, content: Blob): Promise<DriveFileRef> {
    await this.roundTrip()
    this.checkUpload(content)
    this.uploads++
    const file = this.get(id)
    file.content = content
    file.version++
    return { id, version: String(file.version) }
  }

  async downloadText(id: string): Promise<string> {
    return (await this.downloadBlob(id)).text()
  }

  async downloadBlob(id: string): Promise<Blob> {
    await this.roundTrip()
    const content = this.get(id).content
    if (!content) throw new Error(`arquivo ${id} sem conteúdo`)
    return content
  }

  // What the other devices would read: the library file, parsed.
  async library(): Promise<unknown> {
    const file = this.find((candidate) => candidate.name === 'biblioteca.json')
    return file ? JSON.parse(await this.downloadText(file.id)) : null
  }
}
