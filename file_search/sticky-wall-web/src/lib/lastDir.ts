const KEY = 'sticky-wall-generate-notes-last-dir'

/** 「AI 生成便利貼」選檔視窗上次瀏覽到的資料夾——下次開直接從那裡開始。 */
export function getLastDir(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function setLastDir(dir: string): void {
  try {
    localStorage.setItem(KEY, dir)
  } catch {
    /* private mode etc. */
  }
}
