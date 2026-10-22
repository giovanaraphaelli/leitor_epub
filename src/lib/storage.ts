// Asks the browser not to throw the library away when space runs low. It
// doesn't protect against the reader clearing the site's data by hand. Safe to
// call again: once the browser has decided, it keeps answering the same.
// Firefox asks the reader the first time; the other browsers decide alone.
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
