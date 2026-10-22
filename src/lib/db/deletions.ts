import { getSetting, setSetting } from './settings'

const DRIVE_ENABLED_KEY = 'driveEnabled'

export const bookDeletionKey = (id: string) => `book:${id}`
export const highlightDeletionKey = (id: string) => `highlight:${id}`

// Removals are only recorded once this device has been connected to Drive: a
// book removed here before that must not, later, delete the same book that
// another device put on Drive.
export async function isDriveEnabled(): Promise<boolean> {
  return (await getSetting<boolean>(DRIVE_ENABLED_KEY)) === true
}

export function setDriveEnabled(enabled: boolean): Promise<string> {
  return setSetting(DRIVE_ENABLED_KEY, enabled)
}
