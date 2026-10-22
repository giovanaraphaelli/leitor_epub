import { getAccessToken } from './auth'

export interface DriveAccount {
  name: string | null
  email: string | null
}

// about.get works with the drive.file scope alone, so showing who is
// connected needs no extra permission.
export async function getDriveAccount(): Promise<DriveAccount> {
  const accessToken = await getAccessToken()
  const response = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error(`Google Drive about: ${response.status} ${await response.text()}`)
  const data = (await response.json()) as { user?: { displayName?: string; emailAddress?: string } }
  return { name: data.user?.displayName ?? null, email: data.user?.emailAddress ?? null }
}
