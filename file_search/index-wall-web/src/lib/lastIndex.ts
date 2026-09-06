const KEY = 'index-wall-last'

export function getLastIndex(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setLastIndex(name: string): void {
  try {
    localStorage.setItem(KEY, name)
  } catch {
    /* private mode etc. */
  }
}
