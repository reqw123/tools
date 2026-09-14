import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * 原子寫入：先寫到暫存檔、成功後才 rename 換掉目標檔案——寫到一半崩潰／
 * 斷電不會留下半截 JSON。這支跟 `store.ts` 內部那個同名的 `atomicWriteText`
 * 是同一種手法但分開維護：`store.ts` 那份服務 `.md`／分類顏色檔，這支只給
 * 共用模式自己的狀態（`people.json`／`visits.json`，見 `.share/` 資料夾）用，
 * 直接搬自 notes-web/server/atomic-write.ts，保持兩邊共用基礎設施一致。
 */
let tmpSeq = 0

export function atomicWriteFile(target: string, text: string): void {
  const dir = dirname(target)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${target}.${process.pid}.${Date.now()}.${tmpSeq++}.tmp`
  try {
    writeFileSync(tmp, text, 'utf-8')
    renameSync(tmp, target)
  } catch (err) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* 暫存檔清不掉就算了，不掩蓋原本的寫入錯誤 */
    }
    throw err
  }
}
