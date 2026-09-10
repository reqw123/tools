const INVALID_CHARS = new Set('<>:"/\\|?*')

export interface IndexNameCheck {
  /** 正規化後的檔名（自動補 .md）；不合法時 null。 */
  filename: string | null
  /** 不合法的原因（繁中，可直接顯示）；合法時 null。 */
  error: string | null
}

/**
 * 「新增／匯入索引集」對話框的即時檔名檢查——跟後端 `store.ts` 的
 * `validateIndexName()`（＝桌面版 `IndexRepository.validate_name()`）同一套規則，
 * 只差撞名這裡是比對前端手上的清單、後端是真的看檔案系統。後端仍是最後一道
 * 防線（跟另一個分頁／行程同時新增時前端清單可能過期），但打字當下就能回饋。
 *
 * CreateIndexDialog（內建範本）與 ImportIndexDialog（使用者挑的 .md）共用這支。
 */
export function validateIndexName(raw: string, existing: string[]): IndexNameCheck {
  const name = raw.trim()
  if (!name) return { filename: null, error: '請輸入索引集名稱' }
  if (name === '.' || name === '..') return { filename: null, error: '不是合法的檔名' }
  const bad = [...new Set([...name].filter((c) => INVALID_CHARS.has(c)))].sort()
  if (bad.length) return { filename: null, error: `檔名不能包含：${bad.join(' ')}` }
  const filename = name.toLowerCase().endsWith('.md') ? name : `${name}.md`
  if (filename.length <= 3) return { filename: null, error: '請輸入索引集名稱' } // 去掉 .md 後是空的
  if (existing.some((n) => n.toLowerCase() === filename.toLowerCase())) {
    return { filename: null, error: `「${filename}」已經存在，換個名稱` }
  }
  return { filename, error: null }
}
