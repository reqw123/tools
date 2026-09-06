const KEY = 'sticky-wall-default-tag'

/** 「批次新增」選過的分類——之後「新增便利貼」的分類欄會預設帶這個。存在瀏覽器。 */
export function getDefaultTag(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function setDefaultTag(tag: string): void {
  try {
    const t = tag.trim()
    if (t) localStorage.setItem(KEY, t)
    else localStorage.removeItem(KEY)
  } catch {
    /* 私密視窗等 */
  }
}
