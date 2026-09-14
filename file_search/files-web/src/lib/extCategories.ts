/**
 * 副檔名 → 分類，純字串比對，不需要讀檔案內容——跟 `server/store.ts` 的
 * `EXT_CATEGORIES` 完全同一份清單（只留分類判斷需要的 `exts`，icon／color
 * 由 `/api/scan-categories` 提供，見 `useScanCategories`）。因為不用讀內容，
 * 「上傳資料夾」的類型篩選可以在瀏覽器裡就地分類挑選的檔案，不用像本機掃描
 * 那樣另外打一支 API 來回。**改動時兩邊要一起改**。
 */
const EXT_CATEGORIES: { label: string; exts: Set<string> }[] = [
  { label: '文件', exts: new Set(['.doc', '.docx', '.rtf', '.odt']) },
  { label: '簡報', exts: new Set(['.ppt', '.pptx', '.odp']) },
  { label: '試算表', exts: new Set(['.xls', '.xlsx', '.csv', '.tsv', '.ods']) },
  { label: 'PDF', exts: new Set(['.pdf']) },
  { label: '文字', exts: new Set(['.txt', '.md', '.rst', '.log', '.tex']) },
  {
    label: '程式碼',
    exts: new Set([
      '.py', '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.ino', '.c', '.h', '.cpp', '.hpp',
      '.cc', '.java', '.go', '.rs', '.rb', '.php', '.cs', '.swift', '.kt', '.sh', '.bat', '.ps1',
      '.html', '.htm', '.css', '.scss', '.vue', '.sql', '.r', '.m', '.lua', '.pl',
    ]),
  },
  {
    label: '設定與資料',
    exts: new Set([
      '.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env',
      '.xml', '.properties', '.gitignore',
    ]),
  },
  { label: '筆記本', exts: new Set(['.ipynb']) },
  { label: '圖片', exts: new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']) },
  { label: '音樂', exts: new Set(['.mp3', '.wav', '.flac', '.m4a']) },
  { label: '影片', exts: new Set(['.mp4', '.mov', '.avi', '.mkv', '.wmv']) },
  { label: '壓縮檔', exts: new Set(['.zip', '.rar', '.7z', '.tar', '.gz']) },
]

export const OTHER_LABEL = '其他'

/** 跟 `path.extname()` 一樣（副檔名前面的點不能是檔名第一個字），加上
 *  `server/store.ts` 掃描時同一招：`.gitignore` 這類「整個檔名就是一個點
 *  開頭」的，把整個檔名當成副檔名比對（不然會被誤判成「其他」）。 */
function extnameOf(name: string): string {
  const i = name.lastIndexOf('.')
  const ext = i > 0 ? name.slice(i).toLowerCase() : ''
  if (ext) return ext
  return name.startsWith('.') ? name.toLowerCase() : ''
}

/** 這個檔名屬於哪個分類標籤——比對不到任何一類就是「其他」。 */
export function categoryOf(filename: string): string {
  const ext = extnameOf(filename)
  for (const c of EXT_CATEGORIES) if (c.exts.has(ext)) return c.label
  return OTHER_LABEL
}
