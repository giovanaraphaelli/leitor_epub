import { getDriveFolders, setDriveFolders, type DriveFolders } from '@/lib/db/sync'
import type { DriveApi } from '@/lib/drive/api'

// MyBooks/ holds the EPUBs (readable names, found by appProperties.bookId);
// MyBooks/Dados do app/ holds biblioteca.json, and its capas/ the covers.
export const ROOT_FOLDER = 'MyBooks'
export const DATA_FOLDER = 'Dados do app'
export const COVERS_FOLDER = 'capas'

export class MissingFolderError extends Error {
  readonly folder: string

  constructor(folder: string) {
    super(`A pasta ${folder} não está mais no Google Drive`)
    this.folder = folder
  }
}

// Looked up again after creating it: two devices on their first sync at the
// same time (Safari and the app installed on the same iPhone count as two)
// would each make one, and the search returns the oldest first, so both
// settle on the same folder.
async function findOrCreateFolder(api: DriveApi, name: string, parentId: string): Promise<string> {
  const found = await api.findFolder(name, parentId)
  if (found) return found
  const created = await api.createFolder(name, parentId)
  return (await api.findFolder(name, parentId)) ?? created
}

// Found by name the first time (with drive.file, Drive only shows the app what
// the app itself created, so another device's folders are found too) and then
// remembered. A remembered folder that's gone is reported instead of quietly
// made again: the books in it would vanish from every device's view.
export async function ensureFolders(api: DriveApi): Promise<DriveFolders> {
  const known = await getDriveFolders()
  if (known) {
    const folders: Array<[string, string]> = [
      [known.root, ROOT_FOLDER],
      [known.data, DATA_FOLDER],
      [known.covers, COVERS_FOLDER],
    ]
    for (const [id, name] of folders) {
      if (!(await api.isFolderAlive(id))) throw new MissingFolderError(name)
    }
    return known
  }
  const root = await findOrCreateFolder(api, ROOT_FOLDER, 'root')
  const data = await findOrCreateFolder(api, DATA_FOLDER, root)
  const covers = await findOrCreateFolder(api, COVERS_FOLDER, data)
  const folders = { root, data, covers }
  await setDriveFolders(folders)
  return folders
}
